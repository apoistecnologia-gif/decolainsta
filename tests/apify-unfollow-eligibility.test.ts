import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
 evaluateUnfollowEligibility,APIFY_UNFOLLOW_DELAY_HOURS,
 type UnfollowEvidence,
} from '../lib/providers/apify-unfollow-eligibility';
const base:UnfollowEvidence={
 identity:{instagramUserId:'17841411544892772',
   username:'apoistecnologia',previousUsernames:['contateste6699']},
 targetUsername:'destino_controlado',
 targetInstagramUserId:'1122334455667788',
 followedAt:'2026-11-20T12:00:00.000Z',
 followIndependentlyVerified:true,
 currentlyFollowing:true,
 reciprocityVerified:true,
 followedBack:false,
 protectedAccount:false,
 anyPriorUnfollowAttempt:false,
 policy:'retain-mutuals',
};
const now=new Date('2026-11-22T12:00:00.000Z');
test('only independently verified follows qualify after 48h, without executing anything',()=>{
 assert.equal(APIFY_UNFOLLOW_DELAY_HOURS,48);
 const ok=evaluateUnfollowEligibility(base,now);
 assert.deepEqual(ok,{
  eligible:true,reason:'ready-for-manual-approval',
  earliestAt:'2026-11-22T12:00:00.000Z',
  executorEnabled:false,actorRunsStarted:0,
 });
 const early=evaluateUnfollowEligibility(base,new Date('2026-11-22T11:59:59.000Z'));
 assert.equal(early.eligible,false);
 assert.equal(early.reason,'before-48h');
 assert.equal(early.earliestAt,'2026-11-22T12:00:00.000Z');
});
test('no unfollow if follow or present relationship is unverified',()=>{
 for(const [change,reason] of [
  [{followIndependentlyVerified:false},'unverified-follow'],
  [{currentlyFollowing:null},'following-not-confirmed'],
  [{reciprocityVerified:false},'reciprocity-unknown'],
  [{followedBack:null},'reciprocity-unknown'],
  [{followedAt:null},'invalid-time'],
 ] as const){
  const r=evaluateUnfollowEligibility({...base,...change},now);
  assert.equal(r.eligible,false);
  assert.equal(r.reason,reason);
  assert.equal(r.actorRunsStarted,0);
 }
});
test('self-account aliases, same stable identity, protected accounts and duplicate attempts block',()=>{
 for(const [change,reason] of [
  [{targetUsername:'contateste6699'},'own-account'],
  [{targetUsername:'apoistecnologia'},'own-account'],
  [{targetInstagramUserId:'17841411544892772'},'own-account'],
  [{targetInstagramUserId:null},'missing-target-id'],
  [{protectedAccount:true},'protected'],
  [{anyPriorUnfollowAttempt:true},'prior-unfollow'],
 ] as const){
  const r=evaluateUnfollowEligibility({...base,...change},now);
  assert.equal(r.eligible,false);
  assert.equal(r.reason,reason);
 }
});
test('reciprocity policy is explicit; never silently unfollow mutuals',()=>{
 assert.equal(evaluateUnfollowEligibility({
  ...base,followedBack:true,
 },now).reason,'retain-mutual');
 const allowed=evaluateUnfollowEligibility({
  ...base,followedBack:true,policy:'unfollow-after-48h',
 },now);
 assert.equal(allowed.eligible,true);
 assert.equal(allowed.executorEnabled,false);
});
