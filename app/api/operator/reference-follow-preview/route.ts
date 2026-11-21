export const dynamic='force-dynamic';
export const runtime='nodejs';

import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {AUDIENCE_CANDIDATE_ACTION,MAX_QUEUE_ENTRIES_PER_SYNC} from
  '@/lib/reference-candidate-queue';
import {
  FOLLOW_PREVIEW_CONTROL_ACTION,FOLLOW_PREVIEW_DECISION_ACTION,
  FOLLOW_PREVIEW_BATCH_SIZE,FOLLOW_PREVIEW_BATCH_MIN_MS,FOLLOW_PREVIEW_MAX_CONTROLS,
  planPreviewEligible,makeFollowPreviewEvent,makePreviewDecision,
  parsePreviewDecision,parseFollowPreviewEvent,
  resolvePreviewRun,transitionFollowPreview,
  type FollowPreviewOperation,type PreviewCandidate,
} from '@/lib/reference-follow-preview-control';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const error=(message:string,status:number)=>NextResponse.json({error:message},
  {status,headers:HEADERS});
const previewOnly=()=>process.env.VERCEL_ENV==='preview'&&
  process.env.PHANTOMBUSTER_READONLY_ENABLED==='yes';

async function ownedAccount(accountId:unknown){
  if(!previewOnly())return {error:'Controle disponível somente no Preview',code:403} as const;
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return {error:'Não autorizado',code:401} as const;
  if(typeof accountId!=='string'||accountId.length>100||!accountId)
    return {error:'Conta inválida',code:400} as const;
  const account=await prisma.instagramAccount.findFirst({
    where:{id:accountId,userId},select:{id:true,username:true},
  });
  if(!account)return {error:'Conta não encontrada',code:404} as const;
  return {account} as const;
}
type Account={id:string;username:string};
async function eligibleForAccount(db:Prisma.TransactionClient|typeof prisma,
  account:Account){
  const [candidates,refs,whitelist,prior]=await Promise.all([
    db.activityLog.findMany({
      where:{instagramAccountId:account.id,action:AUDIENCE_CANDIDATE_ACTION},
      select:{targetUsername:true,details:true},
      take:MAX_QUEUE_ENTRIES_PER_SYNC+1,
    }),
    db.targetAccount.findMany({
      // Simulation only: references are intentionally registered with
      // enabled=false to prevent social actions. Match the read-only
      // candidate index by account ownership and current reference ID.
      // NEVER use these results to authorize a real follow.
      where:{instagramAccountId:account.id},
      select:{id:true,username:true},take:101,
    }),
    db.whitelist.findMany({
      where:{instagramAccountId:account.id},
      select:{username:true},take:2001,
    }),
    db.followAction.findMany({
      where:{instagramAccountId:account.id,isDryRun:false},
      select:{targetUsername:true},take:2001,
    }),
  ]);
  if(candidates.length>MAX_QUEUE_ENTRIES_PER_SYNC||refs.length>100||
     whitelist.length>2000||prior.length>2000)return null;
  const result=planPreviewEligible(candidates,refs,account.username,
    whitelist.map(x=>x.username),prior.map(x=>x.targetUsername));
  return {...result,eligible:result.candidates.length};
}
const MAX_DECISIONS=2000;
async function readRun(db:Prisma.TransactionClient|typeof prisma,accountId:string){
  const controls=await db.activityLog.findMany({
    where:{instagramAccountId:accountId,action:FOLLOW_PREVIEW_CONTROL_ACTION},
    select:{id:true,details:true},
    orderBy:[{createdAt:'asc'},{id:'asc'}],
    take:FOLLOW_PREVIEW_MAX_CONTROLS+1,
  });
  if(controls.length>FOLLOW_PREVIEW_MAX_CONTROLS)return null;
  const run=resolvePreviewRun(controls);
  if(!run)return null;
  const latest=controls.at(-1);
  const event=latest?parseFollowPreviewEvent(latest.details):null;
  return {...run,lastChangedAt:event?.createdAt??null};
}
type SavedDecision={targetUsername:string|null;details:string|null;createdAt:Date};
async function readRunDecisions(
  db:Prisma.TransactionClient|typeof prisma,accountId:string,runId:string|null,
):Promise<SavedDecision[]|null>{
  if(!runId)return [];
  const rows=await db.activityLog.findMany({
    where:{instagramAccountId:accountId,action:FOLLOW_PREVIEW_DECISION_ACTION,
      details:{contains:'"runId":"'+runId+'"'}},
    select:{targetUsername:true,details:true,createdAt:true},
    orderBy:[{createdAt:'asc'},{id:'asc'}],take:MAX_DECISIONS+1,
  });
  if(rows.length>MAX_DECISIONS||rows.some(row=>{
    const event=parsePreviewDecision(row.details);
    return !event||event.runId!==runId||!row.targetUsername||
      !/^[a-z0-9._]{1,30}$/.test(row.targetUsername);
  }))return null;
  return rows;
}
function summarizeDecisions(
  records:readonly SavedDecision[],candidates:readonly PreviewCandidate[],
){
  const byName=new Map(candidates.map(c=>[c.username,c]));
  const used=new Set<string>();
  const recent:string[]=[];
  for(const row of records){
    const event=parsePreviewDecision(row.details);
    const candidate=byName.get(row.targetUsername??'');
    if(!event||!candidate||event.referenceId!==candidate.referenceId||
      event.referenceUsername!==candidate.referenceUsername||
      used.has(candidate.username))continue;
    used.add(candidate.username);
    recent.push(candidate.username);
  }
  return {simulatedCount:used.size,remainingCount:candidates.length-used.size,
    recentSimulated:recent.slice(-5).reverse(),
    used};
}

