export const dynamic='force-dynamic';
export const runtime='nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { inspectFollowersAutoFollowAgent } from '@/lib/providers/phantombuster-followers-auto-follow';
import {
  launchFollowersTrial,inspectTrialContainer,
} from '@/lib/providers/phantombuster-followers-trial';
import {
  FOLLOWERS_TRIAL_ACTION,FOLLOWERS_TRIAL_APPROVAL,
  makeTrialEvidence,parseTrialEvidence,
} from '@/lib/reference-followers-trial';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';

const HEADERS={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
function fail(error:string,status:number) {
  return NextResponse.json({error},{status,headers:HEADERS});
}
async function scope(){
  const session=await auth();
  const uid=(session?.user as {id?:string}|undefined)?.id;
  if(!uid)return null;
  const user=await prisma.user.findUnique({where:{id:uid},select:{role:true}});
  if(user?.role!=='admin')return null;
  const accountName=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??'';
  const referenceName=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE??'';
  const agentId=process.env.PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID??'';
  const apiKey=process.env.PHANTOMBUSTER_API_KEY;
  if(!/^[a-z0-9._]{1,30}$/.test(accountName)||
     !/^[a-z0-9._]{1,30}$/.test(referenceName)||
     !/^\d{10,25}$/.test(agentId)||!isConfiguredPhantomBusterKey(apiKey))
    return null;
  const account=await prisma.instagramAccount.findFirst({
    where:{userId:uid,username:accountName},select:{id:true,username:true},
  });
  if(!account)return null;
  const reference=await prisma.targetAccount.findFirst({
    where:{instagramAccountId:account.id,username:referenceName},select:{id:true},
  });
  if(!reference)return null;
  return {uid,account,reference,referenceName,agentId,apiKey};
}
const safeAttempt=(a:{
 id:string;details:string|null;createdAt:Date;success:boolean;
}|null)=>{
  const evidence=parseTrialEvidence(a?.details);
  return evidence?{
    stage:evidence.stage, requestedAt:a?.createdAt.toISOString()??null,
    followConfirmed:false,recipientKnown:false,
    mayRetryAutomatically:false,
  }:a?{
    stage:'uncertain',requestedAt:a.createdAt.toISOString(),
    followConfirmed:false,recipientKnown:false,mayRetryAutomatically:false,
  }:null;
};

/** Read already persisted state; never initiates a provider request. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')return fail('Somente Preview',403);
  const ctx=await scope();
  if(!ctx)return fail('Operador ou conta de teste não autorizados',403);
  const last=await prisma.activityLog.findFirst({
    where:{instagramAccountId:ctx.account.id,action:FOLLOWERS_TRIAL_ACTION},
    select:{id:true,details:true,createdAt:true,success:true},
    orderBy:[{createdAt:'desc'},{id:'desc'}],
  });
  return NextResponse.json({
    enabled:process.env.PHANTOMBUSTER_FOLLOWERS_ONE_SHOT_ENABLED==='yes',
    accountName:ctx.account.username,
    referenceRegistered:true,
    attempted:!!last,attempt:safeAttempt(last),
    sessionOwnerVerifiedByProvider:false,followConfirmed:false,
    unfollowEnabled:false,
  },{headers:HEADERS});
}

export async function POST(req:Request){
  if(process.env.VERCEL_ENV!=='preview')return fail('Somente Preview',403);
  if(req.headers.get('origin')!==new URL(req.url).origin)
    return fail('Origem inválida',403);
  if(!req.headers.get('content-type')?.startsWith('application/json'))
    return fail('Formato inválido',415);
  const raw=await req.text().catch(()=>'');
  if(!raw||raw.length>250)return fail('Dados inválidos',400);
  let decoded:unknown;
  try{decoded=JSON.parse(raw) as unknown;}catch{decoded=null;}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))
    return fail('Dados inválidos',400);
  const input=decoded as Record<string,unknown>;
  const operation=input.operation;
  const allowed=operation==='launch-one'?
    ['operation','approval','accountConfirmation']:
    operation==='check-result'?['operation']:[];
  if(!allowed.length||Object.keys(input).length!==allowed.length||
    Object.keys(input).some(k=>!allowed.includes(k)))
    return fail('Operação inválida',400);
  const ctx=await scope();
  if(!ctx)return fail('Operador ou conta de teste não autorizados',403);

  if(operation==='launch-one'){
    if(process.env.PHANTOMBUSTER_FOLLOWERS_ONE_SHOT_ENABLED!=='yes')
      return fail('Teste real não habilitado no Preview',403);
    if(input.approval!==FOLLOWERS_TRIAL_APPROVAL||
      input.accountConfirmation!==ctx.account.username)
      return fail('Confirmação da conta inválida',400);

    const check=await inspectFollowersAutoFollowAgent(
      ctx.apiKey,ctx.agentId,ctx.referenceName);
    if(check!=='matched')
      return fail('Agente deixou de corresponder à referência/limite',409);
    // Reserve BEFORE any request that could make a real follow. An ambiguous
    // launch is never retried, including after network/database failures.
    let claim:string|null=null;
    for(let n=0;n<3;n++){
      try{
        claim=await prisma.$transaction(async tx=>{
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(17320, 20261122)`;
          const existing=await tx.activityLog.count({where:{
            instagramAccountId:ctx.account.id,action:FOLLOWERS_TRIAL_ACTION,
          }});
          if(existing!==0)return null;
          const owner=await tx.instagramAccount.findFirst({where:{
            id:ctx.account.id,userId:ctx.uid,username:ctx.account.username,
          },select:{id:true}});
          const ref=await tx.targetAccount.findFirst({where:{
            id:ctx.reference.id,instagramAccountId:ctx.account.id,
            username:ctx.referenceName,
          },select:{id:true}});
          if(!owner||!ref)return null;
          const details=makeTrialEvidence({
            version:1,referenceId:ref.id,agentId:ctx.agentId,
            stage:'reserved',followConfirmed:false,
            sessionOwnerVerifiedByProvider:false,recipientKnown:false,
          });
          if(!details)return null;
          const row=await tx.activityLog.create({data:{
            instagramAccountId:ctx.account.id,action:FOLLOWERS_TRIAL_ACTION,
            success:false,details:JSON.stringify(details),
          },select:{id:true}});
          return row.id;
        },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
        break;
      }catch(e){
        if((e as {code?:string})?.code==='P2034'&&n<2)continue;
        return fail('Reserva não concluída',503);
      }
    }
    if(!claim)return fail('Teste já solicitado ou conta alterada',409);
    const launch=await launchFollowersTrial(ctx.apiKey,ctx.agentId);
    const details=makeTrialEvidence({
      version:1,referenceId:ctx.reference.id,agentId:ctx.agentId,
      stage:launch.status==='accepted'?'launch-accepted':'uncertain',
      ...(launch.status==='accepted'?{containerId:launch.containerId}:{}),
      followConfirmed:false,sessionOwnerVerifiedByProvider:false,
      recipientKnown:false,
    });
    if(details){
      await prisma.activityLog.update({where:{id:claim},
        data:{details:JSON.stringify(details),success:false},
      }).catch(()=>undefined);
    }
    return NextResponse.json({
      status:launch.status==='accepted'?'launch-accepted':'uncertain',
      followConfirmed:false,recipientKnown:false,
      mayRetryAutomatically:false,unfollowScheduled:false,
    },{status:launch.status==='accepted'?202:503,headers:HEADERS});
  }

  // Explicit read of the specific saved container: never another launch.
  const record=await prisma.activityLog.findFirst({
    where:{instagramAccountId:ctx.account.id,action:FOLLOWERS_TRIAL_ACTION},
    select:{id:true,details:true,createdAt:true,success:true},
    orderBy:[{createdAt:'desc'},{id:'desc'}],
  });
  const evidence=parseTrialEvidence(record?.details);
  if(!record||!evidence||evidence.agentId!==ctx.agentId||
     evidence.referenceId!==ctx.reference.id||!evidence.containerId)
    return fail('Nenhuma execução rastreável para consultar',409);
  if(evidence.stage==='container-finished'||evidence.stage==='container-failed')
    return NextResponse.json({attempt:safeAttempt(record)},
      {headers:HEADERS});
  const outcome=await inspectTrialContainer(
    ctx.apiKey,ctx.agentId,evidence.containerId);
  const stage=outcome==='finished'?'container-finished':
    outcome==='failed'?'container-failed':evidence.stage;
  if(stage!==evidence.stage){
    const next=makeTrialEvidence({...evidence,stage});
    if(next){
      await prisma.activityLog.updateMany({
        where:{id:record.id,instagramAccountId:ctx.account.id,
          details:record.details},
        data:{details:JSON.stringify(next),success:false},
      });
    }
  }
  return NextResponse.json({
    containerStatus:outcome,
    followConfirmed:false,recipientKnown:false,
    mayRetryAutomatically:false,unfollowScheduled:false,
  },{headers:HEADERS});
}
