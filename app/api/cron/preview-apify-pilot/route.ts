export const dynamic='force-dynamic';
export const runtime='nodejs';

import {timingSafeEqual} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {prisma} from '@/lib/db';
import {
  APIFY_PILOT_ACTION,APIFY_PILOT_SAMPLE_ACTION,
  APIFY_PILOT_ACTOR,APIFY_PILOT_MAX_USD,APIFY_PILOT_RESULTS_LIMIT,
  startCappedApifyPilot,inspectCappedApifyRun,readApifyTrialDataset,
} from '@/lib/providers/apify-followers-trial';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const bad=(reason:string,status:number)=>NextResponse.json({status:'blocked',reason,
  actorRunsLaunched:0,instagramActionsExecuted:0},{status,headers});
const validName=(v:unknown):v is string=>typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
type Receipt={
  version:1;state:'claimed'|'launched'|'unconfirmed'|'rejected'|
   'finished'|'finished-empty'|'finished-unverified'|'failed';
  accountId:string;referenceId:string;referenceUsername:string;
  actor:string;runId:string|null;resultsLimit:25;maxUsd:0.25;
  resultCount:number;costUsd:number|null;
};
function parseReceipt(raw:unknown):Receipt|null{
  if(typeof raw!=='string'||raw.length>1500)return null;
  let value:unknown;
  try{value=JSON.parse(raw);}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const p=value as Record<string,unknown>;
  if(p.version!==1||!['claimed','launched','unconfirmed','rejected',
     'finished','finished-empty','finished-unverified','failed'].includes(String(p.state))||
     p.actor!==APIFY_PILOT_ACTOR||p.resultsLimit!==APIFY_PILOT_RESULTS_LIMIT||
     p.maxUsd!==APIFY_PILOT_MAX_USD||!validName(p.referenceUsername)||
     typeof p.accountId!=='string'||typeof p.referenceId!=='string'||
     (p.runId!==null&&(typeof p.runId!=='string'||!/^[A-Za-z0-9]{17,24}$/.test(p.runId)))||
     typeof p.resultCount!=='number'||p.resultCount<0||
     p.resultCount>APIFY_PILOT_RESULTS_LIMIT||
     (p.costUsd!==null&&(typeof p.costUsd!=='number'||!Number.isFinite(p.costUsd)||
       p.costUsd<0)))return null;
  return p as Receipt;
}
function authorized(request:Request){
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32)return false;
  const given=Buffer.from(request.headers.get('authorization')??'');
  const expected=Buffer.from('Bearer '+secret);
  return given.length===expected.length&&timingSafeEqual(given,expected);
}
async function selectedAccount(){
  const alias=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT
    ?.replace(/^@/,'').toLowerCase()??'';
  if(!validName(alias))return null;
  const accounts=await prisma.instagramAccount.findMany({
    where:{username:alias},select:{id:true},take:2,
  });
  if(accounts.length!==1)return null;
  const reference=process.env.PREVIEW_APIFY_PILOT_REFERENCE??'';
  if(reference!=='prefeituradepetrolina')return null;
  const refs=await prisma.targetAccount.findMany({
    where:{instagramAccountId:accounts[0].id,username:reference},
    select:{id:true,username:true},take:2,
  });
  return refs.length===1?{accountId:accounts[0].id,referenceId:refs[0].id,
    referenceUsername:refs[0].username}:null;
}
export async function POST(request:Request){
  if(process.env.VERCEL_ENV!=='preview'||
     process.env.PREVIEW_APIFY_PILOT_ENABLED!=='yes')
    return bad('preview-disabled',403);
  if(!authorized(request))return bad('unauthorized',401);
  if(!request.headers.get('content-type')?.startsWith('application/json'))
    return bad('invalid-request',415);
  const raw=await request.text().catch(()=>'');
  if(!raw||raw.length>90)return bad('invalid-request',400);
  let body:unknown;
  try{body=JSON.parse(raw);}catch{return bad('invalid-request',400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
     Object.keys(body).length!==1)return bad('invalid-request',400);
  const operation=(body as {operation?:unknown}).operation;
  if(operation!=='launch'&&operation!=='inspect')
    return bad('invalid-operation',400);
  const selected=await selectedAccount();
  if(!selected)return bad('account-or-reference-unavailable',409);
  const token=process.env.APIFY_API_TOKEN;
  if(!token)return bad('missing-token',409);
  const filter={instagramAccountId:selected.accountId,action:APIFY_PILOT_ACTION};
  if(operation==='launch'){
    // Durable and exclusive reservation before remote POST.
    let claim:{id:string;receipt:Receipt}|null=null;
    try{
      claim=await prisma.$transaction(async tx=>{
        const lock=await tx.$queryRaw<Array<{acquired:boolean}>>`
          SELECT pg_try_advisory_xact_lock(
            hashtext('decolainsta_apify_25_pilot_v1'),
            hashtext(${selected.accountId})
          ) AS acquired
        `;
        if(lock.length!==1||lock[0].acquired!==true)return null;
        const old=await tx.activityLog.findFirst({where:filter,select:{id:true}});
        if(old)return null; // One lifetime attempt, no automatic retry.
        const receipt:Receipt={version:1,state:'claimed',
          ...selected,actor:APIFY_PILOT_ACTOR,runId:null,
          resultsLimit:APIFY_PILOT_RESULTS_LIMIT,maxUsd:APIFY_PILOT_MAX_USD,
          resultCount:0,costUsd:null};
        const row=await tx.activityLog.create({data:{
          instagramAccountId:selected.accountId,action:APIFY_PILOT_ACTION,
          targetUsername:selected.referenceUsername,success:false,
          details:JSON.stringify(receipt),
        },select:{id:true}});
        return {id:row.id,receipt};
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    }catch{return bad('reservation-unavailable',503);}
    if(!claim)return NextResponse.json({status:'already-reserved',
      actorRunsLaunched:0,instagramActionsExecuted:0},{headers});
    const started=await startCappedApifyPilot(token,selected.referenceUsername);
    const updated:Receipt={...claim.receipt,
      state:started.status==='queued'?'launched':started.status==='refused'?
        'rejected':'unconfirmed',runId:started.runId};
    await prisma.activityLog.updateMany({where:{id:claim.id,
      instagramAccountId:selected.accountId,
      action:APIFY_PILOT_ACTION,details:JSON.stringify(claim.receipt)},
      data:{details:JSON.stringify(updated)}});
    return NextResponse.json({
      status:started.status==='queued'?'queued':started.status,
      runId:started.runId??null,reference:selected.referenceUsername,
      maxResults:APIFY_PILOT_RESULTS_LIMIT,maxTotalChargeUsd:APIFY_PILOT_MAX_USD,
      actorRunsLaunched:started.status==='queued'?1:0,
      instagramActionsExecuted:0,noAutomaticRetry:true,
    },{headers});
  }
  const row=await prisma.activityLog.findFirst({
    where:filter,orderBy:[{createdAt:'desc'},{id:'desc'}],
    select:{id:true,details:true,success:true},
  });
  const receipt=parseReceipt(row?.details);
  if(!row||!receipt||receipt.accountId!==selected.accountId||
     receipt.referenceId!==selected.referenceId||
     receipt.referenceUsername!==selected.referenceUsername)
    return bad('receipt-unavailable',409);
  const base={reference:receipt.referenceUsername,runId:receipt.runId,
    maxResults:APIFY_PILOT_RESULTS_LIMIT,
    actorRunsLaunched:0,instagramActionsExecuted:0,
    noAutomaticRetry:true};
  if(receipt.state!=='launched'||!receipt.runId)
    return NextResponse.json({...base,status:receipt.state,
      resultCount:receipt.resultCount,costUsd:receipt.costUsd},{headers});
  const run=await inspectCappedApifyRun(token,receipt.runId);
  if(run.status==='running'||run.status==='unavailable')
    return NextResponse.json({...base,status:run.status},{headers});
  let state:Receipt['state']='finished-unverified';
  let usernames:string[]=[];
  if(run.status==='failed')state='failed';
  else if(run.status==='succeeded'){
    const list=await readApifyTrialDataset(token,run.datasetId,
      receipt.referenceUsername);
    if(list.status==='verified'){
      usernames=list.usernames;
      state=usernames.length?'finished':'finished-empty';
    }
  }
  const changed:Receipt={...receipt,state,
    resultCount:usernames.length,costUsd:run.costUsd};
  try{
    const committed=await prisma.$transaction(async tx=>{
      const count=await tx.activityLog.updateMany({
        where:{id:row.id,details:row.details,instagramAccountId:selected.accountId,
          action:APIFY_PILOT_ACTION},
        data:{details:JSON.stringify(changed),success:state==='finished'},
      });
      if(count.count!==1)return false;
      if(state==='finished'){
        // Separate provider provenance: never forge a PhantomBuster history
        // receipt, and never enable automatic follows from these samples.
        for(let i=0;i<usernames.length;i+=10){
          const sample={version:1,source:'apify-public-no-cookie',
            actor:APIFY_PILOT_ACTOR,runId:receipt.runId,
            referenceId:receipt.referenceId,
            referenceUsername:receipt.referenceUsername,
            usernames:usernames.slice(i,i+10),completeFollowerList:false,
            verifiedByMeta:false};
          await tx.activityLog.create({data:{
            instagramAccountId:selected.accountId,
            action:APIFY_PILOT_SAMPLE_ACTION,
            targetUsername:receipt.referenceUsername,
            success:true,details:JSON.stringify(sample),
          }});
        }
      }
      return true;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    if(!committed)return bad('concurrent-inspection',409);
  }catch{return bad('import-unavailable',503);}
  return NextResponse.json({...base,status:state,
    resultCount:usernames.length,costUsd:run.costUsd,
    samplesSaved:state==='finished'?usernames.length:0,
  },{headers});
}