export async function GET(request:Request){
  const ctx=await ownedAccount(new URL(request.url).searchParams.get('accountId'));
  if('error' in ctx)return error(ctx.error??'Não autorizado',ctx.code??403);
  const account=ctx.account;
  const [counts,run]=await Promise.all([
    eligibleForAccount(prisma,account),readRun(prisma,account.id),
  ]);
  if(!counts)return error('Limite de histórico para simulação excedido',409);
  if(!run)return error('Histórico de controle exige revisão',409);
  const decisions=await readRunDecisions(prisma,account.id,run.runId);
  if(!decisions)return error('Histórico de decisões exige revisão',409);
  const summary=summarizeDecisions(decisions,counts.candidates);
  return NextResponse.json({
    accountId:account.id,state:run.state,
    candidateCount:counts.indexed,eligibleCount:counts.eligible,
    excludedCount:counts.excluded,lastChangedAt:run.lastChangedAt,
    simulatedCount:summary.simulatedCount,
    remainingCount:summary.remainingCount,
    recentSimulated:summary.recentSimulated,
    simulationComplete:run.runId!==null&&summary.remainingCount===0,
    mode:'simulation',realFollowsEnabled:false,realUnfollowsEnabled:false,
    liveFollowAvailable:false,instagramActionsExecuted:0,
    blocker:'Follows reais indisponíveis até validar a integração e cessar a restrição do Instagram.',
  },{headers:HEADERS});
}

