export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AUDIENCE_CANDIDATE_ACTION, parseCandidateEvidence } from '@/lib/reference-candidate-queue';
import {
  SOCIAL_PILOT_ACTION, SOCIAL_PILOT_FOLLOW_CONFIRMATION,
  makePilotAction, parsePilotAction,
} from '@/lib/reference-social-pilot';
import {
  inspectSingleTargetSocialAgent, launchSingleSocialAgent,
} from '@/lib/providers/phantombuster-social-pilot';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';

const HEADERS = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
const error=(message:string,code:number)=>
  NextResponse.json({error:message},{status:code,headers:HEADERS});

async function operator(): Promise<string | null> {
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if (!userId) return null;
  const user=await prisma.user.findUnique({where:{id:userId},select:{role:true}});
  return user?.role==='admin' ? userId : null;
}

/** Readiness only: never exposes agent IDs, passwords or provider arguments. */
export async function GET() {
  if (process.env.VERCEL_ENV!=='preview')
    return error('Somente Preview',403);
  const operatorId=await operator();
  if (!operatorId) return error('Operador não autorizado',403);
  const enabled=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ENABLED==='yes';
  const sessionOwnerConfirmed=process.env.PHANTOMBUSTER_SOCIAL_PILOT_SESSION_OWNER_CONFIRMED==='yes';
  const accountUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??'';
  const referenceUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE??'';
  const targetUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_TARGET??'';
  const agentId=process.env.PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID??'';
  const configured=Boolean(
    /^[a-z0-9._]{1,30}$/.test(accountUsername) &&
    /^[a-z0-9._]{1,30}$/.test(referenceUsername) &&
    /^[a-z0-9._]{1,30}$/.test(targetUsername) &&
    /^\d{10,25}$/.test(agentId) &&
    isConfiguredPhantomBusterKey(process.env.PHANTOMBUSTER_API_KEY),
  );
  const account=configured?await prisma.instagramAccount.findFirst({
    where:{username:accountUsername,userId:operatorId},
    select:{id:true,username:true,instagramUserId:true},
  }):null;
  const ref=account?await prisma.targetAccount.findFirst({
    where:{instagramAccountId:account.id,username:referenceUsername},
    select:{id:true},
  }):null;
  const saved=ref?await prisma.activityLog.findMany({
    where:{instagramAccountId:account!.id,
      action:AUDIENCE_CANDIDATE_ACTION,targetUsername},
    select:{details:true},take:2,
  }):[];
  const candidate=saved.some(row=>{
    const item=parseCandidateEvidence(row.details);
    return Boolean(item && item.referenceId===ref?.id &&
      item.referenceUsername===referenceUsername);
  });
  const protectedName=account?await prisma.whitelist.findUnique({
    where:{instagramAccountId_username:{
      instagramAccountId:account.id,username:targetUsername,
    }},select:{id:true},
  }):null;
  const previous=account?await prisma.activityLog.count({
    where:{instagramAccountId:account.id,action:SOCIAL_PILOT_ACTION},
  }):0;
  return NextResponse.json({
    enabled,configured,accountRegistered:!!account,
    ownerConnectedByMeta:Boolean(account?.instagramUserId),
    providerSessionOwnerConfirmed:sessionOwnerConfirmed,
    referenceRegistered:!!ref,candidateIndexed:candidate,
    candidateExcluded:Boolean(protectedName)||accountUsername===targetUsername||
      referenceUsername===targetUsername,
    previousAttempts:previous,
    liveActionReady:enabled&&sessionOwnerConfirmed&&configured&&!!account&&
      !!ref&&candidate&&!protectedName&&previous===0&&
      accountUsername!==targetUsername&&referenceUsername!==targetUsername,
    oneTestActionOnly:true,unfollowEnabled:false,
    lastProviderActionConfirmed:false,
  },{headers:HEADERS});
}

