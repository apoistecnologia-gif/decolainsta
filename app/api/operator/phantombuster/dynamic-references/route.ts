export const dynamic='force-dynamic';
export const runtime='nodejs';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {isSameOriginDynamicCollectionRequest} from '@/lib/server/dynamic-collection-csrf';
import {inspectPinnedCollectorProgress} from '@/lib/providers/phantombuster-collector-progress';
import {
  launchExistingCollectorForReference,
  inspectDynamicRunProofDetailed,readDynamicContainerResults,
} from '@/lib/providers/phantombuster-dynamic-reference';
import {resolvePilotCollectorInWorkspace} from
  '@/lib/providers/phantombuster-pilot-workspace';
import {
  AUDIENCE_HISTORY_ACTION,MAX_HISTORY_BATCHES,
  makeAudienceSnapshot,parseAudienceSnapshot,type AudienceSnapshot,
} from '@/lib/reference-audience-history';
import {indexSavedAudienceCandidates} from '@/lib/server/dynamic-reference-candidate-index';
import {inspectDynamicFailureOutput} from
  '@/lib/providers/phantombuster-failure-diagnostic';
import {inspectFailedRetryPreflight} from
  '@/lib/providers/phantombuster-failed-run-retry';
import {
  DYNAMIC_COLLECTION_ACTION,MAX_DYNAMIC_COLLECTION_LOGS,
  makeDynamicJobEvent,parseDynamicJobEvent,planDynamicReferenceQueue,
  planFailedDynamicReferenceRetry,withinDynamicResultGracePeriod,
  type DynamicJobEvent,
} from '@/lib/reference-dynamic-collection';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const progressBlocker=(status:string):string=>{
  const explanations:Record<string,string>={
    running:'O PhantomBuster está executando outra coleta. Aguarde a conclusão.',
    pending:'O coletor está na fila do PhantomBuster. Aguarde a execução existente.',
    failed:'A última execução terminou com erro. Confira o diagnóstico antes de iniciar outra.',
    unverified:'O PhantomBuster não confirmou o estado da última execução. Verifique a aba Activity do agente.',
    'invalid-key':'A chave da API não autorizou a consulta de execuções.',
    'rate-limited':'O PhantomBuster limitou as consultas. Nenhuma coleta será iniciada.',
    unavailable:'A consulta do histórico de execuções falhou. Nenhuma coleta será iniciada.',
  };
  return explanations[status]??'O coletor ainda não foi confirmado como disponível.';
};
const bad=(error:string,status:number)=>NextResponse.json({error},{status,headers:HEADERS});
async function context(){
  if(process.env.VERCEL_ENV!=='preview')return null;
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return null;
  const user=await prisma.user.findUnique({where:{id:userId},select:{role:true}});
  if(user?.role!=='admin')return null;
  const alias=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT?.replace(/^@/,'').toLowerCase();
  if(!alias||!/^[a-z0-9._]{1,30}$/.test(alias))return null;
  const account=await prisma.instagramAccount.findFirst({
    where:{userId,username:alias},
    select:{id:true,instagramUserId:true,encryptedAccessToken:true},
  });
  return account?.instagramUserId&&account.encryptedAccessToken?account.id:null;
}
async function agent(key:string){
  // Discover the configured EXISTING collector from the workspace visible to
  // this API key. The previous manually assigned ID is not authoritative:
  // it may belong to a different workspace or even a container launch.
  // Source, script, session and uniqueness are checked without launching it.
  const template=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE?.toLowerCase()??'';
  return resolvePilotCollectorInWorkspace(key,template);
}
/**
 * A launched receipt is sufficient to READ its existing provider container.
 * The discovery of mutable workspace settings is only needed for NEW launches.
 */
