/** Read-only readiness gate for a possible future ONE-unfollow.
 * It never launches Actors, schedules jobs or claims Instagram success.
 * Follow evidence and reciprocity MUST come from independent, trusted checks.
 */
import {
 isSelfFollowTarget,type InstagramExecutorIdentity,
} from './apify-one-follow';

export const APIFY_UNFOLLOW_DELAY_HOURS=48;
export type UnfollowDecisionReason=
 |'unverified-follow'|'invalid-time'|'own-account'|'missing-target-id'
 |'protected'|'prior-unfollow'|'following-not-confirmed'
 |'reciprocity-unknown'|'retain-mutual'|'before-48h'|'pending-request'
 |'ready-for-manual-approval';
export type UnfollowPolicy='retain-mutuals'|'unfollow-after-48h';
export type UnfollowEvidence=Readonly<{
 identity:InstagramExecutorIdentity;
 targetUsername:string;targetInstagramUserId:string|null;
 followedAt:string|null;followIndependentlyVerified:boolean;
 currentlyFollowing:boolean|null;pendingRequest?:boolean;
 reciprocityVerified:boolean;followedBack:boolean|null;
 protectedAccount:boolean;anyPriorUnfollowAttempt:boolean;
 policy:UnfollowPolicy;
}>;
export type UnfollowDecision=Readonly<{
 eligible:boolean;reason:UnfollowDecisionReason;earliestAt:string|null;
 executorEnabled:false;actorRunsStarted:0;
}>;
const deny=(reason:Exclude<UnfollowDecisionReason,'ready-for-manual-approval'>,
  earliestAt:string|null=null):UnfollowDecision=>({
  eligible:false,reason,earliestAt,executorEnabled:false,actorRunsStarted:0,
});
/** 'eligible' means only that a separately reviewed action MAY be proposed. */
export function evaluateUnfollowEligibility(
  evidence:UnfollowEvidence,now:Date=new Date(),
):UnfollowDecision{
  if(!evidence.followIndependentlyVerified)
    return deny('unverified-follow');
  if(!evidence.followedAt||Number.isNaN(now.getTime()))
    return deny('invalid-time');
  const followedAtMs=Date.parse(evidence.followedAt);
  if(!Number.isFinite(followedAtMs)||followedAtMs>now.getTime())
    return deny('invalid-time');
  if(isSelfFollowTarget(evidence.targetUsername,{
    ...evidence.identity,
    targetInstagramUserId:evidence.targetInstagramUserId,
  }))return deny('own-account');
  if(!evidence.targetInstagramUserId||
    !/^\d{4,30}$/.test(evidence.targetInstagramUserId))
    return deny('missing-target-id');
  if(evidence.protectedAccount)return deny('protected');
  if(evidence.anyPriorUnfollowAttempt)return deny('prior-unfollow');
  // A sent but unaccepted follow request is NOT an established follow.
  // Do not call unfollow while this relationship remains pending.
  if(evidence.pendingRequest===true)return deny('pending-request');
  if(evidence.currentlyFollowing!==true)
    return deny('following-not-confirmed');
  if(!evidence.reciprocityVerified||evidence.followedBack===null)
    return deny('reciprocity-unknown');
  if(evidence.followedBack&&evidence.policy==='retain-mutuals')
    return deny('retain-mutual');
  const earliestMs=followedAtMs+APIFY_UNFOLLOW_DELAY_HOURS*60*60*1000;
  if(!Number.isFinite(earliestMs)||Number.isNaN(new Date(earliestMs).getTime()))
    return deny('invalid-time');
  const earliestAt=new Date(earliestMs).toISOString();
  if(now.getTime()<earliestMs)return deny('before-48h',earliestAt);
  return {eligible:true,reason:'ready-for-manual-approval',
    earliestAt,executorEnabled:false,actorRunsStarted:0};
}
