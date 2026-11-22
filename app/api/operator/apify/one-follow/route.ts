export const dynamic='force-dynamic';
export const runtime='nodejs';

import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {
 APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_ACTION,APIFY_ONE_FOLLOW_MAX_USD,
 parseMinimalInstagramCookies,startOneFollow,inspectOneFollow,
} from '@/lib/providers/apify-one-follow';
import {inspectApifySocialActors} from '@/lib/providers/apify-social-actors-readiness';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const TARGET='contateste6699';
const ACCOUNT='apoistecnologia';
const CONFIRM='CONFIRMO UM FOLLOW REAL NO INSTAGRAM';
const denied=(status:number,message:string)=>NextResponse.json({
  status:'blocked',error:message,instagramActionsConfirmed:0,
},{status,headers});

type Attempt={
  version:1;state:'reserved'|'launched'|'unconfirmed'|'rejected'|
    'provider-reported'|'provider-rejected'|'provider-blocked'|
    'failed'|'ambiguous';
  actor:typeof APIFY_ONE_FOLLOW_ACTOR;accountId:string;
  accountUsername:typeof ACCOUNT;targetUsername:typeof TARGET;
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
     a.accountUsername!==ACCOUNT||a.targetUsername!==TARGET||
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
    where:{userId:uid,username:ACCOUNT},
    select:{id:true,username:true,instagramUserId:true,
      status:true,cooldownUntil:true},take:2,
  });
  if(accounts.length!==1)return null;
  return accounts[0];
}
const allowedAccount=(a:NonNullable<Awaited<ReturnType<typeof scope>>>):boolean=>
  !!a.instagramUserId&&!['banned','checkpoint','cooldown'].includes(a.status)&&
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
    account:ACCOUNT,target:TARGET,configured:!disabled,
    cookieConfigured:cookieReady,accountReady,
    canLaunch:!disabled&&cookieReady&&accountReady&&!row,
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

export async function POST(req:Request){
  if(!oneShotEnabled())return denied(403,'Teste real não habilitado no Preview');
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
  const operation=value.operation;
  const launch=operation==='launch-one';
  if((!launch&&operation!=='inspect')||
     Object.keys(value).length!==(launch?3:1)||
     (launch&&(value.accountConfirmation!==ACCOUNT||
        value.approval!==CONFIRM)))
    return denied(400,'Operação ou confirmação inválida');
  const account=await scope();
  if(!account||!allowedAccount(account))
    return denied(409,'Conta sem elegibilidade para teste controlado');
  const token=process.env.APIFY_API_TOKEN;
  if(!token)return denied(409,'Apify não configurada');
  const row=await prisma.activityLog.findFirst({
    where:{instagramAccountId:account.id,action:APIFY_ONE_FOLLOW_ACTION},
    select:{id:true,details:true},orderBy:{createdAt:'desc'},
  });

  if(launch){
    if(!hasValidCookies())return denied(409,
      'Cookie de sessão não cadastrado em segredo na Vercel');
    if(row)return denied(409,'Uma tentativa já foi registrada; sem repetição');
    const [protectedProfile,previousReal]=await Promise.all([
      prisma.whitelist.findUnique({
        where:{instagramAccountId_username:{
          instagramAccountId:account.id,username:TARGET,
        }},select:{id:true},
      }),
      prisma.followAction.count({
        where:{instagramAccountId:account.id,targetUsername:TARGET,isDryRun:false},
      }),
    ]);
    if(protectedProfile||previousReal>0)
      return denied(409,'Destino protegido ou com ação anterior');
    // Verify the exact Actor remains public and limited-permission before
    // transmitting the operator's session to a third-party executor.
    const inspected=await inspectApifySocialActors(token);
    if(inspected.combined.status!=='listed'||
       inspected.combined.permissions!=='limited')
      return denied(409,'Actor não corresponde à configuração de segurança');
    let reservation:{id:string;receipt:Attempt}|null=null;
    try{
      reservation=await prisma.$transaction(async tx=>{
        const lock=await tx.$queryRaw<Array<{acquired:boolean}>>`
          SELECT pg_try_advisory_xact_lock(
            hashtext('apify_one_social_action_v1'),
            hashtext(${account.id})
          ) AS acquired
        `;
        if(lock.length!==1||lock[0].acquired!==true)return null;
        const prior=await tx.activityLog.findFirst({
          where:{instagramAccountId:account.id,
            action:APIFY_ONE_FOLLOW_ACTION},select:{id:true},
        });
        if(prior)return null;
        const receipt:Attempt={
          version:1,state:'reserved',actor:APIFY_ONE_FOLLOW_ACTOR,
          accountId:account.id,accountUsername:ACCOUNT,
          targetUsername:TARGET,runId:null,maxActionsPerRun:1,
          maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD,costUsd:null,
          providerReportedFollow:false,independentlyVerified:false,
          automatedUnfollowEnabled:false,
        };
        const created=await tx.activityLog.create({data:{
          instagramAccountId:account.id,action:APIFY_ONE_FOLLOW_ACTION,
          targetUsername:TARGET,success:false,
          details:JSON.stringify(receipt),
        },select:{id:true}});
        return {id:created.id,receipt};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    }catch{return denied(503,'Não foi possível reservar tentativa');}
    if(!reservation)return denied(409,'Tentativa já registrada ou em andamento');
    // One and only one possible remote write. Ambiguous result never retried.
    const started=await startOneFollow(token,
      process.env.APIFY_INSTAGRAM_COOKIES_JSON,TARGET);
    const updated:Attempt={
      ...reservation.receipt,
      state:started.status==='queued'?'launched':started.status==='refused'?
        'rejected':'unconfirmed',runId:started.runId,
    };
    await prisma.activityLog.updateMany({where:{
      id:reservation.id,instagramAccountId:account.id,
      action:APIFY_ONE_FOLLOW_ACTION,
      details:JSON.stringify(reservation.receipt),
    },data:{details:JSON.stringify(updated)}}).catch(()=>undefined);
    return NextResponse.json({
      status:started.status==='queued'?'launch-request-accepted':updated.state,
      actorRunId:started.runId,
      followConfirmed:false,mayRetryAutomatically:false,
      unfollowScheduled:false,oneFollowMax:true,
    },{status:started.status==='queued'?202:503,headers});
  }

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
  const outcome=await inspectOneFollow(token,previous.runId,TARGET);
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
