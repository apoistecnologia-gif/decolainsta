import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  assessUnfollowEligibility, type UnfollowEligibilityInput,
} from '../lib/reference-unfollow-eligibility';

const base:UnfollowEligibilityInput={
  relationship:'following',
  confirmedFollowAt:new Date('2026-11-18T12:00:00.000Z'),
  confirmationSource:'independent-verified',
  now:new Date('2026-11-20T12:00:00.000Z'),
  pendingRequest:false,
  followsBack:false,
  protectedAccount:false,
  inWhitelist:false,
  authorized:true,
};
test('48-hour rule has an exact boundary, never initiates actions',()=>{
  assert.deepEqual(assessUnfollowEligibility(base),{
    eligible:true,eligibleAt:'2026-11-20T12:00:00.000Z',reason:'eligible',
  });
  assert.deepEqual(assessUnfollowEligibility({...base,
    now:new Date('2026-11-20T11:59:59.999Z')}),{
    eligible:false,eligibleAt:'2026-11-20T12:00:00.000Z',
    reason:'under-48-hours',
  });
});
test('pending, unknown, owner observation, provider claim always fail closed',()=>{
  const changes:Partial<UnfollowEligibilityInput>[]=[
    {relationship:'requested'},
    {relationship:'none'},
    {relationship:'unknown'},
    {pendingRequest:true},
    {confirmationSource:'provider-reported'},
    {confirmationSource:'owner-visual-check'},
    {confirmationSource:'unknown'},
    {followsBack:'unknown'},
    {followsBack:true},
    {protectedAccount:true},
    {inWhitelist:true},
    {authorized:false},
    {confirmedFollowAt:null},
    {confirmedFollowAt:new Date('not-a-date')},
    {now:new Date('not-a-date')},
    {confirmedFollowAt:new Date('2026-11-21T12:00:00.000Z')},
  ];
  for(const change of changes){
    const decision=assessUnfollowEligibility({...base,...change});
    assert.equal(decision.eligible,false,JSON.stringify(change));
  }
});
test('provider reported privacy or success never grants independent verification',()=>{
  assert.equal(assessUnfollowEligibility({...base,
    confirmationSource:'provider-reported'}).reason,'not-independently-verified');
  assert.equal(assessUnfollowEligibility({...base,
    confirmationSource:'owner-visual-check'}).eligible,false);
});