async function existingLaunchedAgent(accountId:string):Promise<string|null>{
  const row=await prisma.activityLog.findFirst({
    where:{instagramAccountId:accountId,action:DYNAMIC_COLLECTION_ACTION},
    select:{instagramAccountId:true,targetUsername:true,details:true},
    orderBy:[{createdAt:'desc'},{id:'desc'}],
  });
  if(!row)return null;
  const event=parseDynamicJobEvent(row.details);
  return (event?.state==='launched'||event?.state==='finished-unverified')&&
    event.containerId&&event.accountId===accountId&&
    event.agentId===row.targetUsername
    ?event.agentId:null;
}
async function agentForReconciliation(key:string,accountId:string){
  const existing=await existingLaunchedAgent(accountId);
  return existing?{agentId:existing,status:'ready' as const}:agent(key);
}
const collectorIssue=(status:string)=>{
  const messages:Record<string,string>={
    'not-configured':'A referência-base ou chave API do coletor não está configurada.',
    'invalid-key':'A chave API do PhantomBuster foi recusada. Verifique a chave da mesma workspace do coletor.',
    'rate-limited':'O PhantomBuster limitou a consulta da API. Nenhuma coleta foi iniciada.',
    'workspace-mismatch':'A chave API do servidor não encontrou o Follower Collector (2) na workspace vinculada.',
    'ambiguous-match':'Há mais de um coletor compatível na workspace. A seleção automática foi bloqueada.',
    'invalid-inventory':'A API retornou uma lista de agentes inesperada; nenhum coletor foi selecionado.',
    'collector-not-found':'O coletor apareceu na lista da workspace, mas não pôde ser consultado pelo ID.',
    'missing-cookie':'O coletor localizado não tem sessão Instagram salva no PhantomBuster.',
    'mismatch':'O agente localizado não confirmou o tipo e a referência-base esperados.',
    'unavailable':'A consulta à API do PhantomBuster falhou ou expirou. Nenhuma coleta foi iniciada.',
  };
  return messages[status]??'A verificação do coletor precisa de revisão.';
};
async function queue(accountId:string,agentId:string){
  const [references,rows]=await Promise.all([
    prisma.targetAccount.findMany({where:{instagramAccountId:accountId},
      select:{id:true,username:true},
      orderBy:[{createdAt:'asc'},{id:'asc'}],take:101}),
    prisma.activityLog.findMany({
      where:{action:DYNAMIC_COLLECTION_ACTION,targetUsername:agentId},
      select:{id:true,instagramAccountId:true,targetUsername:true,details:true,createdAt:true},
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      take:MAX_DYNAMIC_COLLECTION_LOGS+1,
    }),
  ]);
  if(references.length>100||rows.length>MAX_DYNAMIC_COLLECTION_LOGS)return null;
  const jobs=rows.map(r=>parseDynamicJobEvent(r.details));
  if(jobs.some((p,i)=>!p||p.accountId!==rows[i].instagramAccountId||
    p.agentId!==rows[i].targetUsername))return null;
  const parsed=jobs.filter((p):p is DynamicJobEvent=>p!==null);
  const local=parsed.filter(p=>p.accountId===accountId);
  const plan=planDynamicReferenceQueue(references,local,agentId);
  const globalUnresolved=parsed.some(p=>!['finished','finished-unverified','rejected'].includes(p.state));
  return {references,rows,jobs:parsed,plan:{
    ...plan, unresolved:plan.unresolved||globalUnresolved,
    next:globalUnresolved?null:plan.next,
  }};
}
type ReservedCollectorClaim={id:string;event:DynamicJobEvent};
async function launchReservedCollector(
  key:string,agentId:string,claim:ReservedCollectorClaim,
){
  // The database claim is durable BEFORE the remote launch. If the request
  // becomes ambiguous, its claimed/unconfirmed state blocks all retries.
  const launched=await launchExistingCollectorForReference(
    key,agentId,claim.event.referenceUsername,claim.event.claimId);
  const changed=makeDynamicJobEvent({
    ...claim.event,state:launched.status==='queued'?'launched':'unconfirmed',
    containerId:launched.containerId,
  });
  if(changed)await prisma.activityLog.update({
    where:{id:claim.id},data:{details:JSON.stringify(changed)},
  }).catch(()=>undefined);
  return NextResponse.json({
    status:launched.status==='queued'?'queued':'review-required',
    reference:claim.event.referenceUsername,
    savedPhantomSettingsChanged:false,
    noAutomaticRetry:launched.status!=='queued',
    followsExecuted:0,unfollowsExecuted:0,
  },{headers:HEADERS});
}
/** Customer URLs come from saved references; never an HTTP request field. */
export async function GET(){
  const accountId=await context();
  if(!accountId)return bad('Somente operador no Preview',403);
  const key=process.env.PHANTOMBUSTER_API_KEY;
  if(!isConfiguredPhantomBusterKey(key))return bad('Provedor indisponível',409);
  const selected=await agentForReconciliation(key!,accountId);
  if(!selected.agentId)return bad(collectorIssue(selected.status),409);
  const agentId=selected.agentId;
  const data=await queue(accountId,agentId);
  if(!data)return bad('Fila requer revisão',503);
  const enabled=process.env.PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED==='yes';
  const current=data.jobs[0];
  const ownLaunched=current?.accountId===accountId&&
    (current.state==='launched'||current.state==='finished-unverified')&&
    Boolean(current.containerId);
  // Read-only preflight. A previous uncertain launch is not retried and a
  // provider state with no proof of idle does not enable a new launch.
  const activeProof=enabled&&current?.accountId===accountId&&
    (current.state==='launched'||current.state==='finished-unverified')&&current.containerId
    ?await inspectDynamicRunProofDetailed(key!,agentId,current.containerId,
      current.referenceUsername,current.claimId):null;
  // Read only the registered failed container's own output (never latest
  // agent logs). The response contains an allowlisted classification ONLY.
  // The exact container may report a successful finish yet have no
  // importable result because Instagram limited access. Only publish a
  // fixed category derived from that container's own log.
  const failureDiagnostic=enabled&&current?.containerId&&
    (activeProof?.reason==='failed-run'||
      (current.state==='launched'&&activeProof?.status==='verified-finished'))
      ?await inspectDynamicFailureOutput(key!,current.containerId):null;
  const retryTarget=planFailedDynamicReferenceRetry(
    data.references,data.jobs,accountId,agentId);
  const canRetryFailed=Boolean(enabled&&retryTarget&&
    activeProof?.reason==='failed-run');
  const progress=enabled&&!ownLaunched&&!data.plan.unresolved&&data.plan.next
    ?await inspectPinnedCollectorProgress(key!,agentId):null;
  const canAdvance=Boolean(enabled&&(
    (ownLaunched&&activeProof?.reason!=='failed-run')||
    (!data.plan.unresolved&&!ownLaunched&&data.plan.next&&
      (progress==='finished'||progress==='no-run'))));
  const blocker=!enabled?'O piloto está desativado neste Preview.'
    :ownLaunched&&activeProof?.status==='running'?'O contêiner existente continua em execução no PhantomBuster.'
    :ownLaunched&&activeProof?.status==='unavailable'?'Não foi possível confirmar o contêiner no PhantomBuster. Nenhuma coleta será repetida.'
    :ownLaunched&&activeProof?.status==='finished-unverified'?'O contêiner encerrou sem prova da referência. Importação bloqueada.'
    :ownLaunched?'Contêiner concluído; verificando a importação.'
    :data.plan.unresolved
      ?'Há uma execução anterior ainda sem confirmação. Nenhuma nova coleta será iniciada.'
    :!data.plan.next?'Todas as referências elegíveis já foram processadas.'
    :canAdvance?null:progressBlocker(progress??'unavailable');
  return NextResponse.json({
    enabled,accountId,
    total:data.plan.total,attempted:data.plan.attempted,
    completed:data.plan.completed,unverified:data.plan.attributionUnverified,
    // The next reference is NOT actionable while the previous container
    // still requires review, even when its state is finished-unverified.
    nextReference:ownLaunched?null:data.plan.next?.username??null,
    unresolved:data.plan.unresolved,
    currentState:current?.state??'none',
    activeContainerStatus:activeProof?.status??null,
    activeContainerReason:activeProof?.reason??null,
    failureDiagnostic,canAdvance,canRetryFailed,
    retryReference:canRetryFailed?retryTarget?.username:null,
    blocker,providerStatus:progress,
    noManualUrlChanges:true,followersExecuted:0,unfollowsExecuted:0,
  },{headers:HEADERS});
}
export async function POST(request:Request){
  const accountId=await context();
  if(!accountId)return bad('Somente operador no Preview',403);
  if(!isSameOriginDynamicCollectionRequest(
    request.headers.get('origin'),request.url,request.headers.get('host')))
    return bad('Origem da solicitação não corresponde ao domínio do painel',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))
    return bad('Formato inválido',415);
  const raw=await request.text().catch(()=>'');
  if(!raw||raw.length>150)return bad('Parâmetros inválidos',400);
  let input:unknown;try{input=JSON.parse(raw) as unknown;}catch{input=null;}
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).length!==2)return bad('Parâmetros inválidos',400);
  const body=input as Record<string,unknown>;
  if(!['advance','retry-failed'].includes(String(body.operation))||
     body.confirmDynamicCollection!==true)
    return bad('Operação inválida',400);
  if(process.env.PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes')
    return bad('Execução desativada no Preview',403);
  const key=process.env.PHANTOMBUSTER_API_KEY;
  if(!isConfiguredPhantomBusterKey(key))return bad('Provedor indisponível',409);
  const selected=await agentForReconciliation(key!,accountId);
  if(!selected.agentId)return bad(collectorIssue(selected.status),409);
  const agentId=selected.agentId;
  const current=await queue(accountId,agentId);
  if(!current)return bad('Registro inválido',503);
  if(body.operation==='retry-failed'){
    // Explicit button only. Never initiate this operation on page load,
    // from polling, or using a reference typed by the browser.
    const original=current.jobs[0],receipt=current.rows[0];
    const target=planFailedDynamicReferenceRetry(
      current.references,current.jobs,accountId,agentId);
    if(!receipt||!original||!target||current.plan.unresolved)
      return bad('Repetição não autorizada: histórico exige revisão',409);
    const proof=await inspectDynamicRunProofDetailed(
      key!,agentId,original.containerId!,original.referenceUsername,
      original.claimId);
    if(proof.reason!=='failed-run')
      return bad('O contêiner original não confirmou falha finalizada',409);
    // The current saved agent must be a valid Follower Collector with a
    // configured session, not just a previous successful DB receipt.
    const configured=await agent(key!);
    if(configured.agentId!==agentId)
      return bad('Sessão ou agente não confirmado na workspace do PhantomBuster',409);
    const preflight=await inspectFailedRetryPreflight(
      key!,agentId,original.containerId!);
    if(preflight!=='ready')return bad(
      preflight==='active'?'Outra execução do coletor está em andamento':
      preflight==='other-run'?'Há outra execução posterior à falha registrada':
      'Não foi possível comprovar que o coletor está disponível para repetir',
      409);
    let claim:ReservedCollectorClaim|null=null;
    try{
      claim=await prisma.$transaction(async tx=>{
        const locks=await tx.$queryRaw<Array<{acquired:boolean}>>`
          SELECT pg_try_advisory_xact_lock(
            hashtext('decolainsta_dynamic_reference_v1'),
            hashtext(${agentId})
          ) AS acquired
        `;
        if(locks.length!==1||locks[0].acquired!==true)return null;
        const rows=await tx.activityLog.findMany({
          where:{action:DYNAMIC_COLLECTION_ACTION,targetUsername:agentId},
          select:{id:true,instagramAccountId:true,targetUsername:true,details:true},
          orderBy:[{createdAt:'desc'},{id:'desc'}],
          take:MAX_DYNAMIC_COLLECTION_LOGS+1,
        });
        if(rows.length>MAX_DYNAMIC_COLLECTION_LOGS||!rows.length)return null;
        const events=rows.map(row=>parseDynamicJobEvent(row.details));
        if(events.some((e,i)=>!e||e.accountId!==rows[i].instagramAccountId||
           e.agentId!==rows[i].targetUsername))return null;
        const valid=planFailedDynamicReferenceRetry(current.references,
          events.filter((x):x is DynamicJobEvent=>x!==null),accountId,agentId);
        if(!valid||valid.id!==target.id||valid.username!==target.username||
           rows[0].id!==receipt.id||rows[0].details!==receipt.details)return null;
        const reference=await tx.targetAccount.findFirst({
          where:{id:valid.id,instagramAccountId:accountId,
            username:valid.username},select:{id:true},
        });
        if(!reference)return null;
        const job=makeDynamicJobEvent({
          state:'claimed',accountId,agentId,referenceId:valid.id,
          referenceUsername:valid.username,
          claimId:randomUUID(),containerId:null,
        });
        if(!job)return null;
        const inserted=await tx.activityLog.create({data:{
          instagramAccountId:accountId,targetUsername:agentId,
          action:DYNAMIC_COLLECTION_ACTION,details:JSON.stringify(job),
          success:false,
        },select:{id:true}});
        return {id:inserted.id,event:job};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    }catch{return bad('Não foi possível reservar a repetição no Neon',503);}
    if(!claim)return bad('Outra tentativa já foi registrada; repetição bloqueada',409);
    return launchReservedCollector(key!,agentId,claim);
  }
  const last=current.rows[0],event=current.jobs[0];
  if(event&&event.accountId!==accountId&&current.plan.unresolved)
    return NextResponse.json({
      status:'provider-busy',reason:'another-account-owns-active-run',
    },{headers:HEADERS});
  if(last&&(event?.state==='launched'||event?.state==='finished-unverified')&&event.containerId){
    const proof=await inspectDynamicRunProofDetailed(
      key!,agentId,event.containerId,event.referenceUsername,event.claimId);
    if(proof.status==='running'||proof.status==='unavailable')
      return NextResponse.json({
        status:'in-progress',reference:event.referenceUsername,
        providerStatus:proof.status,providerReason:proof.reason,noDuplicateLaunch:true,
      },{headers:HEADERS});
    if(proof.status!=='verified-finished'){
      if(event.state==='launched'){
        const changed=makeDynamicJobEvent({...event,state:'finished-unverified'});
        if(!changed)return bad('Registro inválido',503);
        await prisma.activityLog.updateMany({
          where:{id:last.id,instagramAccountId:accountId,
            action:DYNAMIC_COLLECTION_ACTION,details:last.details},
          data:{details:JSON.stringify(changed),success:false},
        });
      }
      const failureDiagnostic=proof.reason==='failed-run'
        ?await inspectDynamicFailureOutput(key!,event.containerId):null;
      return NextResponse.json({
        status:'finished-without-input-proof',reference:event.referenceUsername,
        providerReason:proof.reason,failureDiagnostic,
        candidatesImported:0,reviewRequired:true,
      },{headers:HEADERS});
    }
    // Exact container ID + launch claim metadata have been verified.
    // Never import from the agent-wide latest file, which might belong
    // to the previously saved template reference.
    const result=await readDynamicContainerResults(
      key!,event.containerId,event.referenceUsername);
    if(result.status!=='found'&&result.status!=='empty'){
      // Some finished launches expose their result object after the final
      // status becomes visible. Retry GET for this SAME container only,
      // bounded by a 15-minute grace period since the persisted launch.
      // Neither path invokes agents/launch or accesses the agent-wide file.
      if(withinDynamicResultGracePeriod(last.createdAt))
        return NextResponse.json({
          status:'in-progress',reference:event.referenceUsername,
          providerStatus:'awaiting-results',providerReason:'results-pending',
          noDuplicateLaunch:true,
        },{headers:HEADERS});
      const failureDiagnostic=await inspectDynamicFailureOutput(
        key!,event.containerId);
      return NextResponse.json({
        status:'import-unavailable',reference:event.referenceUsername,
        resultStatus:result.status,failureDiagnostic,
        noAutomaticRetry:true,
      },{headers:HEADERS});
    }
    const batches: AudienceSnapshot[]=[];
    for(let i=0;i<result.usernames.length;i+=10){
      const snapshot=makeAudienceSnapshot(
        event.referenceId,event.referenceUsername,agentId,
        result.usernames.slice(i,i+10),'completed_run');
      if(!snapshot)return bad('Dados do provedor incompatíveis',422);
      batches.push(snapshot);
    }
    const finish=makeDynamicJobEvent({...event,state:'finished'});
    if(!finish)return bad('Registro inválido',503);
    try{
      const stored=await prisma.$transaction(async tx=>{
        const existing=await tx.activityLog.findMany({
          where:{instagramAccountId:event.accountId,action:AUDIENCE_HISTORY_ACTION,
            targetUsername:event.referenceUsername},
          select:{details:true},take:MAX_HISTORY_BATCHES+1,
        });
        if(existing.length>MAX_HISTORY_BATCHES)return null;
        const hashes=new Set(existing.flatMap(row=>{
          const sample=parseAudienceSnapshot(row.details);
          return sample?.referenceId===event.referenceId?[sample.fingerprint]:[];
        }));
        const fresh=batches.filter(b=>!hashes.has(b.fingerprint));
        if(existing.length+fresh.length>MAX_HISTORY_BATCHES)return null;
        const applied=await tx.activityLog.updateMany({
          where:{id:last.id,instagramAccountId:event.accountId,
            action:DYNAMIC_COLLECTION_ACTION,details:last.details},
          data:{details:JSON.stringify(finish),success:true},
        });
        if(applied.count!==1)return null;
        if(fresh.length)await tx.activityLog.createMany({
          data:fresh.map(b=>({
            instagramAccountId:event.accountId,targetUsername:event.referenceUsername,
            action:AUDIENCE_HISTORY_ACTION,success:true,details:JSON.stringify(b),
          })),
        });
        // Keep the verified snapshot and inert candidate index atomic. A
        // closed browser must not leave a completed collection unindexed.
        const indexed=await indexSavedAudienceCandidates(tx,event.accountId);
        if(indexed===null)return null;
        return {snapshots:fresh.length,indexed:indexed.indexed};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if(stored===null)return bad('Limite ou conflito de histórico ou índice',409);
      return NextResponse.json({
        status:'finished',reference:event.referenceUsername,
        observedNames:result.usernames.length,snapshotBatchesStored:stored.snapshots,
        candidatesIndexed:stored.indexed,
        newFollowersConfirmed:0,followExecuted:false,
      },{headers:HEADERS});
    }catch{return bad('Erro ao salvar coleta concluída',503);}
  }
  if(current.plan.unresolved)return NextResponse.json({
    status:'review-required',reason:'existing-run-unconfirmed',
    noAutomaticRetry:true,
  },{headers:HEADERS});
  if(!current.plan.next)return NextResponse.json({
    status:'queue-complete',total:current.plan.total,
  },{headers:HEADERS});

  // This agent was validated by resolvePinnedDynamicCollector above.
  const provider=await inspectPinnedCollectorProgress(key!,agentId);
  if(provider==='running'||provider==='pending')
    return NextResponse.json({status:'provider-busy'}, {headers:HEADERS});
  if(provider!=='finished'&&provider!=='no-run')
    return bad(progressBlocker(provider),409);

  let claim:{id:string;event:DynamicJobEvent}|null=null;
  try{
    claim=await prisma.$transaction(async tx=>{
      // PostgreSQL pg_advisory_xact_lock returns void, which Prisma's
      // $queryRaw driver may reject when deserializing the result column.
      // The "try" variant returns a supported boolean and does not wait,
      // preserving one active claim per collector across concurrent requests.
      const lockRows=await tx.$queryRaw<Array<{acquired:boolean}>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext('decolainsta_dynamic_reference_v1'),
          hashtext(${agentId})
        ) AS acquired
      `;
      if(lockRows.length!==1||lockRows[0].acquired!==true)return null;
      const rows=await tx.activityLog.findMany({
        where:{action:DYNAMIC_COLLECTION_ACTION,targetUsername:agentId},
        select:{id:true,instagramAccountId:true,targetUsername:true,details:true},
        orderBy:[{createdAt:'desc'},{id:'desc'}],
        take:MAX_DYNAMIC_COLLECTION_LOGS+1,
      });
      if(rows.length>MAX_DYNAMIC_COLLECTION_LOGS)return null;
      const jobs=rows.map(r=>parseDynamicJobEvent(r.details));
      if(jobs.some((p,i)=>!p||p.accountId!==rows[i].instagramAccountId||
        p.agentId!==rows[i].targetUsername))return null;
      if(jobs.some(p=>p&&!['finished','finished-unverified','rejected'].includes(p.state)))
        return null;
      const next=current.plan.next!;
      const valid=await tx.targetAccount.findFirst({
        where:{id:next.id,username:next.username,instagramAccountId:accountId},
        select:{id:true},
      });
      if(!valid||jobs.some(p=>p?.referenceId===next.id))return null;
      const event=makeDynamicJobEvent({
        state:'claimed',accountId,referenceId:next.id,
        referenceUsername:next.username,agentId,
        claimId:randomUUID(),containerId:null,
      });
      if(!event)return null;
      const row=await tx.activityLog.create({data:{
        instagramAccountId:accountId,targetUsername:agentId,
        action:DYNAMIC_COLLECTION_ACTION,details:JSON.stringify(event),success:false,
      },select:{id:true}});
      return {id:row.id,event};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  }catch(error){
    // Only disclose an allowlisted Prisma error code. Never expose SQL text,
    // credentials or driver metadata to the customer-facing panel.
    const rawCode=error&&typeof error==='object'&&'code' in error
      ?(error as {code?:unknown}).code:null;
    const code=typeof rawCode==='string'&&
      ['P2010','P2028','P2034','P1001','P1002'].includes(rawCode)
      ?rawCode:null;
    const explanation=code==='P2034'
      ?'Conflito simultâneo na reserva do coletor (P2034). Nenhuma nova execução foi iniciada.'
      :code==='P2010'
        ?'Falha na consulta de reserva do PostgreSQL (P2010). Nenhuma nova execução foi iniciada.'
        :code==='P2028'
          ?'A transação de reserva expirou (P2028). Nenhuma nova execução foi iniciada.'
          :code==='P1001'||code==='P1002'
            ?'O banco Neon não respondeu à reserva ('+code+'). Nenhuma nova execução foi iniciada.'
            :'Não foi possível registrar a reserva no banco. Nenhuma nova execução foi iniciada.';
    return bad(explanation,503);
  }
  if(!claim)return bad('Agente reservado ou referência já processada',409);
  return launchReservedCollector(key!,agentId,claim);
}
