export const dynamic='force-dynamic';
export const runtime='nodejs';

import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {connectedAccount} from '@/lib/instagram/accounts';
import {getProfile} from '@/lib/instagram/meta';
import {
 APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_MAX_USD,
 parseMinimalInstagramCookies,
} from '@/lib/providers/apify-one-follow';
import {
 APIFY_FOLLOW_OBSERVATION_ACTION,matchOperatorFollowObservation,
} from '@/lib/providers/apify-pilot-relationship-observation';
import {startOneUnfollow,inspectOneUnfollow} from '@/lib/providers/apify-one-unfollow';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const ACCOUNT_ID='17841411544892772';
const LEGACY_NAME='contateste6699';
const SOURCE_ACTION='apify_reference_one_follow_pilot_v1';
const TEST_ACTION='apify_pending_request_unfollow_trial_v1';
const respond=(status:number,value:Record<string,unknown>)=>
 NextResponse.json({
  actorRunsLaunchedByThisRequest:0,instagramActionsConfirmed:0,
  requestCancellationConfirmed:false,automatedUnfollowEnabled:false,
  ...value,
 },{status,headers:HEADERS});
type State='reserved'|'launched'|'unconfirmed'|'rejected'|
 'provider-reported'|'provider-rejected'|'provider-blocked'|'failed'|'ambiguous';
type Receipt={
 version:1;state:State;
 actor:typeof APIFY_ONE_FOLLOW_ACTOR;action:'unfollow';
 accountId:string;accountInstagramUserId:typeof ACCOUNT_ID;
 targetUsername:string;sourceFollowRunId:string;runId:string|null;
 maxActionsPerRun:1;maxTotalChargeUsd:0.25;costUsd:number|null;
 providerReportedUnfollow:boolean;cancelledIndependentlyVerified:false;
 automatedUnfollowEnabled:false;
};
const validUsername=(v:unknown):v is string=>
 typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
const validRunId=(v:unknown):v is string=>
 typeof v==='string'&&/^[A-Za-z0-9]{17,24}$/.test(v);
function receipt(raw:unknown):Receipt|null{
 if(typeof raw!=='string'||raw.length>1500)return null;
 let d:unknown;try{d=JSON.parse(raw);}catch{return null;}
 if(!d||typeof d!=='object'||Array.isArray(d))return null;
 const v=d as Record<string,unknown>;
 if(Object.keys(v).length!==15||v.version!==1||
   !['reserved','launched','unconfirmed','rejected','provider-reported',
     'provider-rejected','provider-blocked','failed','ambiguous']
     .includes(String(v.state))||
   v.actor!==APIFY_ONE_FOLLOW_ACTOR||v.action!=='unfollow'||
   typeof v.accountId!=='string'||v.accountInstagramUserId!==ACCOUNT_ID||
   !validUsername(v.targetUsername)||!validRunId(v.sourceFollowRunId)||
   (v.runId!==null&&!validRunId(v.runId))||
   v.maxActionsPerRun!==1||v.maxTotalChargeUsd!==APIFY_ONE_FOLLOW_MAX_USD||
   (v.costUsd!==null&&(typeof v.costUsd!=='number'||
     !Number.isFinite(v.costUsd)||v.costUsd<0))||
   typeof v.providerReportedUnfollow!=='boolean'||
   v.cancelledIndependentlyVerified!==false||
   v.automatedUnfollowEnabled!==false)return null;
 return v as Receipt;
}
async function scope(){
 const session=await auth();
 const uid=(session?.user as {id?:string}|undefined)?.id;
 if(!uid)return null;
 const user=await prisma.user.findUnique({
  where:{id:uid},select:{role:true},
 });
 if(user?.role!=='admin')return null;
 const accounts=await prisma.instagramAccount.findMany({
  where:{userId:uid,instagramUserId:ACCOUNT_ID},
  select:{id:true,userId:true,username:true,status:true,
   instagramUserId:true,cooldownUntil:true,dryMode:true},take:2,
 });
 return accounts.length===1?accounts[0]:null;
}
type Account=NonNullable<Awaited<ReturnType<typeof scope>>>;
async function verifiedMeta(account:Account):Promise<boolean>{
 if(account.instagramUserId!==ACCOUNT_ID||
   !['active','inactive'].includes(account.status)||
   (account.cooldownUntil&&account.cooldownUntil.getTime()>=Date.now()))
  return false;
 try{
  const connected=await connectedAccount(account.id,account.userId);
  if(!connected)return false;
  const profile=await getProfile(connected.token,ACCOUNT_ID);
  return profile.id===ACCOUNT_ID&&
    profile.username.toLowerCase()===account.username.toLowerCase();
 }catch{return false;}
}
const actorConfigReady=()=>
 process.env.VERCEL_ENV==='preview'&&
 process.env.PREVIEW_APIFY_PENDING_REQUEST_CANCEL_ENABLED==='yes'&&
 typeof process.env.APIFY_API_TOKEN==='string'&&
 process.env.APIFY_API_TOKEN.length>=12&&
 parseMinimalInstagramCookies(process.env.APIFY_INSTAGRAM_COOKIES_JSON)!==null;

