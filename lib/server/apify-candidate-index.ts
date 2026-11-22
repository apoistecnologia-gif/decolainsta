import type {Prisma} from '@prisma/client';
import {
  APIFY_PILOT_ACTION,APIFY_PILOT_SAMPLE_ACTION,
} from '@/lib/providers/apify-followers-trial';
import {
  AUDIENCE_CANDIDATE_ACTION,MAX_CANDIDATES_PER_ACCOUNT,
  MAX_QUEUE_ENTRIES_PER_SYNC,validCandidateUsername,
} from '@/lib/reference-candidate-queue';
import {
  parseCompletedApifyReceipt,planSavedApifyCandidates,
} from '@/lib/reference-apify-candidate-source';
import {REFERENCE_ACTIONS} from '@/lib/reference-workflow';

export type ApifyIndexResult={
  status:'indexed'|'invalid-source'|'capacity-reached';
  indexed:number;alreadyPresent:number;sourceCount:number;
  instagramActionsExecuted:0;
};

/**
 * Reusable and idempotent indexing of a previously saved Apify result.
 * Run inside an account-scoped SERIALIZABLE transaction. No provider access,
 * no FollowAction mutations and no fabricated PhantomBuster snapshot.
 */
export async function indexSavedApifyCandidates(
  tx:Prisma.TransactionClient,accountId:string,referenceId:string,
  referenceUsername:string,
):Promise<ApifyIndexResult>{
  const invalid:ApifyIndexResult={
    status:'invalid-source',indexed:0,alreadyPresent:0,sourceCount:0,
    instagramActionsExecuted:0,
  };
  const [account,reference,receipts,samples,existing,protectedNames,manualActions,
    registeredRefs]=await Promise.all([
    tx.instagramAccount.findUnique({
      where:{id:accountId},select:{username:true},
    }),
    tx.targetAccount.findFirst({
      where:{id:referenceId,username:referenceUsername,
        instagramAccountId:accountId},
      select:{id:true},
    }),
    tx.activityLog.findMany({
      where:{instagramAccountId:accountId,action:APIFY_PILOT_ACTION},
      select:{id:true,details:true,success:true,targetUsername:true},take:2,
    }),
    tx.activityLog.findMany({
      where:{instagramAccountId:accountId,action:APIFY_PILOT_SAMPLE_ACTION},
      select:{id:true,details:true,success:true,targetUsername:true},
      orderBy:[{createdAt:'asc'},{id:'asc'}],take:4,
    }),
    tx.activityLog.findMany({
      where:{instagramAccountId:accountId,action:AUDIENCE_CANDIDATE_ACTION},
      select:{targetUsername:true},take:MAX_QUEUE_ENTRIES_PER_SYNC+1,
    }),
    tx.whitelist.findMany({
      where:{instagramAccountId:accountId},select:{username:true},take:2001,
    }),
    tx.followAction.findMany({
      where:{instagramAccountId:accountId,isDryRun:false,
        action:{in:[...REFERENCE_ACTIONS]}},
      select:{targetUsername:true},take:2001,
    }),
    tx.targetAccount.findMany({
      where:{instagramAccountId:accountId},
      select:{username:true},take:101,
    }),
  ]);
  if(!account||!reference||receipts.length!==1||samples.length>3||
     existing.length>MAX_QUEUE_ENTRIES_PER_SYNC||protectedNames.length>2000||
     manualActions.length>2000||registeredRefs.length>100||
     !receipts[0].success||receipts[0].targetUsername!==referenceUsername)
    return invalid;
  const receipt=parseCompletedApifyReceipt(receipts[0].details);
  if(!receipt||receipt.accountId!==accountId||
     receipt.referenceId!==referenceId||
     receipt.referenceUsername!==referenceUsername)return invalid;

  const names=existing.map(x=>x.targetUsername)
    .filter(validCandidateUsername);
  const excluded=[
    account.username,...registeredRefs.map(r=>r.username),
    ...protectedNames.map(r=>r.username),
    ...manualActions.map(r=>r.targetUsername),
  ];
  const capacity=Math.max(0,MAX_CANDIDATES_PER_ACCOUNT-existing.length);
  const plan=planSavedApifyCandidates(receipt,samples,names,excluded,capacity);
  if(plan.status==='invalid')return invalid;
  if(plan.status==='capacity-reached')return {...invalid,status:'capacity-reached'};
  const entries=plan.insert.map(item=>({
    instagramAccountId:accountId,
    action:AUDIENCE_CANDIDATE_ACTION,
    targetUsername:item.username,
    details:JSON.stringify(item.evidence),
    success:true,
  }));
  if(entries.length)await tx.activityLog.createMany({data:entries});
  return {status:'indexed',indexed:entries.length,
    alreadyPresent:plan.skippedExisting,sourceCount:plan.found,
    instagramActionsExecuted:0};
}
