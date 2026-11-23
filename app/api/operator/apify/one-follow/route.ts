export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {
 APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_ACTION,APIFY_ONE_FOLLOW_MAX_USD,
 parseMinimalInstagramCookies,inspectOneFollow,
} from '@/lib/providers/apify-one-follow';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
// Historical username: this is the SAME Instagram identity as @apoistecnologia.
 // Only the pre-existing run may be inspected; never use it as a new target.
const LEGACY_TARGET='contateste6699';
const ACCOUNT='apoistecnologia';
const ACCOUNT_INSTAGRAM_USER_ID='17841411544892772';
const denied=(status:number,message:string)=>NextResponse.json({
  status:'blocked',error:message,instagramActionsConfirmed:0,
},{status,headers});

type Attempt={
  version:1;state:'reserved'|'launched'|'unconfirmed'|'rejected'|
    'provider-reported'|'provider-rejected'|'provider-blocked'|
    'failed'|'ambiguous';
  actor:typeof APIFY_ONE_FOLLOW_ACTOR;accountId:string;
  accountUsername:typeof ACCOUNT;targetUsername:typeof LEGACY_TARGET;
  runId:string|null;maxActionsPerRun:1;maxTotalChargeUsd:0.25;
  costUsd:number|null;providerReportedFollow:boolean;
  independentlyVerified:false;automatedUnfollowEnabled:false;
};
function parseAttempt(raw:unknown):Attempt|null{
  if(typeof raw!=='string'||raw.length>1200)return null;
  let v:unknown;
  try{v=JSON.parse(raw);}catch{return null;}
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const a=v as Record<string,unknown>;
  if(Object.keys(a).length!==13||a.version!==1||
     !['reserved','launched','unconfirmed','rejected',
       'provider-reported','provider-rejected','provider-blocked',
       'failed','ambiguous'].includes(String(a.state))||
     a.actor!==APIFY_ONE_FOLLOW_ACTOR||
     typeof a.accountId!=='string'||a.accountId.length>100||
     a.accountUsername!==ACCOUNT||a.targetUsername!==LEGACY_TARGET||
     (a.runId!==null&&(typeof a.runId!=='string'||
       !/^[A-Za-z0-9]{17,24}$/.test(a.runId)))||
     a.maxActionsPerRun!==1||a.maxTotalChargeUsd!==APIFY_ONE_FOLLOW_MAX_USD||
     (a.costUsd!==null&&(typeof a.costUsd!=='number'||
       !Number.isFinite(a.costUsd)||a.costUsd<0))||
     typeof a.providerReportedFollow!=='boolean'||
     a.independentlyVerified!==false||a.automatedUnfollowEnabled!==false)
    return null;
  return a as Attempt;
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
    where:{userId:uid,instagramUserId:ACCOUNT_INSTAGRAM_USER_ID},
    select:{id:true,username:true,instagramUserId:true,
      status:true,cooldownUntil:true},take:2,
  });
  if(accounts.length!==1)return null;
  return accounts[0];
}
const allowedAccount=(a:NonNullable<Awaited<ReturnType<typeof scope>>>):boolean=>
  // Only an explicitly active DB connection is eligible. Inactive/unknown
  // states must NOT be shown as proof that an Instagram session works.
  !!a.instagramUserId&&a.status==='active'&&
  (!a.cooldownUntil||a.cooldownUntil.getTime()<Date.now());
const oneShotEnabled=()=>process.env.VERCEL_ENV==='preview'&&
  process.env.PREVIEW_APIFY_ONE_FOLLOW_ENABLED==='yes';
const hasValidCookies=()=>parseMinimalInstagramCookies(
  process.env.APIFY_INSTAGRAM_COOKIES_JSON)!==null;