export async function POST(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin)
    return error('Origem inválida',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))
    return error('Formato inválido',415);
  const raw=await request.text().catch(()=>'');
  if(!raw||raw.length>250)return error('Dados inválidos',400);
  let parsed:unknown;
  try{parsed=JSON.parse(raw) as unknown;}catch{return error('JSON inválido',400);}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    return error('Dados inválidos',400);
  const body=parsed as Record<string,unknown>;
  if(Object.keys(body).sort().join('|')!=='accountId|operation'||
     !['start','pause','resume','stop','tick'].includes(String(body.operation)))
    return error('Operação não permitida',400);
  const ctx=await ownedAccount(body.accountId);
  if('error' in ctx)return error(ctx.error??'Não autorizado',ctx.code??403);
  const account=ctx.account;
  const operation=body.operation as FollowPreviewOperation|'tick';
  try{
    const result=await prisma.$transaction(async tx=>{
      // One persistent state transition at a time for this owned account.
      const locks=await tx.$queryRaw<Array<{acquired:boolean}>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext('reference_follow_preview_control_v1'),
          hashtext(${account.id})
        ) AS acquired
      `;
      if(locks.length!==1||locks[0].acquired!==true)
        return {status:'busy' as const};
      const run=await readRun(tx,account.id);
      if(!run)return {status:'review-required' as const};
      if(operation==='tick'){
        if(run.state!=='simulating'||!run.runId)
          return {status:'not-running' as const};
        const counts=await eligibleForAccount(tx,account);
        if(!counts)return {status:'capacity-exceeded' as const};
        const records=await readRunDecisions(tx,account.id,run.runId);
        if(!records)return {status:'review-required' as const};
        const summary=summarizeDecisions(records,counts.candidates);
        if(summary.remainingCount===0)
          return {status:'complete' as const,
            simulatedCount:summary.simulatedCount,
            remainingCount:0,eligibleCount:counts.eligible};
        const lastDecision=records.at(-1);
        if(lastDecision&&Date.now()-lastDecision.createdAt.getTime()<
           FOLLOW_PREVIEW_BATCH_MIN_MS)
          return {status:'throttled' as const,
            simulatedCount:summary.simulatedCount,
            remainingCount:summary.remainingCount,
            eligibleCount:counts.eligible};
        const pending=counts.candidates.filter(x=>!summary.used.has(x.username))
          .slice(0,FOLLOW_PREVIEW_BATCH_SIZE);
        for(const candidate of pending){
          const event=makePreviewDecision(run.runId,candidate.referenceId,
            candidate.referenceUsername);
          if(!event)return {status:'review-required' as const};
          await tx.activityLog.create({data:{
            instagramAccountId:account.id,targetUsername:candidate.username,
            action:FOLLOW_PREVIEW_DECISION_ACTION,
            details:JSON.stringify(event),success:true,
          }});
        }
        return {status:'advanced' as const,
          simulatedCount:summary.simulatedCount+pending.length,
          remainingCount:summary.remainingCount-pending.length,
          eligibleCount:counts.eligible};
      }
      const next=transitionFollowPreview(run.state,operation);
      if(!next||next==='idle')return {status:'invalid-transition' as const};
      const counts=await eligibleForAccount(tx,account);
      if(!counts)return {status:'capacity-exceeded' as const};
      if(next==='simulating'&&counts.eligible===0)
        return {status:'no-eligible-candidates' as const};
      const event=makeFollowPreviewEvent(next,
        run.revision+1,counts.eligible,new Date().toISOString());
      if(!event)return {status:'invalid-event' as const};
      await tx.activityLog.create({data:{
        instagramAccountId:account.id,
        action:FOLLOW_PREVIEW_CONTROL_ACTION,
        details:JSON.stringify(event),success:true,
      }});
      return {status:'ok' as const,event,counts};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    if(result.status==='advanced'||result.status==='throttled'||
       result.status==='complete')
      return NextResponse.json({
        status:result.status,simulatedCount:result.simulatedCount,
        remainingCount:result.remainingCount,eligibleCount:result.eligibleCount,
        mode:'simulation',instagramActionsExecuted:0,
      },{headers:HEADERS});
    if(result.status!=='ok')return error(
      result.status==='no-eligible-candidates'
        ?'Não há candidatos elegíveis para o teste':'Controle não alterado: '+result.status,
      409);
    return NextResponse.json({
      status:'saved',state:result.event.state,
      eligibleCount:result.counts.eligible,
      excludedCount:result.counts.excluded,
      mode:'simulation',instagramActionsExecuted:0,
      realFollowsEnabled:false,realUnfollowsEnabled:false,
    },{headers:HEADERS});
  }catch{return error('Conflito de gravação: tente consultar o estado novamente',503);}
}
