export const dynamic='force-dynamic';
export const runtime='nodejs';

import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {AUDIENCE_CANDIDATE_ACTION,MAX_QUEUE_ENTRIES_PER_SYNC} from
  '@/lib/reference-candidate-queue';
import {
  FOLLOW_PREVIEW_CONTROL_ACTION,countPreviewEligible,makeFollowPreviewEvent,
  parseFollowPreviewEvent,transitionFollowPreview,
  type FollowPreviewEvent,type FollowPreviewOperation,
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
      where:{instagramAccountId:account.id,enabled:true},
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
  return countPreviewEligible(candidates,refs,account.username,
    whitelist.map(x=>x.username),prior.map(x=>x.targetUsername));
}
const toState=(event:FollowPreviewEvent|null)=>
  event?.state??'idle';

export async function GET(request:Request){
  const ctx=await ownedAccount(new URL(request.url).searchParams.get('accountId'));
  if('error' in ctx)return error(ctx.error??'Não autorizado',ctx.code??403);
  const account=ctx.account;
  const [counts,last]=await Promise.all([
    eligibleForAccount(prisma,account),
    prisma.activityLog.findFirst({
      where:{instagramAccountId:account.id,action:FOLLOW_PREVIEW_CONTROL_ACTION},
      select:{details:true,createdAt:true},
      orderBy:[{createdAt:'desc'},{id:'desc'}],
    }),
  ]);
  if(!counts)return error('Limite de histórico para simulação excedido',409);
  const event=last?parseFollowPreviewEvent(last.details):null;
  if(last&&!event)return error('Histórico de controle exige revisão',409);
  return NextResponse.json({
    accountId:account.id,state:toState(event),
    candidateCount:counts.indexed,eligibleCount:counts.eligible,
    excludedCount:counts.excluded,lastChangedAt:event?.createdAt??null,
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
     !['start','pause','resume','stop'].includes(String(body.operation)))
    return error('Operação não permitida',400);
  const ctx=await ownedAccount(body.accountId);
  if('error' in ctx)return error(ctx.error??'Não autorizado',ctx.code??403);
  const account=ctx.account;
  const operation=body.operation as FollowPreviewOperation;
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
      const latest=await tx.activityLog.findFirst({
        where:{instagramAccountId:account.id,action:FOLLOW_PREVIEW_CONTROL_ACTION},
        select:{details:true},orderBy:[{createdAt:'desc'},{id:'desc'}],
      });
      const existing=latest?parseFollowPreviewEvent(latest.details):null;
      if(latest&&!existing)return {status:'review-required' as const};
      const next=transitionFollowPreview(existing?.state??'idle',operation);
      if(!next||next==='idle')return {status:'invalid-transition' as const};
      const counts=await eligibleForAccount(tx,account);
      if(!counts)return {status:'capacity-exceeded' as const};
      if(next==='simulating'&&counts.eligible===0)
        return {status:'no-eligible-candidates' as const};
      const event=makeFollowPreviewEvent(next,
        (existing?.revision??0)+1,counts.eligible,new Date().toISOString());
      if(!event)return {status:'invalid-event' as const};
      await tx.activityLog.create({data:{
        instagramAccountId:account.id,
        action:FOLLOW_PREVIEW_CONTROL_ACTION,
        details:JSON.stringify(event),success:true,
      }});
      return {status:'ok' as const,event,counts};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
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