/** Readiness and receipt only. Never reads cookie values into response. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')return denied(403,'Somente Preview');
  const account=await scope();
  if(!account)return denied(403,'Operador ou conta não autorizado');
  const row=await prisma.activityLog.findFirst({
    where:{instagramAccountId:account.id,action:APIFY_ONE_FOLLOW_ACTION},
    select:{details:true,createdAt:true},orderBy:{createdAt:'desc'},
  });
  const attempt=parseAttempt(row?.details);
  const disabled=!oneShotEnabled();
  const cookieReady=hasValidCookies();
  const accountReady=allowedAccount(account);
  return NextResponse.json({
    status:attempt?.state??'not-started',
    account:account.username,target:null,
    invalidLegacyTarget:!!row,
    legacyTargetUsername:attempt?.targetUsername??null,
    legacyConfigurationError:row?'self-follow-to-previous-username':null,
    configured:!disabled,
    cookieConfigured:cookieReady,accountReady,
    canLaunch:false,
    canInspect:!!attempt?.runId&&attempt.state==='launched',
    providerReportedFollow:attempt?.providerReportedFollow??false,
    followIndependentlyVerified:false,
    unfollowEnabled:false,unfollowScheduled:false,
    maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,
    costUsd:attempt?.costUsd??null,
    actorRunsExecutedByThisRequest:0,
    instagramActionsConfirmedByThisRequest:0,
  },{headers});
}

/** Existing-run reconciliation ONLY. Launch is suspended after a self-target
 * configuration mistake. This preserves the original immutable audit receipt,
 * including unknown remote execution outcomes and nonzero possible costs.
 */
export async function POST(req:Request){
  if(process.env.VERCEL_ENV!=='preview')
    return denied(403,'Somente Preview');
  if(req.headers.get('origin')!==new URL(req.url).origin)
    return denied(403,'Origem inválida');
  if(!req.headers.get('content-type')?.startsWith('application/json'))
    return denied(415,'Formato inválido');
  const raw=await req.text().catch(()=>'');
  if(!raw||raw.length>220)return denied(400,'Dados inválidos');
  let body:unknown;
  try{body=JSON.parse(raw);}catch{return denied(400,'Dados inválidos');}
  if(!body||typeof body!=='object'||Array.isArray(body))
    return denied(400,'Dados inválidos');
  const value=body as Record<string,unknown>;
  if(value.operation==='launch-one')
    return denied(409,'Teste bloqueado: o destino anterior é a própria conta. Nenhum novo follow será iniciado.');
  if(value.operation!=='inspect'||Object.keys(value).length!==1)
    return denied(400,'Operação inválida');

  const account=await scope();
  // A disabled/inactive Instagram connection must not prevent read-only
  // reconciliation of a previously launched Apify run.
  if(!account)return denied(403,'Operador ou conta não autorizado');
  const token=process.env.APIFY_API_TOKEN;
  if(!token)return denied(409,'Apify não configurada');
  const row=await prisma.activityLog.findFirst({
    where:{instagramAccountId:account.id,action:APIFY_ONE_FOLLOW_ACTION},
    select:{id:true,details:true},orderBy:{createdAt:'desc'},
  });
  const previous=parseAttempt(row?.details);
  if(!row||!previous||previous.accountId!==account.id)
    return denied(409,'Nenhuma tentativa rastreável');
  if(previous.state!=='launched'||!previous.runId)
    return NextResponse.json({
      status:previous.state,
      providerReportedFollow:previous.providerReportedFollow,
      followIndependentlyVerified:false,unfollowEnabled:false,
      costUsd:previous.costUsd,
    },{headers});
  const outcome=await inspectOneFollow(token,previous.runId,previous.targetUsername);
  if(outcome.status==='running'||outcome.status==='unavailable')
    return NextResponse.json({
      status:outcome.status,providerReportedFollow:false,
      followIndependentlyVerified:false,unfollowEnabled:false,
    },{headers});
  const next:Attempt={...previous,
    state:outcome.status==='provider-reported'?'provider-reported':
      outcome.status==='provider-rejected'?'provider-rejected':
        outcome.status==='provider-blocked'?'provider-blocked':
          outcome.status==='failed'?'failed':'ambiguous',
    costUsd:outcome.costUsd,
    providerReportedFollow:outcome.providerReportedFollow,
  };
  try{
    const changed=await prisma.activityLog.updateMany({where:{
      id:row.id,details:row.details,instagramAccountId:account.id,
      action:APIFY_ONE_FOLLOW_ACTION,
    },data:{details:JSON.stringify(next),success:false}});
    if(changed.count!==1)return denied(409,'Consulta simultânea; atualizar');
  }catch{return denied(503,'Resultado não pôde ser registrado');}
  return NextResponse.json({
    status:next.state,providerReportedFollow:next.providerReportedFollow,
    followIndependentlyVerified:false,unfollowEnabled:false,
    costUsd:next.costUsd,mayRetryAutomatically:false,
  },{headers});
}
