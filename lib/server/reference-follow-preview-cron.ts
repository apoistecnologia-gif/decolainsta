import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db';
import {AUDIENCE_CANDIDATE_ACTION,MAX_QUEUE_ENTRIES_PER_SYNC} from '@/lib/reference-candidate-queue';
import {
 FOLLOW_PREVIEW_CONTROL_ACTION,FOLLOW_PREVIEW_DECISION_ACTION,
 FOLLOW_PREVIEW_BATCH_SIZE,FOLLOW_PREVIEW_BATCH_MIN_MS,FOLLOW_PREVIEW_MAX_CONTROLS,
 planPreviewEligible,resolvePreviewRun,parsePreviewDecision,makePreviewDecision,
} from '@/lib/reference-follow-preview-control';

type Result={enabled:boolean;mode:'simulation';status:string;advanced:number;
 instagramActionsExecuted:0;realFollowsEnabled:false;realUnfollowsEnabled:false};
const result=(status:string,advanced=0,enabled=true):Result=>({
 enabled,mode:'simulation',status,advanced,instagramActionsExecuted:0,
 realFollowsEnabled:false,realUnfollowsEnabled:false,
});

/** Preview-only scheduled processor for an operator-started DRY RUN.
 * No network requests, credentials, provider commands or FollowAction writes.
 */
export async function runPreviewFollowSimulationCron():Promise<Result>{
 if(process.env.VERCEL_ENV!=='preview'||
    process.env.PHANTOMBUSTER_READONLY_ENABLED!=='yes')
   return result('disabled',0,false);
 const username=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT
   ?.replace(/^@/,'').toLowerCase()??'';
 if(!/^[a-z0-9._]{1,30}$/.test(username))return result('not-configured',0,false);
 const account=await prisma.instagramAccount.findFirst({
   where:{username},select:{id:true,username:true},
 });
 if(!account)return result('account-not-found');
 try{
  return await prisma.$transaction(async tx=>{
   const lock=await tx.$queryRaw<Array<{acquired:boolean}>>`
    SELECT pg_try_advisory_xact_lock(
      hashtext('reference_follow_preview_control_v1'),hashtext(${account.id})
    ) AS acquired
   `;
   if(lock.length!==1||lock[0].acquired!==true)return result('busy');
   const controls=await tx.activityLog.findMany({
    where:{instagramAccountId:account.id,action:FOLLOW_PREVIEW_CONTROL_ACTION},
    select:{id:true,details:true},orderBy:[{createdAt:'asc'},{id:'asc'}],
    take:FOLLOW_PREVIEW_MAX_CONTROLS+1,
   });
   if(controls.length>FOLLOW_PREVIEW_MAX_CONTROLS)return result('history-limit');
   const run=resolvePreviewRun(controls);
   if(!run)return result('invalid-control');
   if(run.state!=='simulating'||!run.runId)return result('not-running');
   const [rows,refs,whitelist,followed,decisions]=await Promise.all([
    tx.activityLog.findMany({where:{instagramAccountId:account.id,
       action:AUDIENCE_CANDIDATE_ACTION},
       select:{targetUsername:true,details:true},take:MAX_QUEUE_ENTRIES_PER_SYNC+1}),
    tx.targetAccount.findMany({where:{instagramAccountId:account.id},
       select:{id:true,username:true},take:101}),
    tx.whitelist.findMany({where:{instagramAccountId:account.id},
       select:{username:true},take:2001}),
    tx.followAction.findMany({where:{instagramAccountId:account.id,isDryRun:false},
       select:{targetUsername:true},take:2001}),
    tx.activityLog.findMany({where:{instagramAccountId:account.id,
       action:FOLLOW_PREVIEW_DECISION_ACTION,
       details:{contains:'"runId":"'+run.runId+'"'}},
       select:{targetUsername:true,details:true,createdAt:true},
       orderBy:[{createdAt:'asc'},{id:'asc'}],take:2001}),
   ]);
   if(rows.length>MAX_QUEUE_ENTRIES_PER_SYNC||refs.length>100||
      whitelist.length>2000||followed.length>2000||decisions.length>2000)
     return result('capacity-limit');
   const candidates=planPreviewEligible(rows,refs,account.username,
     whitelist.map(x=>x.username),followed.map(x=>x.targetUsername)).candidates;
   const valid=new Map(candidates.map(c=>[c.username,c]));
   const used=new Set<string>();
   for(const row of decisions){
    const event=parsePreviewDecision(row.details);
    const target=row.targetUsername?valid.get(row.targetUsername):null;
    if(!event||event.runId!==run.runId||!target||
       event.referenceId!==target.referenceId||
       event.referenceUsername!==target.referenceUsername||
       used.has(target.username))return result('review-required');
    used.add(target.username);
   }
   if(used.size===candidates.length)return result('complete');
   const last=decisions.at(-1);
   if(last&&Date.now()-last.createdAt.getTime()<FOLLOW_PREVIEW_BATCH_MIN_MS)
      return result('throttled');
   const next=candidates.filter(c=>!used.has(c.username))
     .slice(0,FOLLOW_PREVIEW_BATCH_SIZE);
   for(const candidate of next){
     const event=makePreviewDecision(run.runId,candidate.referenceId,
       candidate.referenceUsername);
     if(!event)return result('invalid-plan');
     await tx.activityLog.create({data:{
       instagramAccountId:account.id,
       action:FOLLOW_PREVIEW_DECISION_ACTION,
       targetUsername:candidate.username,
       details:JSON.stringify(event),success:true,
     }});
   }
   return result('advanced',next.length);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }catch{return result('unavailable');}
}
