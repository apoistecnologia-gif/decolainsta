export const dynamic='force-dynamic';
export const runtime='nodejs';

import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {prisma} from '@/lib/db';
import {connectedAccount} from '@/lib/instagram/accounts';
import {getProfile} from '@/lib/instagram/meta';
import {
  DYNAMIC_COLLECTION_ACTION,parseDynamicJobEvent,
} from '@/lib/reference-dynamic-collection';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {inspectDynamicFailureOutput,type DynamicFailureCategory} from
  '@/lib/providers/phantombuster-failure-diagnostic';
import {resolvePilotCollectorInWorkspace} from '@/lib/providers/phantombuster-pilot-workspace';
import {inspectPinnedCollectorProgress} from '@/lib/providers/phantombuster-collector-progress';
import {inspectApifyPilotConnection} from '@/lib/providers/apify-pilot-readiness';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function authorized(request:Request):boolean{
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32)return false;
  const given=Buffer.from(request.headers.get('authorization')??'','utf8');
  const expected=Buffer.from('Bearer '+secret,'utf8');
  return given.length===expected.length&&timingSafeEqual(given,expected);
}

/** One official account metadata read and one PREVIOUS provider output read.
 * This is not an Instagram follower-list access test, and cannot certify that
 * Instagram has removed a PhantomBuster or action restriction.
 * No new collector/follow/unfollow, database mutations, raw logs or secrets.
 */
export async function GET(request:Request){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers:HEADERS});
  if(!authorized(request))
    return NextResponse.json({error:'Não autorizado'},{status:401,headers:HEADERS});
  if(process.env.PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED!=='yes')
    return NextResponse.json({error:'Diagnóstico não habilitado'},{status:403,headers:HEADERS});

  // A rename must not redirect the pilot probe to a different account.
  // The initial @contateste6699 was renamed to @apoistecnologia.
  // Pin the official Meta identity; compare the CURRENT stored username only.
  const PILOT_INSTAGRAM_ID='17841411544892772';
  const accounts=await prisma.instagramAccount.findMany({
    where:{instagramUserId:PILOT_INSTAGRAM_ID},
    select:{id:true,userId:true,username:true,instagramUserId:true,
      encryptedAccessToken:true},
    take:2,
  });
  if(accounts.length!==1)
    return NextResponse.json({error:'Conta piloto não exclusiva'},{status:409,headers:HEADERS});
  const account=accounts[0];
  let metaRead:'ok'|'not-connected'|'unavailable'='not-connected';
  let metaIdentity:'verified'|'username-mismatch'|'unavailable'='unavailable';
  if(account.instagramUserId&&account.encryptedAccessToken){
    metaRead='unavailable';
    try{
      const active=await connectedAccount(account.id,account.userId);
      if(active){
        const profile=await getProfile(active.token,account.instagramUserId);
        if(profile.id===account.instagramUserId){
          metaRead='ok';
          metaIdentity=profile.username.toLowerCase()===account.username.toLowerCase()?'verified':'username-mismatch';
        }
      }
    }catch{
      // Never surface Graph OAuth token, provider error text or account data.
    }
  }

  const row=await prisma.activityLog.findFirst({
    where:{instagramAccountId:account.id,action:DYNAMIC_COLLECTION_ACTION},
    select:{details:true,targetUsername:true},
    orderBy:[{createdAt:'desc'},{id:'desc'}],
  });
  const receipt=parseDynamicJobEvent(row?.details);
  let previousContainerCategory:DynamicFailureCategory|null=null;
  if(receipt?.accountId===account.id&&
     receipt.agentId===row?.targetUsername&&
     receipt.containerId&&
     isConfiguredPhantomBusterKey(process.env.PHANTOMBUSTER_API_KEY))
    previousContainerCategory=await inspectDynamicFailureOutput(
      process.env.PHANTOMBUSTER_API_KEY!,receipt.containerId);

  // Inspect the CURRENT workspace configuration and provider history without
  // changing the agent, touching cookies, or launching a new container.
  let collectorConfiguration='not-configured';
  let collectorProgress='not-checked';
  const key=process.env.PHANTOMBUSTER_API_KEY;
  const template=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE?.toLowerCase()??'';
  if(isConfiguredPhantomBusterKey(key)){
    const inspection=await resolvePilotCollectorInWorkspace(key!,template);
    collectorConfiguration=inspection.status;
    if(inspection.status==='ready'&&inspection.agentId)
      collectorProgress=await inspectPinnedCollectorProgress(key!,inspection.agentId);
  }
  const collectionHistoryRequiresReview=receipt?.state==='finished-unverified'||
    receipt?.state==='unconfirmed'||receipt?.state==='claimed';
  // One additional read-only API identity check, never an Actor launch.
  // The token remains exclusively on the server and no provider body escapes.
  const apify=await inspectApifyPilotConnection(process.env.APIFY_API_TOKEN);
  return NextResponse.json({
    status:'read-only-diagnostic',
    apifyStatus:apify.status,
    apifyAuthenticationChecked:apify.authenticationChecked,
    apifyActorRunsExecuted:apify.actorRunsExecuted,
    apifyInstagramActionsExecuted:apify.instagramActionsExecuted,
    apifyCollectionEnabled:apify.collectionEnabled,
    collectorConfiguration,
    collectorProgress,
    collectionHistoryRequiresReview,
    newCollectionPermitted:false,
    currentSessionOwnerVerifiedByProvider:false,
    metaRead,
    metaIdentity,
    previousContainerCategory,
    previousContainerOnly:true,
    currentPhantomSessionVerified:false,
    instagramRestrictionCleared:null,
    providerLaunchesExecuted:0,
    instagramActionsExecuted:0,
    dataMutations:0,
  },{headers:HEADERS});
}