async function history(account:Account){
 const [follows,observations,cancellations]=await Promise.all([
  prisma.activityLog.findMany({
   where:{instagramAccountId:account.id,action:SOURCE_ACTION},
   select:{id:true,details:true,targetUsername:true},take:2,
  }),
  prisma.activityLog.findMany({
   where:{instagramAccountId:account.id,action:APIFY_FOLLOW_OBSERVATION_ACTION},
   select:{details:true,targetUsername:true},take:2,
  }),
  prisma.activityLog.findMany({
   where:{instagramAccountId:account.id,action:TEST_ACTION},
   select:{id:true,details:true,targetUsername:true,success:true},take:2,
  }),
 ]);
 const bounded=follows.length===1&&observations.length===1&&
   cancellations.length<=1;
 if(!bounded)return {target:null,followRunId:null,attempt:cancellations[0]??null};
 const follow=follows[0];
 let d:Record<string,unknown>|null=null;
 try{
  const raw=JSON.parse(follow.details??'');
  d=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:null;
 }catch{return {target:null,followRunId:null,attempt:cancellations[0]??null};}
 const target=follow.targetUsername;
 const runId=d?.runId;
 const obs=observations[0];
 if(d?.accountInstagramUserId!==ACCOUNT_ID||
    d?.accountId!==account.id||
    d?.state!=='provider-reported'||
    d?.providerReportedFollow!==true||
    d?.independentlyVerified!==false||
    !validUsername(target)||!validRunId(runId)||
    obs.targetUsername!==target||
    !matchOperatorFollowObservation(obs.details,{
      targetUsername:target,runId,
    }))
  return {target:null,followRunId:null,attempt:cancellations[0]??null};
 return {target,followRunId:runId,attempt:cancellations[0]??null};
}
function publicState(account:Account,h:Awaited<ReturnType<typeof history>>,
 metaVerified:boolean){
 const prev=receipt(h.attempt?.details);
 return {
  status:prev?.state??'not-started',
  targetUsername:h.target,
  accountUsername:account.username,
  pendingRequestObserved:!!h.target,
  metaIdentityVerified:metaVerified,
  configured:actorConfigReady(),
  canLaunch:!!h.target&&!h.attempt&&actorConfigReady()&&metaVerified,
  canInspect:prev?.state==='launched'&&!!prev.runId,
  maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
  costUsd:prev?.costUsd??null,
  providerReportedUnfollow:prev?.providerReportedUnfollow??false,
  requestCancellationConfirmed:false,automatedUnfollowEnabled:false,
  actorRunsLaunchedByThisRequest:0,instagramActionsConfirmed:0,
 };
}
export async function GET(){
 if(process.env.VERCEL_ENV!=='preview')
  return respond(403,{status:'blocked',error:'Somente Preview'});
 const account=await scope();
 if(!account)return respond(403,{status:'blocked',error:'Não autorizado'});
 const [h,verified]=await Promise.all([history(account),verifiedMeta(account)]);
 return NextResponse.json(publicState(account,h,verified),{headers:HEADERS});
}
export async function POST(req:Request){
 if(process.env.VERCEL_ENV!=='preview')
  return respond(403,{status:'blocked',error:'Somente Preview'});
 if(req.headers.get('origin')!==new URL(req.url).origin)
  return respond(403,{status:'blocked',error:'Origem inválida'});
 if(!req.headers.get('content-type')?.startsWith('application/json'))
  return respond(415,{status:'blocked',error:'Formato inválido'});
 const raw=await req.text().catch(()=>'');
 if(!raw||raw.length>160)
  return respond(400,{status:'blocked',error:'Dados inválidos'});
 let data:unknown;try{data=JSON.parse(raw);}catch{
  return respond(400,{status:'blocked',error:'Dados inválidos'});
 }
 if(!data||typeof data!=='object'||Array.isArray(data))
  return respond(400,{status:'blocked',error:'Dados inválidos'});
 const input=data as Record<string,unknown>;
 if(Object.keys(input).length!==2||
  input.confirmRealInstagramAction!==true||
  !['cancel-one','inspect'].includes(String(input.operation)))
  return respond(400,{status:'blocked',error:'Confirmação necessária'});
 const account=await scope();
 if(!account)return respond(403,{status:'blocked',error:'Não autorizado'});
 const h=await history(account);
 if(input.operation==='inspect'){
  const old=receipt(h.attempt?.details);
  if(!old||old.accountId!==account.id)
   return respond(409,{status:'blocked',error:'Execução não registrada'});
  if(old.state!=='launched'||!old.runId)
   return NextResponse.json(publicState(account,h,await verifiedMeta(account)),{
    headers:HEADERS});
  const result=await inspectOneUnfollow(
   process.env.APIFY_API_TOKEN,old.runId,old.targetUsername);
  if(['running','unavailable'].includes(result.status))
   return respond(200,{status:result.status,costUsd:result.costUsd,
    providerReportedUnfollow:false});
  const next:Receipt={...old,state:result.status,
   costUsd:result.costUsd,providerReportedUnfollow:result.providerReportedUnfollow};
  const updated=await prisma.activityLog.updateMany({
   where:{id:h.attempt!.id,instagramAccountId:account.id,
    action:TEST_ACTION,details:h.attempt!.details,success:false},
   data:{details:JSON.stringify(next),success:false},
  }).catch(()=>null);
  if(updated?.count!==1)
   return respond(409,{status:'blocked',error:'Conflito na auditoria'});
  return respond(200,{status:next.state,
   costUsd:next.costUsd,
   providerReportedUnfollow:next.providerReportedUnfollow});
 }
 if(!h.target||!h.followRunId||h.attempt||
    !actorConfigReady()||!(await verifiedMeta(account)))
  return respond(409,{status:'blocked',
   error:'Histórico, conta ou configuração ainda não liberados'});
 const initial:Receipt={
  version:1,state:'reserved',
  actor:APIFY_ONE_FOLLOW_ACTOR,action:'unfollow',
  accountId:account.id,accountInstagramUserId:ACCOUNT_ID,
  targetUsername:h.target,sourceFollowRunId:h.followRunId,
  runId:null,maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
  costUsd:null,providerReportedUnfollow:false,
  cancelledIndependentlyVerified:false,automatedUnfollowEnabled:false,
 };
 const saved=JSON.stringify(initial);
 let claim:{id:string}|null=null;
 try{
  claim=await prisma.$transaction(async tx=>{
   const current=await tx.instagramAccount.findUnique({
    where:{id:account.id},
    select:{instagramUserId:true,status:true,cooldownUntil:true},
   });
   if(!current||current.instagramUserId!==ACCOUNT_ID||
     !['active','inactive'].includes(current.status)||
     (current.cooldownUntil&&current.cooldownUntil.getTime()>=Date.now()))
    return null;
   if(await tx.activityLog.findFirst({
    where:{instagramAccountId:account.id,action:TEST_ACTION},
    select:{id:true},
   }))return null;
   // Re-check the exact observed pending request under the transaction.
   const observation=await tx.activityLog.findFirst({
    where:{instagramAccountId:account.id,
     action:APIFY_FOLLOW_OBSERVATION_ACTION,targetUsername:h.target},
    select:{details:true},
   });
   if(!matchOperatorFollowObservation(observation?.details,{
     targetUsername:h.target,runId:h.followRunId}))return null;
   return tx.activityLog.create({
    data:{instagramAccountId:account.id,action:TEST_ACTION,
     targetUsername:h.target,success:false,details:saved},
    select:{id:true},
   });
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }catch{
  return respond(409,{status:'blocked',error:'Conflito; não repetir'});
 }
 if(!claim)return respond(409,{
  status:'blocked',error:'Tentativa existente ou estado alterado'});
 const started=await startOneUnfollow(
  process.env.APIFY_API_TOKEN,process.env.APIFY_INSTAGRAM_COOKIES_JSON,
  h.target,{
   instagramUserId:ACCOUNT_ID,username:account.username,
   previousUsernames:[LEGACY_NAME],
  });
 const next:Receipt={...initial,
  state:started.status==='queued'?'launched':
   started.status==='refused'?'rejected':'unconfirmed',
  runId:started.runId,
 };
 const updated=await prisma.activityLog.updateMany({
  where:{id:claim.id,instagramAccountId:account.id,action:TEST_ACTION,
   details:saved,success:false},
  data:{details:JSON.stringify(next),success:false},
 }).catch(()=>null);
 return respond(200,{
  status:updated?.count===1?next.state:'unconfirmed',
  targetUsername:updated?.count===1?next.targetUsername:null,
  actorRunsLaunchedByThisRequest:started.status==='queued'?1:0,
  mayRetryAutomatically:false,
 });
}
