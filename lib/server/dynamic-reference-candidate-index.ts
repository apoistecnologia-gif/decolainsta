import type {Prisma} from '@prisma/client';
import {
  AUDIENCE_CANDIDATE_ACTION, AUDIENCE_HISTORY_ACTION,
  MAX_CANDIDATES_PER_ACCOUNT, MAX_QUEUE_ENTRIES_PER_SYNC,
  MAX_SNAPSHOTS_PER_SYNC, makeCandidateEvidence, parseCandidateEvidence,
  planCandidateIndex,
} from '@/lib/reference-candidate-queue';
import {MANUAL_SOURCE_PREFIX, REFERENCE_ACTIONS} from '@/lib/reference-workflow';

/**
 * Index the SAVED, account-owned history in the same serializable transaction
 * that finalizes the verified PhantomBuster container. No provider calls,
 * no follows and no dependency on a browser POST.
 *
 * Returns null on capacity/integrity uncertainty so the entire transaction
 * rolls back, leaving the original launched container available to reconcile.
 */
export async function indexSavedAudienceCandidates(
  tx:Prisma.TransactionClient, accountId:string,
):Promise<{indexed:number}|null>{
  const [account,references,snapshots,existing,protectedNames,manualActions]=await Promise.all([
    tx.instagramAccount.findUnique({
      where:{id:accountId},select:{username:true},
    }),
    tx.targetAccount.findMany({
      where:{instagramAccountId:accountId},
      select:{id:true,username:true},take:101,
    }),
    tx.activityLog.findMany({
      where:{instagramAccountId:accountId,action:AUDIENCE_HISTORY_ACTION},
      select:{id:true,targetUsername:true,details:true,createdAt:true},
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      take:MAX_SNAPSHOTS_PER_SYNC+1,
    }),
    tx.activityLog.findMany({
      where:{instagramAccountId:accountId,action:AUDIENCE_CANDIDATE_ACTION},
      select:{targetUsername:true,details:true},
      take:MAX_QUEUE_ENTRIES_PER_SYNC+1,
    }),
    tx.whitelist.findMany({
      where:{instagramAccountId:accountId},select:{username:true},take:2001,
    }),
    tx.followAction.findMany({
      where:{instagramAccountId:accountId,isDryRun:false,
        sourceTarget:{startsWith:MANUAL_SOURCE_PREFIX},
        action:{in:[...REFERENCE_ACTIONS]}},
      select:{targetUsername:true},take:2001,
    }),
  ]);
  if(!account||references.length>100||snapshots.length>MAX_SNAPSHOTS_PER_SYNC||
     existing.length>MAX_QUEUE_ENTRIES_PER_SYNC||
     protectedNames.length>2000||manualActions.length>2000)return null;

  const registered=new Map(references.map(r=>[r.id,r.username.toLowerCase()]));
  const used=new Set(existing.flatMap(item=>{
    const parsed=parseCandidateEvidence(item.details);
    const name=item.targetUsername?.toLowerCase();
    return parsed&&name&&
      registered.get(parsed.referenceId)===parsed.referenceUsername
      ?[name]:[];
  }));
  const exclude=[
    account.username.toLowerCase(),...protectedNames.map(r=>r.username.toLowerCase()),
    ...manualActions.map(r=>r.targetUsername.toLowerCase()),
  ];
  const capacity=Math.max(0,MAX_CANDIDATES_PER_ACCOUNT-existing.length);
  const plan=planCandidateIndex(references,snapshots,used,exclude,capacity);
  const records=plan.insert.map(candidate=>{
    const evidence=makeCandidateEvidence(
      candidate.referenceId,candidate.referenceUsername,
      candidate.snapshotId,candidate.collectorAgentId);
    return evidence?{
      instagramAccountId:accountId,targetUsername:candidate.username,
      action:AUDIENCE_CANDIDATE_ACTION,success:true,details:JSON.stringify(evidence),
    }:null;
  });
  if(records.some(r=>r===null))return null;
  if(records.length){
    await tx.activityLog.createMany({data:records.filter((r):r is NonNullable<typeof r>=>r!==null)});
  }
  return {indexed:records.length};
}
