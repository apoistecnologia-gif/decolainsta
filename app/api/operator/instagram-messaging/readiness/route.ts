export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {messagingEnabled,messagingOAuthConfig} from '@/lib/instagram/messaging-oauth';
const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
/** Permission names and presence only, never secret values or tokens. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers:HEADERS});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return NextResponse.json({error:'Sem sessão'},{status:401,headers:HEADERS});
  const operator=await prisma.user.findUnique({where:{id:userId},
    select:{role:true}});
  if(operator?.role!=='admin')return NextResponse.json({
    error:'Acesso restrito ao operador'},{status:403,headers:HEADERS});
  const account=await prisma.instagramAccount.findFirst({
    where:{userId,username:process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??''},
    select:{id:true,instagramUserId:true,encryptedAccessToken:true},
  });
  const enabled=messagingEnabled();
  const oauthConfigured=messagingOAuthConfig()!==null;
  const webhookConfigured=Boolean(
    (process.env.INSTAGRAM_MESSAGING_WEBHOOK_VERIFY_TOKEN??'').length>=24&&
    (process.env.INSTAGRAM_MESSAGING_WEBHOOK_APP_SECRET??'').length>=12);
  let messagingConnected=false;
  let migrationReady=false;
  if(enabled&&account){
    try{
      const connected=await prisma.instagramMessagingConnection.findUnique({
        where:{instagramAccountId:account.id},
        select:{tokenExpiresAt:true},
      });
      migrationReady=true;
      messagingConnected=Boolean(connected&&connected.tokenExpiresAt.getTime()>Date.now());
    }catch{
      // Migration may not yet be applied. Do not claim successful setup.
    }
  }
  return NextResponse.json({
    source:'meta-instagram-login-messaging',
    integrationEnabled:enabled,oauthConfigured,webhookConfigured,
    migrationReady,messagingConnected,
    accountRegistered:Boolean(account),
    accountId:account?.id??null,
    businessTokenPresent:Boolean(account?.encryptedAccessToken),
    businessTokenCompatibleWithMessaging:false,
    currentAccountMetaIdKnown:Boolean(account?.instagramUserId),
    permissionRequired:'instagram_business_manage_messages',
    appReviewRequiredForThirdPartyAccounts:true,
    signedWebhookVerificationRequired:true,
    userInteractionRequiredForProfileLookup:true,
    arbitraryFollowerLookupSupported:false,
    unfollowAutomationEnabled:false,
    nextStep:!enabled?'autorizar_configuracao_separada':
      !migrationReady?'aplicar_migracao_isolada':
      !oauthConfigured?'configurar_instagram_login':
      !webhookConfigured?'configurar_webhook_assinado':
      !messagingConnected?'conectar_conta_profissional':
      'validar_assinatura_e_permissoes',
  },{headers:HEADERS});
}