export async function POST(request:Request) {
  if (process.env.VERCEL_ENV!=='preview' ||
      process.env.PHANTOMBUSTER_SOCIAL_PILOT_ENABLED!=='yes' ||
      process.env.PHANTOMBUSTER_SOCIAL_PILOT_SESSION_OWNER_CONFIRMED!=='yes')
    return error('Teste real ainda não habilitado',403);
  const operatorId=await operator();
  if (!operatorId) return error('Operador não autorizado',403);
  if (request.headers.get('origin')!==new URL(request.url).origin)
    return error('Origem inválida',403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return error('Formato inválido',415);
  const raw=await request.text().catch(()=> '');
  if (!raw || raw.length>180) return error('Dados inválidos',400);
  let parsed:unknown;
  try{parsed=JSON.parse(raw) as unknown;}catch{parsed=null;}
  if (!parsed||typeof parsed!=='object'||Array.isArray(parsed))
    return error('Dados inválidos',400);
  const body=parsed as Record<string,unknown>;
  if (Object.keys(body).length!==2 ||
      body.operation!=='launch-one-follow' ||
      body.confirm!==SOCIAL_PILOT_FOLLOW_CONFIRMATION)
    return error('Confirmação inválida',400);

  // No ID supplied by the browser; all account/target/agent IDs from server.
  const accountUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??'';
  const referenceUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE??'';
  const targetUsername=process.env.PHANTOMBUSTER_SOCIAL_PILOT_TARGET??'';
  const agentId=process.env.PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID??'';
  const apiKey=process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey) ||
      !/^[a-z0-9._]{1,30}$/.test(accountUsername) ||
      !/^[a-z0-9._]{1,30}$/.test(referenceUsername) ||
      !/^[a-z0-9._]{1,30}$/.test(targetUsername) ||
      !/^\d{10,25}$/.test(agentId) ||
      accountUsername===targetUsername||referenceUsername===targetUsername)
    return error('Configuração de teste incompleta',409);
  const account=await prisma.instagramAccount.findFirst({
    where:{username:accountUsername,userId:operatorId},
    select:{id:true,username:true},
  });
  if (!account) return error('Conta de teste não cadastrada pelo operador',409);
  const reference=await prisma.targetAccount.findFirst({
    where:{instagramAccountId:account.id,username:referenceUsername},
    select:{id:true},
  });
  if (!reference) return error('Referência de teste ausente',409);
  const [candidate,protectedProfile]=await Promise.all([
    prisma.activityLog.findMany({where:{
      instagramAccountId:account.id,action:AUDIENCE_CANDIDATE_ACTION,
      targetUsername},select:{details:true},take:3}),
    prisma.whitelist.findUnique({where:{
      instagramAccountId_username:{instagramAccountId:account.id,username:targetUsername},
    },select:{id:true}}),
  ]);
  if (protectedProfile || !candidate.some(x=>{
    const evidence=parseCandidateEvidence(x.details);
    return evidence?.referenceId===reference.id &&
      evidence.referenceUsername===referenceUsername;
  })) return error('Candidato não elegível',409);

  // Remote read-only inspection BEFORE reserving a one-time attempt.
  const inspection=await inspectSingleTargetSocialAgent(
    apiKey,agentId,targetUsername,'follow');
  if (inspection!=='matched')
    return error('Agente do provedor não corresponde a uma ação única segura',409);

  let claimId:string|null=null;
  for(let attempt=0;attempt<3;attempt++){
    try {
      claimId=await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(17320, 20261121)`;
        if (await tx.activityLog.count({where:{
          instagramAccountId:account.id,action:SOCIAL_PILOT_ACTION,
        }})>0) return null;
        const refCheck=await tx.targetAccount.findFirst({where:{
          id:reference.id,instagramAccountId:account.id,username:referenceUsername,
        }});
        const protectedCheck=await tx.whitelist.findUnique({where:{
          instagramAccountId_username:{instagramAccountId:account.id,username:targetUsername},
        }});
        if (!refCheck||protectedCheck) return null;
        const details=makePilotAction({version:1,action:'follow',
          referenceId:reference.id,agentId,stage:'requested',
          proof:'provider_unverified'});
        if (!details) return null;
        const row=await tx.activityLog.create({data:{
          instagramAccountId:account.id,targetUsername,action:SOCIAL_PILOT_ACTION,
          success:false,details:JSON.stringify(details),
        },select:{id:true}});
        return row.id;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      break;
    } catch(err) {
      if ((err as {code?:string})?.code==='P2034' && attempt<2) continue;
      return error('Falha ao reservar tentativa',503);
    }
  }
  if (!claimId) return error('Teste já utilizado; não repetir automaticamente',409);
  // No automatic retry: timeout may mean launch happened.
  const result=await launchSingleSocialAgent(apiKey,agentId);
  const details=makePilotAction({
    version:1,action:'follow',referenceId:reference.id,agentId,
    stage:result.status==='accepted'?'launched':'uncertain',
    ...(result.status==='accepted'?{containerId:result.containerId}:{}),
    proof:'provider_unverified',
  });
  await prisma.activityLog.update({where:{id:claimId},data:{
    success:false,details:JSON.stringify(details),
  }}).catch(()=>undefined);
  return NextResponse.json({
    status:result.status==='accepted'?'launch-request-accepted':'unconfirmed',
    followConfirmed:false,unfollowScheduled:false,
    instagramActionsConfirmed:0,mayRetryAutomatically:false,
  },{status:result.status==='accepted'?202:503,headers:HEADERS});
}
