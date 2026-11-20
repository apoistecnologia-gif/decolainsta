export const dynamic='force-dynamic';
export const runtime='nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { inspectFollowersAutoFollowAgent } from '@/lib/providers/phantombuster-followers-auto-follow';
import { inspectSavedPrivateFilter } from '@/lib/providers/phantombuster-private-filter';
import {
  launchFollowersTrial,inspectTrialContainer,
} from '@/lib/providers/phantombuster-followers-trial';
import {
  FOLLOWERS_TRIAL_ACTION,FOLLOWERS_TRIAL_APPROVAL,
  makeTrialEvidence,parseTrialEvidence,observedRelationship,
  FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION,
  FOLLOWERS_PRIVACY_OBSERVATION_ACTION,
} from '@/lib/reference-followers-trial';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { fetchFollowersRunReport,fetchSavedRunPrivacy } from '@/lib/providers/phantombuster-followers-result';

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
    where:{userId:uid,username:accountName},select:{id:true,username:true,settings:{select:{skipPrivateProfiles:true}}},
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
    providerReportedUsername:evidence.providerReportedUsername??null,
    providerReportedCount:evidence.providerReportedCount??0,
    providerReportedPrivate:evidence.providerReportedPrivate??null,
    providerPrivacyReadAt:evidence.providerPrivacyReadAt??null,
    relationshipObservation:evidence.relationshipObservation??'unknown',
    relationshipObservedAt:evidence.relationshipObservedAt??null,
    followConfirmed:false,recipientKnown:false,
    unfollowEligibleAt:null,
    mayRetryAutomatically:false,
  }:a?{
    stage:'uncertain',requestedAt:a.createdAt.toISOString(),
    providerReportedUsername:null,providerReportedCount:0,
    providerReportedPrivate:null,providerPrivacyReadAt:null,
    relationshipObservation:'unknown',relationshipObservedAt:null,
    followConfirmed:false,recipientKnown:false,unfollowEligibleAt:null,
    mayRetryAutomatically:false,
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
    operation==='record-relationship'?['operation','observedStatus']:
    operation==='check-result'||operation==='check-provider-report'||
    operation==='check-profile-privacy'
      ? ['operation'] : [];
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
    if(ctx.account.settings?.skipPrivateProfiles===false)
      return fail('Exclusão de perfis privados desativada na conta',409);
    const privateExclusion=await inspectSavedPrivateFilter(
      ctx.apiKey,ctx.agentId,ctx.referenceName);
    if(privateExclusion!=='enabled')
      return fail('Filtro de perfis privados não comprovado no agente',409);
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

  if(operation==='record-relationship'){
    if(evidence.stage!=='provider-reported'||
      !evidence.providerReportedUsername||
      !observedRelationship(input.observedStatus))
      return fail('Informe uma situação válida para o perfil reportado',409);
    if(evidence.relationshipObservation===input.observedStatus)
      return NextResponse.json({
        relationshipObservation:evidence.relationshipObservation,
        followConfirmed:false,unfollowEligibleAt:null,
      },{headers:HEADERS});
    const observedAt=new Date().toISOString();
    const next=makeTrialEvidence({
      ...evidence,
      relationshipObservation:input.observedStatus,
      relationshipObservedAt:observedAt,
      relationshipSource:'owner-visual-check',
    });
    if(!next)return fail('Registro de situação inválido',409);
    try{
      const saved=await prisma.$transaction(async tx=>{
        const updated=await tx.activityLog.updateMany({
          where:{id:record.id,instagramAccountId:ctx.account.id,
            action:FOLLOWERS_TRIAL_ACTION,details:record.details},
          data:{details:JSON.stringify(next),success:false},
        });
        if(updated.count!==1)return false;
        // Immutable audit event, scoped to the test account and the
        // exact recipient from the previously verified provider report.
        await tx.activityLog.create({data:{
          instagramAccountId:ctx.account.id,
          action:FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION,
          targetUsername:evidence.providerReportedUsername,
          success:false,
          details:JSON.stringify({
            version:1,trialId:record.id,referenceId:ctx.reference.id,
            relationship:input.observedStatus,observedAt,
            source:'owner-visual-check',
          }),
        }});
        return true;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if(!saved)return fail('Situação alterada; atualize o diagnóstico',409);
    }catch{return fail('Falha ao registrar situação; tente consultar novamente',503);}
    return NextResponse.json({
      relationshipObservation:next.relationshipObservation,
      relationshipObservedAt:next.relationshipObservedAt,
      followConfirmed:false,unfollowEligibleAt:null,
      unfollowScheduled:false,
    },{headers:HEADERS});
  }

  if(operation==='check-profile-privacy'){
    if(evidence.stage!=='provider-reported'||!evidence.providerReportedUsername)
      return fail('Nenhum perfil reportado para consultar privacidade',409);
    // A saved boolean is immutable evidence from the provider result.
    // Never refresh or silently overwrite historical claims.
    if(typeof evidence.providerReportedPrivate==='boolean')
      return NextResponse.json({
        providerPrivacyStatus:evidence.providerReportedPrivate?'private':'public',
        providerReportedPrivate:evidence.providerReportedPrivate,
        providerPrivacyReadAt:evidence.providerPrivacyReadAt??null,
        followConfirmed:false,unfollowScheduled:false,
      },{headers:HEADERS});

    const reported=await fetchSavedRunPrivacy(
      ctx.apiKey,evidence.containerId,ctx.referenceName);
    if(reported.status!=='reported')
      return NextResponse.json({
        providerPrivacyStatus:reported.status,providerReportedPrivate:null,
        followConfirmed:false,unfollowScheduled:false,
      },{headers:HEADERS});
    // A provider reply about any OTHER profile must never be persisted.
    if(reported.username!==evidence.providerReportedUsername)
      return fail('O resultado não corresponde ao perfil registrado',409);

    const privacyReadAt=new Date().toISOString();
    const next=makeTrialEvidence({...evidence,
      providerReportedPrivate:reported.isPrivate,
      providerPrivacyReadAt:privacyReadAt,
    });
    if(!next)return fail('Evidência de privacidade inválida',409);
    try{
      const stored=await prisma.$transaction(async tx=>{
        const updated=await tx.activityLog.updateMany({
          where:{id:record.id,instagramAccountId:ctx.account.id,
            action:FOLLOWERS_TRIAL_ACTION,details:record.details},
          data:{details:JSON.stringify(next),success:false},
        });
        if(updated.count!==1)return false;
        await tx.activityLog.create({data:{
          instagramAccountId:ctx.account.id,
          action:FOLLOWERS_PRIVACY_OBSERVATION_ACTION,
          targetUsername:evidence.providerReportedUsername,
          success:false,
          details:JSON.stringify({
            version:1,trialId:record.id,referenceId:ctx.reference.id,
            isPrivate:reported.isPrivate,observedAt:privacyReadAt,
            source:'phantombuster-saved-run',
          }),
        }});
        return true;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if(!stored)return fail('Evidência alterada; atualize o diagnóstico',409);
    }catch{return fail('Não foi possível salvar a evidência',503);}
    return NextResponse.json({
      providerPrivacyStatus:reported.isPrivate?'private':'public',
      providerReportedPrivate:reported.isPrivate,
      providerPrivacyReadAt:privacyReadAt,
      followConfirmed:false,unfollowScheduled:false,
    },{headers:HEADERS});
  }
  if(operation==='check-provider-report'){
    if(evidence.stage==='provider-reported')
      return NextResponse.json({
        providerStatus:'provider-reported',
        providerReportedUsername:evidence.providerReportedUsername,
        providerReportedCount:1,
        followConfirmed:false,unfollowScheduled:false,
      },{headers:HEADERS});
    if(evidence.stage!=='container-finished')
      return fail('A execução ainda não foi encerrada com sucesso',409);
    const report=await fetchFollowersRunReport(
      ctx.apiKey,evidence.containerId,ctx.referenceName);
    if(report.status==='provider-reported'){
      const updated=makeTrialEvidence({...evidence,
        stage:'provider-reported',
        providerReportedUsername:report.username,
        providerReportedCount:1,
        ...('isPrivate' in report&&typeof report.isPrivate==='boolean'
          ? {providerReportedPrivate:report.isPrivate,
              providerPrivacyReadAt:new Date().toISOString()} : {}),
      });
      if(updated){
        await prisma.activityLog.updateMany({
          where:{id:record.id,instagramAccountId:ctx.account.id,
            details:record.details},
          data:{details:JSON.stringify(updated),success:false},
        });
      }
    }
    return NextResponse.json({
      providerStatus:report.status,
      providerReportedUsername:'username' in report?report.username:null,
      providerReportedCount:'reportedCount' in report?report.reportedCount:0,
      providerReportedPrivate:'isPrivate' in report?report.isPrivate:null,
      followConfirmed:false,unfollowScheduled:false,
    },{headers:HEADERS});
  }
  if(evidence.stage==='container-finished'||
    evidence.stage==='container-failed'||evidence.stage==='provider-reported')
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
