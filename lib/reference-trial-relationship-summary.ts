import {
  parseTrialEvidence,type TrialEvidence,
} from './reference-followers-trial';

/** Account-scoped trial rows only. Never infer Instagram relationship success. */
export type TrialSummaryRow={details:string|null;createdAt:Date};
export type TrialRelationshipSummary={
  source:'provider-report-and-owner-observation';
  providerActions:number;
  pendingObserved:number;
  followingObserved:number;
  endedObserved:number;
  unknownRelationships:number;
  followBackYesObserved:number;
  followBackNoObserved:number;
  independentlyConfirmedFollows:0;
  independentlyConfirmedFollowBacks:0;
  eligibleForAutomaticUnfollow:0;
  unfollowAutomationEnabled:false;
};
const name=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
export function summarizeTrialRelationships(
  rows:Iterable<TrialSummaryRow>,
):TrialRelationshipSummary{
  const byUser=new Map<string,{created:number;evidence:TrialEvidence}>();
  for(const row of rows){
    const evidence=parseTrialEvidence(row.details);
    if(!evidence||evidence.stage!=='provider-reported'||
      !name(evidence.providerReportedUsername)||
      evidence.providerReportedCount!==1||
      !(row.createdAt instanceof Date)||!Number.isFinite(row.createdAt.getTime()))
      continue;
    const username=evidence.providerReportedUsername;
    const prior=byUser.get(username);
    if(!prior||row.createdAt.getTime()>prior.created)
      byUser.set(username,{created:row.createdAt.getTime(),evidence});
  }
  const result:TrialRelationshipSummary={
    source:'provider-report-and-owner-observation',
    providerActions:byUser.size,
    pendingObserved:0,followingObserved:0,endedObserved:0,
    unknownRelationships:0,followBackYesObserved:0,followBackNoObserved:0,
    independentlyConfirmedFollows:0,independentlyConfirmedFollowBacks:0,
    eligibleForAutomaticUnfollow:0,unfollowAutomationEnabled:false,
  };
  for(const {evidence} of byUser.values()){
    if(evidence.relationshipObservation==='requested')result.pendingObserved++;
    else if(evidence.relationshipObservation==='following'){
      result.followingObserved++;
      if(evidence.followBackObservation==='yes')result.followBackYesObserved++;
      if(evidence.followBackObservation==='no')result.followBackNoObserved++;
    }else if(evidence.relationshipObservation==='none')result.endedObserved++;
    else result.unknownRelationships++;
  }
  return result;
}
