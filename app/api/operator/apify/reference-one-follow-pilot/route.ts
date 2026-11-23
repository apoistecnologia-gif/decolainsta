export const dynamic='force-dynamic';
export const runtime='nodejs';

import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {
 APIFY_ONE_FOLLOW_ACTION,APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_MAX_USD,
 parseMinimalInstagramCookies,startOneFollow,inspectOneFollow,
} from '@/lib/providers/apify-one-follow';
import {
 AUDIENCE_CANDIDATE_ACTION,MAX_QUEUE_ENTRIES_PER_SYNC,
} from '@/lib/reference-candidate-queue';
import {planOneFollowFromSavedReferences} from
 '@/lib/providers/apify-pilot-candidate-selection';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const ACCOUNT_ID='17841411544892772';
const OLD_ALIAS='contateste6699';
const ACTION='apify_reference_one_follow_pilot_v1';
const BLOCKED=(status:number,reason:string)=>NextResponse.json({
 status:'blocked',error:reason,actorRunsLaunched:0,
 instagramActionsConfirmed:0,automatedUnfollowEnabled:false,
},{status,headers:HEADERS});
type State='reserved'|'launched'|'rejected'|'unconfirmed'|
 'provider-reported'|'provider-rejected'|'provider-blocked'|
 'failed'|'ambiguous';
type Receipt={
 version:1;state:State;actor:typeof APIFY_ONE_FOLLOW_ACTOR;
 accountId:string;accountInstagramUserId:typeof ACCOUNT_ID;
 sourceReference:string;targetUsername:string;runId:string|null;
 maxActionsPerRun:1;maxTotalChargeUsd:0.25;costUsd:number|null;
 providerReportedFollow:boolean;independentlyVerified:false;
 automatedUnfollowEnabled:false;
};
type Account=NonNullable<Awaited<ReturnType<typeof scope>>>;
function parseReceipt(raw:unknown):Receipt|null{
 if(typeof raw!=='string'||raw.length>1400)return null;
 let obj:unknown;
 try{obj=JSON.parse(raw);}catch{return null;}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return null;
 const v=obj as Record<string,unknown>;
 if(Object.keys(v).length!==14||v.version!==1||
    !['reserved','launched','rejected','unconfirmed','provider-reported',
      'provider-rejected','provider-blocked','failed','ambiguous'].includes(String(v.state))||
    v.actor!==APIFY_ONE_FOLLOW_ACTOR||
    typeof v.accountId!=='string'||v.accountInstagramUserId!==ACCOUNT_ID||
    typeof v.sourceReference!=='string'||
    !/^[a-z0-9._]{1,30}$/.test(v.sourceReference)||
    typeof v.targetUsername!=='string'||
    !/^[a-z0-9._]{1,30}$/.test(v.targetUsername)||
    (v.runId!==null&&(typeof v.runId!=='string'||
      !/^[A-Za-z0-9]{17,24}$/.test(v.runId)))||
    v.maxActionsPerRun!==1||v.maxTotalChargeUsd!==APIFY_ONE_FOLLOW_MAX_USD||
    (v.costUsd!==null&&(typeof v.costUsd!=='number'||
      !Number.isFinite(v.costUsd)||v.costUsd<0))||
    typeof v.providerReportedFollow!=='boolean'||
    v.independentlyVerified!==false||
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
  where:{instagramUserId:ACCOUNT_ID,userId:uid},
  select:{id:true,username:true,status:true,dryMode:true,
   instagramUserId:true,cooldownUntil:true},take:2,
 });
 return accounts.length===1?accounts[0]:null;
}
const accountReady=(account:Account)=>account.status==='active'&&
 !!account.instagramUserId&&
 (!account.cooldownUntil||account.cooldownUntil.getTime()<Date.now());
const flagEnabled=()=>process.env.VERCEL_ENV==='preview'&&
 process.env.PREVIEW_APIFY_ONE_FOLLOW_ENABLED==='yes';
const tokenReady=()=>typeof process.env.APIFY_API_TOKEN==='string'&&
 process.env.APIFY_API_TOKEN.length>=12;
const cookiesReady=()=>parseMinimalInstagramCookies(
 process.env.APIFY_INSTAGRAM_COOKIES_JSON)!==null;

