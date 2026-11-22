import {
  APIFY_PILOT_ACTOR,APIFY_PILOT_MAX_USD,APIFY_PILOT_RESULTS_LIMIT,
} from '@/lib/providers/apify-followers-trial';
import {
  makeApifyCandidateEvidence,validCandidateUsername,
  type ApifyCandidateEvidence,
} from '@/lib/reference-candidate-queue';

type RecordValue=Record<string,unknown>;
const obj=(v:unknown):RecordValue|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:null;
const id=(v:unknown):v is string=>typeof v==='string'&&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const runId=(v:unknown):v is string=>typeof v==='string'&&
  /^[A-Za-z0-9]{17,24}$/.test(v);
function decode(details:unknown):RecordValue|null{
  if(typeof details!=='string'||details.length>1800)return null;
  try{return obj(JSON.parse(details) as unknown);}catch{return null;}
}
const keys=(v:RecordValue,expected:readonly string[])=>
  Object.keys(v).length===expected.length&&
  Object.keys(v).every(key=>expected.includes(key));

export type CompletedApifyReceipt=Readonly<{
  accountId:string;referenceId:string;referenceUsername:string;
  runId:string;resultCount:number;
}>;
/** Complete, unique provider receipt: no unverified or still-running source. */
export function parseCompletedApifyReceipt(details:unknown):CompletedApifyReceipt|null{
  const v=decode(details);
  if(!v||!keys(v,['version','state','accountId','referenceId',
      'referenceUsername','actor','runId','resultsLimit','maxUsd',
      'resultCount','costUsd'])||
    v.version!==1||v.state!=='finished'||v.actor!==APIFY_PILOT_ACTOR||
    v.resultsLimit!==APIFY_PILOT_RESULTS_LIMIT||
    v.maxUsd!==APIFY_PILOT_MAX_USD||
    !id(v.accountId)||!id(v.referenceId)||
    !validCandidateUsername(v.referenceUsername)||!runId(v.runId)||
    !Number.isInteger(v.resultCount)||typeof v.resultCount!=='number'||
    v.resultCount<1||v.resultCount>APIFY_PILOT_RESULTS_LIMIT||
    (v.costUsd!==null&&(typeof v.costUsd!=='number'||!Number.isFinite(v.costUsd)||
      v.costUsd<0)))return null;
  return {accountId:v.accountId,referenceId:v.referenceId,
    referenceUsername:v.referenceUsername,runId:v.runId,
    resultCount:v.resultCount};
}

export type ApifySample=Readonly<{
  runId:string;referenceId:string;referenceUsername:string;usernames:string[];
}>;
export function parseSavedApifySample(details:unknown):ApifySample|null{
  const v=decode(details);
  if(!v||!keys(v,['version','source','actor','runId','referenceId',
      'referenceUsername','usernames','completeFollowerList','verifiedByMeta'])||
    v.version!==1||v.source!=='apify-public-no-cookie'||
    v.actor!==APIFY_PILOT_ACTOR||!runId(v.runId)||
    !id(v.referenceId)||!validCandidateUsername(v.referenceUsername)||
    v.completeFollowerList!==false||v.verifiedByMeta!==false||
    !Array.isArray(v.usernames)||v.usernames.length<1||
    v.usernames.length>10||!v.usernames.every(validCandidateUsername)||
    new Set(v.usernames).size!==v.usernames.length||
    v.usernames.includes(v.referenceUsername))return null;
  return {runId:v.runId,referenceId:v.referenceId,
    referenceUsername:v.referenceUsername,usernames:v.usernames};
}

export type ApifySampleRow={
  id:string;targetUsername:string|null;details:string|null;success:boolean;
};
export type PlannedApifyCandidate={
  username:string;evidence:ApifyCandidateEvidence;
};
export type ApifyCandidatePlan=
 |{status:'invalid'|'capacity-reached';insert:[];found:0;skippedExisting:0}
 |{status:'verified';insert:PlannedApifyCandidate[];found:number;
     skippedExisting:number};

/** All samples must match one finished exact run; never merge provider outputs.
 * Duplicate sampled usernames invalidate the run; existing candidate names
 * are skipped across both PhantomBuster v1 and Apify v2 evidence.
 */
export function planSavedApifyCandidates(
  receipt:CompletedApifyReceipt,rows:readonly ApifySampleRow[],
  existing:Iterable<string>,excluded:Iterable<string>,
  remainingCapacity:number,
):ApifyCandidatePlan{
  const invalid={status:'invalid' as const,insert:[] as [],found:0,skippedExisting:0};
  if(rows.length===0||rows.length>3||!Number.isInteger(remainingCapacity)||
     remainingCapacity<0||receipt.resultCount>25)return invalid;
  const known=new Set([...existing].filter(validCandidateUsername).map(x=>x.toLowerCase()));
  const protectedNames=new Set([...excluded].filter(validCandidateUsername)
    .map(x=>x.toLowerCase()));
  protectedNames.add(receipt.referenceUsername);
  const seen=new Set<string>(),insert:PlannedApifyCandidate[]=[];
  let already=0;
  for(const row of rows){
    if(!id(row.id)||!row.success||row.targetUsername!==receipt.referenceUsername)
      return invalid;
    const sample=parseSavedApifySample(row.details);
    if(!sample||sample.runId!==receipt.runId||
       sample.referenceId!==receipt.referenceId||
       sample.referenceUsername!==receipt.referenceUsername)return invalid;
    for(const username of sample.usernames){
      if(seen.has(username))return invalid;
      seen.add(username);
      if(known.has(username)){already++;continue;}
      if(protectedNames.has(username))continue;
      const evidence=makeApifyCandidateEvidence(receipt.referenceId,
        receipt.referenceUsername,row.id,receipt.runId);
      if(!evidence)return invalid;
      insert.push({username,evidence});
    }
  }
  if(seen.size!==receipt.resultCount)return invalid;
  if(insert.length>remainingCapacity){
    return {status:'capacity-reached',insert:[],found:0,skippedExisting:0};
  }
  return {status:'verified',insert,found:seen.size,skippedExisting:already};
}
