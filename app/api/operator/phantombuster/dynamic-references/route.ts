export const dynamic='force-dynamic';
export const runtime='nodejs';
import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {discoverFollowerCollectors} from '@/lib/providers/phantombuster-collector-discovery';
import {inspectExistingReferenceCollector} from '@/lib/providers/phantombuster-collector-progress';
import {
  inspectDynamicCollectorTemplate,launchExistingCollectorForReference,
  inspectDynamicRunProof,readDynamicContainerResults,
} from '@/lib/providers/phantombuster-dynamic-reference';
import {
  AUDIENCE_HISTORY_ACTION,MAX_HISTORY_BATCHES,
  makeAudienceSnapshot,parseAudienceSnapshot,type AudienceSnapshot,
} from '@/lib/reference-audience-history';
import {
  DYNAMIC_COLLECTION_ACTION,MAX_DYNAMIC_COLLECTION_LOGS,
  makeDynamicJobEvent,parseDynamicJobEvent,planDynamicReferenceQueue,
  type DynamicJobEvent,
} from '@/lib/reference-dynamic-collection';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
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
  const reference=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE?.toLowerCase();
  if(!reference||!/^[a-z0-9._]{1,30}$/.test(reference))return null;
  const scan=await discoverFollowerCollectors(key);
  if(scan.status!=='ok')return null;
  const matches=scan.collectors.filter(x=>x.referenceUsername===reference);
  return matches.length===1?matches[0].collectorAgentId:null;
}
async function queue(accountId:string,agentId:string){
  const [references,rows]=await Promise.all([
    prisma.targetAccount.findMany({where:{instagramAccountId:accountId},
      select:{id:true,username:true},
      orderBy:[{createdAt:'asc'},{id:'asc'}],take:101}),
    prisma.activityLog.findMany({
      where:{action:DYNAMIC_COLLECTION_ACTION,targetUsername:agentId},
      select:{id:true,instagramAccountId:true,targetUsername:true,details:true},
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
/** Customer URLs come from saved references; never an HTTP request field. */
export async function GET(){
  const accountId=await context();
  if(!accountId)return bad('Somente operador no Preview',403);
  const key=process.env.PHANTOMBUSTER_API_KEY;
  if(!isConfiguredPhantomBusterKey(key))return bad('Provedor indisponível',409);
  const agentId=await agent(key!);
  if(!agentId)return bad('Coletor original não identificado de forma única',409);
  const data=await queue(accountId,agentId);
  if(!data)return bad('Fila requer revisão',503);
  return NextResponse.json({
    enabled:process.env.PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED==='yes',
    accountId,
    total:data.plan.total,attempted:data.plan.attempted,
    completed:data.plan.completed,unverified:data.plan.attributionUnverified,
    nextReference:data.plan.next?.username??null,
    unresolved:data.plan.unresolved,
    currentState:data.jobs[0]?.state??'none',
    noManualUrlChanges:true,followersExecuted:0,unfollowsExecuted:0,
  },{headers:HEADERS});
}
export async function POST(request:Request){
  const accountId=await context();
  if(!accountId)return bad('Somente operador no Preview',403);
  if(request.headers.get('origin')!==new URL(request.url).origin)
    return bad('Origem inválida',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))
    return bad('Formato inválido',415);
  const raw=await request.text().catch(()=>'');
  if(!raw||raw.length>150)return bad('Parâmetros inválidos',400);
  let input:unknown;try{input=JSON.parse(raw) as unknown;}catch{input=null;}
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).length!==2)return bad('Parâmetros inválidos',400);
  const body=input as Record<string,unknown>;
  if(body.operation!=='advance'||body.confirmDynamicCollection!==true)
    return bad('Operação inválida',400);
  if(process.env.PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes')
    return bad('Execução desativada no Preview',403);
  const key=process.env.PHANTOMBUSTER_API_KEY;
  if(!isConfiguredPhantomBusterKey(key))return bad('Provedor indisponível',409);
  const agentId=await agent(key!);
  if(!agentId)return bad('Coletor original não identificado',409);
  const current=await queue(accountId,agentId);
  if(!current)return bad('Registro inválido',503);
  const last=current.rows[0],event=current.jobs[0];
  if(event&&event.accountId!==accountId&&current.plan.unresolved)
    return NextResponse.json({
      status:'provider-busy',reason:'another-account-owns-active-run',
    },{headers:HEADERS});
  if(last&&event?.state==='launched'&&event.containerId){
    const proof=await inspectDynamicRunProof(
      key!,agentId,event.containerId,event.referenceUsername,event.claimId);
    if(proof==='running'||proof==='unavailable')
      return NextResponse.json({
        status:'in-progress',reference:event.referenceUsername,
        noDuplicateLaunch:true,
      },{headers:HEADERS});
    if(proof!=='verified-finished'){
      const changed=makeDynamicJobEvent({...event,state:'finished-unverified'});
      if(!changed)return bad('Registro inválido',503);
      await prisma.activityLog.update({
        where:{id:last.id},data:{details:JSON.stringify(changed),success:false},
      });
      return NextResponse.json({
        status:'finished-without-input-proof',reference:event.referenceUsername,
        candidatesImported:0,reviewRequired:true,
      },{headers:HEADERS});
    }
    // Exact container ID + launch claim metadata have been verified.
    // Never import from the agent-wide latest file, which might belong
    // to the previously saved template reference.
    const result=await readDynamicContainerResults(
      key!,event.containerId,event.referenceUsername);
    if(result.status!=='found'&&result.status!=='empty')
      return NextResponse.json({
        status:'import-unavailable',reference:event.referenceUsername,
        noAutomaticRetry:true,
      },{headers:HEADERS});
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
        return fresh.length;
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if(stored===null)return bad('Limite ou conflito de histórico',409);
      return NextResponse.json({
        status:'finished',reference:event.referenceUsername,
        observedNames:result.usernames.length,snapshotBatchesStored:stored,
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

  if(await inspectDynamicCollectorTemplate(key!,agentId)!=='ready')
    return bad('A configuração do coletor precisa de revisão',409);
  const reference=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE!.toLowerCase();
  const provider=await inspectExistingReferenceCollector(key!,reference);
  if(provider.status==='running'||provider.status==='pending')
    return NextResponse.json({status:'provider-busy'}, {headers:HEADERS});
  if(provider.status!=='finished'&&provider.status!=='no-run')
    return bad('O coletor não está comprovadamente disponível',409);

  let claim:{id:string;event:DynamicJobEvent}|null=null;
  try{
    claim=await prisma.$transaction(async tx=>{
      await tx.$queryRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext('decolainsta_dynamic_reference_v1'),hashtext($1))",
        agentId,
      );
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
  }catch{return bad('Conflito na reserva',503);}
  if(!claim)return bad('Agente reservado ou referência já processada',409);
  const launched=await launchExistingCollectorForReference(
    key!,agentId,claim.event.referenceUsername,claim.event.claimId);
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