async function candidatePlan(account:Account){
 const [references,candidates,protectedRows,priorActions,attempts,legacy]=
  await Promise.all([
   prisma.targetAccount.findMany({
    where:{instagramAccountId:account.id},
    select:{id:true,username:true,enabled:true},take:101,
   }),
   prisma.activityLog.findMany({
    where:{instagramAccountId:account.id,action:AUDIENCE_CANDIDATE_ACTION},
    select:{id:true,targetUsername:true,details:true},
    orderBy:[{createdAt:'asc'},{id:'asc'}],
    take:MAX_QUEUE_ENTRIES_PER_SYNC+1,
   }),
   prisma.whitelist.findMany({
    where:{instagramAccountId:account.id},
    select:{username:true},take:2001,
   }),
   prisma.followAction.findMany({
    where:{instagramAccountId:account.id,isDryRun:false},
    select:{targetUsername:true},take:2001,
   }),
   prisma.activityLog.findMany({
    where:{instagramAccountId:account.id,action:ACTION},
    select:{id:true,details:true,targetUsername:true,success:true},
    take:2,
   }),
   prisma.activityLog.findMany({
    where:{instagramAccountId:account.id,action:APIFY_ONE_FOLLOW_ACTION},
    select:{details:true,targetUsername:true},take:2,
   }),
  ]);
 const bounded=references.length<=100&&
   candidates.length<=MAX_QUEUE_ENTRIES_PER_SYNC&&
   protectedRows.length<=2000&&priorActions.length<=2000&&
   attempts.length<=1&&legacy.length<=1;
 const old=legacy[0]?.details;
 let oldStatus:unknown;
 try{oldStatus=old?JSON.parse(old).state:null;}catch{oldStatus=null;}
 const oldResolved=legacy.length===1&&
   ['provider-rejected','provider-blocked','failed','provider-reported','ambiguous',
    'rejected'].includes(String(oldStatus));
 const plan=bounded?planOneFollowFromSavedReferences({
  identity:{instagramUserId:ACCOUNT_ID,username:account.username,
    previousUsernames:[OLD_ALIAS]},
  references,candidates,
  protectedUsernames:protectedRows.map(x=>x.username),
  previouslyAttemptedUsernames:[
   ...priorActions.map(x=>x.targetUsername),
   ...attempts.flatMap(x=>x.targetUsername?[x.targetUsername]:[]),
   ...legacy.flatMap(x=>x.targetUsername?[x.targetUsername]:[]),
  ],
 }):null;
 return {plan,bounded,oldResolved,existing:attempts[0]??null};
}
function eligible(account:Account,ctx:Awaited<ReturnType<typeof candidatePlan>>){
 return flagEnabled()&&tokenReady()&&cookiesReady()&&
   accountReady(account)&&ctx.bounded&&ctx.oldResolved&&
   ctx.existing===null&&!!ctx.plan?.next;
}
function publicReadiness(account:Account,ctx:Awaited<ReturnType<typeof candidatePlan>>){
 const receipt=parseReceipt(ctx.existing?.details);
 return {
  status:receipt?.state??'not-started',
  account:account.username,
  targetUsername:receipt?.targetUsername??null,
  candidateReference:ctx.plan?.next?.referenceUsername??null,
  readyCandidates:ctx.plan?.eligibleCount??0,
  registeredReferences:ctx.plan?.totalReferences??0,
  collectorEnabledReferences:ctx.plan?.enabledReferences??0,
  accountReady:accountReady(account),
  cookieConfigured:cookiesReady(),tokenConfigured:tokenReady(),
  historicalRunResolved:ctx.oldResolved,
  globallyInDryMode:account.dryMode,
  canLaunch:eligible(account,ctx),
  canInspect:receipt?.state==='launched'&&!!receipt.runId,
  providerReportedFollow:receipt?.providerReportedFollow??false,
  followIndependentlyVerified:false,unfollowEnabled:false,
  actorRunsLaunchedByThisRequest:0,instagramActionsConfirmed:0,
  maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
  costUsd:receipt?.costUsd??null,
 };
}
/** Read-only readiness, no raw candidates or Instagram cookies exposed. */
export async function GET(){
 if(process.env.VERCEL_ENV!=='preview')return BLOCKED(403,'Somente Preview');
 const account=await scope();
 if(!account)return BLOCKED(403,'Operador não autorizado');
 const plan=await candidatePlan(account);
 return NextResponse.json(publicReadiness(account,plan),{headers:HEADERS});
}
export async function POST(req:Request){
 if(process.env.VERCEL_ENV!=='preview')return BLOCKED(403,'Somente Preview');
 if(req.headers.get('origin')!==new URL(req.url).origin)
  return BLOCKED(403,'Origem inválida');
 if(!req.headers.get('content-type')?.startsWith('application/json'))
  return BLOCKED(415,'Formato inválido');
 const raw=await req.text().catch(()=>'');
 if(!raw||raw.length>180)return BLOCKED(400,'Dados inválidos');
 let obj:unknown;try{obj=JSON.parse(raw);}catch{return BLOCKED(400,'Dados inválidos');}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))
  return BLOCKED(400,'Operação inválida');
 const data=obj as Record<string,unknown>;
 if(Object.keys(data).length!==2||data.confirmRealInstagramAction!==true||
    !['launch-one','inspect'].includes(String(data.operation)))
  return BLOCKED(400,'Confirmação explícita necessária');
 const account=await scope();
 if(!account)return BLOCKED(403,'Operador não autorizado');
 if(data.operation==='inspect'){
  const latest=await candidatePlan(account);
  const row=latest.existing;
  const previous=parseReceipt(row?.details);
  if(!row||!previous||previous.accountId!==account.id)
   return BLOCKED(409,'Nenhuma tentativa rastreável');
  if(previous.state!=='launched'||!previous.runId)
   return NextResponse.json(publicReadiness(account,latest),{headers:HEADERS});
  const result=await inspectOneFollow(
   process.env.APIFY_API_TOKEN,previous.runId,previous.targetUsername);
  if(result.status==='running'||result.status==='unavailable')
   return NextResponse.json({status:result.status,costUsd:result.costUsd,
    providerReportedFollow:false,followIndependentlyVerified:false,
    instagramActionsConfirmed:0},{headers:HEADERS});
  const next:Receipt={...previous,state:result.status,
   costUsd:result.costUsd,providerReportedFollow:result.providerReportedFollow};
  const changed=await prisma.activityLog.updateMany({
   where:{id:row.id,instagramAccountId:account.id,
    action:ACTION,details:row.details,success:false},
   data:{details:JSON.stringify(next),success:false},
  }).catch(()=>null);
  if(changed?.count!==1)return BLOCKED(409,'Consulta simultânea ou indisponível');
  return NextResponse.json({
   status:next.state,costUsd:next.costUsd,
   targetUsername:next.targetUsername,
   providerReportedFollow:next.providerReportedFollow,
   followIndependentlyVerified:false,unfollowEnabled:false,
   instagramActionsConfirmed:0,
  },{headers:HEADERS});
 }
 // One explicit click, one durable serializable claim and one POST to Apify
 // max. Never retry a failed/unknown/ambiguous launch automatically.
 const readiness=await candidatePlan(account);
 if(!eligible(account,readiness)||!readiness.plan?.next)
  return BLOCKED(409,'Conta ou fila ainda não apta para o teste real');
 const selected=readiness.plan.next;
 const receipt:Receipt={
  version:1,state:'reserved',actor:APIFY_ONE_FOLLOW_ACTOR,
  accountId:account.id,accountInstagramUserId:ACCOUNT_ID,
  sourceReference:selected.referenceUsername,
  targetUsername:selected.username,runId:null,
  maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
  costUsd:null,providerReportedFollow:false,independentlyVerified:false,
  automatedUnfollowEnabled:false,
 };
 const saved=JSON.stringify(receipt);
 let claim:{id:string}|null=null;
 try{
  claim=await prisma.$transaction(async tx=>{
   const latest=await tx.instagramAccount.findUnique({
    where:{id:account.id},select:{status:true,cooldownUntil:true,
      instagramUserId:true},
   });
   if(!latest||latest.status!=='active'||
      latest.instagramUserId!==ACCOUNT_ID||
      (latest.cooldownUntil&&latest.cooldownUntil.getTime()>=Date.now()))
    return null;
   if(await tx.activityLog.findFirst({
     where:{instagramAccountId:account.id,action:ACTION},select:{id:true},
   }))return null;
   return await tx.activityLog.create({
    data:{instagramAccountId:account.id,action:ACTION,
      targetUsername:selected.username,success:false,details:saved},
    select:{id:true},
   });
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }catch{return BLOCKED(409,'Reserva concorrente; não repetir automaticamente');}
 if(!claim)return BLOCKED(409,'Já existe tentativa ou a conta ficou inativa');
 const result=await startOneFollow(
  process.env.APIFY_API_TOKEN,
  process.env.APIFY_INSTAGRAM_COOKIES_JSON,
  selected.username,
  {instagramUserId:ACCOUNT_ID,username:account.username,
   previousUsernames:[OLD_ALIAS]});
 const next:Receipt={...receipt,
  state:result.status==='queued'?'launched':
    result.status==='refused'?'rejected':'unconfirmed',
  runId:result.runId,
 };
 // A launch may have happened even if this receipt update fails. NEVER retry.
 const written=await prisma.activityLog.updateMany({
  where:{id:claim.id,instagramAccountId:account.id,
   action:ACTION,details:saved,success:false},
  data:{details:JSON.stringify(next),success:false},
 }).catch(()=>null);
 return NextResponse.json({
  status:written?.count===1?next.state:'unconfirmed',
  targetUsername:written?.count===1?next.targetUsername:null,
  actorRunsLaunched:result.status==='queued'?1:0,
  instagramActionsConfirmed:0,
  followIndependentlyVerified:false,
  automatedUnfollowEnabled:false,mayRetryAutomatically:false,
  maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
 },{headers:HEADERS});
}
