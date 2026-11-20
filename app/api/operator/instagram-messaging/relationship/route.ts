export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {decrypt} from '@/lib/encryption';
import {messagingEnabled} from '@/lib/instagram/messaging-oauth';
import {fetchMessagingRelationship,assessMessagingUnfollowReview} from
  '@/lib/instagram/messaging-relationship-verification';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function fail(error:string,status:number){
  return NextResponse.json({error},{status,headers:HEADERS});
}
/**
 * Operator-only: independently check an established signed inbound
 * messaging contact by internal ID. Never accepts arbitrary IG usernames
 * or IDs as proof of a messaging conversation. Never triggers social actions.
 */
export async function GET(req:Request){
  if(!messagingEnabled())return fail('Integração Meta ainda desativada',403);
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return fail('Não autorizado',401);
  const user=await prisma.user.findUnique({
    where:{id:userId},select:{role:true},
  });
  if(user?.role!=='admin')return fail('Somente operador',403);
  const id=new URL(req.url).searchParams.get('contactId')??'';
  if(!/^[a-zA-Z0-9_-]{15,100}$/.test(id))return fail('Contato inválido',400);
  const contact=await prisma.instagramMessagingContact.findFirst({
    where:{id,instagramAccount:{userId}},
    select:{
      id:true,instagramAccountId:true,senderIgsid:true,
      firstFollowConfirmedAt:true,lastOutgoingFollowing:true,
      firstInboundAt:true,
    },
  });
  if(!contact)return fail('Contato não encontrado',404);
  const connection=await prisma.instagramMessagingConnection.findUnique({
    where:{instagramAccountId:contact.instagramAccountId},
    select:{instagramUserId:true,encryptedAccessToken:true,tokenExpiresAt:true},
  });
  if(!connection||connection.tokenExpiresAt.getTime()<Date.now())
    return fail('Acesso de mensagens expirado ou ausente',409);
  let token:string;
  try{token=decrypt(connection.encryptedAccessToken);}
  catch{return fail('Reconexão de mensagens necessária',409);}
  const now=new Date();
  const verified=await fetchMessagingRelationship({
    token,tokenKind:'instagram-login',
    instagramAccountId:contact.instagramAccountId,
    igsid:contact.senderIgsid,
    receipt:{source:'instagram-messaging-webhook',
      instagramAccountId:contact.instagramAccountId,
      senderIgsid:contact.senderIgsid,
      consented:true},
    observedAt:now,
  });
  if(verified.status!=='verified')return NextResponse.json({
    status:verified.status,independentlyVerified:false,
    unfollowAutomationEnabled:false,
  },{headers:HEADERS});
  const following=verified.outgoing==='following';
  const firstVerifiedAt=following
    ?(contact.lastOutgoingFollowing===true&&contact.firstFollowConfirmedAt
      ?contact.firstFollowConfirmedAt:now)
    :null;
  try{
    await prisma.$transaction(async tx=>{
      await tx.instagramMessagingContact.update({
        where:{id:contact.id},
        data:{
          lastOutgoingFollowing:following,
          lastIncomingFollowing:verified.incomingFollows,
          firstFollowConfirmedAt:firstVerifiedAt,
          lastRelationshipCheckedAt:now,
        },
      });
      await tx.activityLog.create({data:{
        instagramAccountId:contact.instagramAccountId,
        action:'instagram_messaging_relationship_verified_v1',
        success:true,
        // No IGSID, message, username or OAuth secret in activity logs.
        details:JSON.stringify({
          source:'meta-instagram-login-messaging',
          contactId:contact.id,outgoingFollowing:following,
          followsBack:verified.incomingFollows,
          observedAt:verified.observedAt,
        }),
      }});
    });
  }catch{return fail('Falha ao registrar evidência',503);}
  // Messaging-scoped IDs cannot safely be matched to a username whitelist.
  // Keep every contact protected until an explicit verified mapping exists.
  const decision=assessMessagingUnfollowReview({
    evidence:verified,firstVerifiedFollowingAt:firstVerifiedAt,
    now,whitelisted:true,protectedAccount:true,authorized:false,
  });
  return NextResponse.json({
    status:'verified',
    independentlyVerified:true,
    source:verified.source,
    outgoing:verified.outgoing,incomingFollows:verified.incomingFollows,
    observedAt:verified.observedAt,
    firstVerifiedFollowingAt:firstVerifiedAt?.toISOString()??null,
    possibleReviewAfter:firstVerifiedAt
      ?new Date(firstVerifiedAt.getTime()+48*60*60*1000).toISOString():null,
    eligibleForUnfollow:false,unfollowAutomationEnabled:false,
    reviewReason:decision.reason,
  },{headers:HEADERS});
}
