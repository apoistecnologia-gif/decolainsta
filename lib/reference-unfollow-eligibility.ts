/**
 * Pure, dormant eligibility gate. No provider presently supplies an
 * independently verified Instagram follow; this module executes NO actions.
 * A provider's "1 profile followed" or an owner's visual observation does
 * NOT satisfy independent confirmation. An unknown follow-back blocks removal.
 */
export type UnfollowEligibilityInput={
  relationship:'requested'|'following'|'none'|'unknown';
  confirmedFollowAt:Date|null;
  confirmationSource:'independent-verified'|'provider-reported'|'owner-visual-check'|'unknown';
  now:Date;
  pendingRequest:boolean;
  followsBack:boolean|'unknown';
  protectedAccount:boolean;
  inWhitelist:boolean;
  authorized:boolean;
};
export type UnfollowDecision={
  eligible:boolean;
  eligibleAt:string|null;
  reason:'not-authorized'|'protected'|'pending-request'|'not-following'|
    'not-independently-verified'|'follow-back-unknown'|'follows-back'|
    'invalid-date'|'under-48-hours'|'eligible';
};
const FORTY_EIGHT_HOURS=48*60*60*1000;
const blocked=(reason:UnfollowDecision['reason']):UnfollowDecision=>({
  eligible:false,eligibleAt:null,reason,
});
export function assessUnfollowEligibility(
  input:UnfollowEligibilityInput,
):UnfollowDecision{
  if(!input.authorized)return blocked('not-authorized');
  if(input.protectedAccount||input.inWhitelist)return blocked('protected');
  if(input.pendingRequest||input.relationship==='requested')
    return blocked('pending-request');
  if(input.relationship!=='following')return blocked('not-following');
  if(input.confirmationSource!=='independent-verified')
    return blocked('not-independently-verified');
  if(input.followsBack==='unknown')return blocked('follow-back-unknown');
  if(input.followsBack)return blocked('follows-back');
  const started=input.confirmedFollowAt?.getTime();
  const now=input.now.getTime();
  if(started===undefined||!Number.isFinite(started)||!Number.isFinite(now)||
     started>now || started>8640000000000000-FORTY_EIGHT_HOURS)
    return blocked('invalid-date');
  const eligibleAt=new Date(started+FORTY_EIGHT_HOURS).toISOString();
  if(now<started+FORTY_EIGHT_HOURS)
    return {eligible:false,eligibleAt,reason:'under-48-hours'};
  return {eligible:true,eligibleAt,reason:'eligible'};
}
