import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {
 APIFY_FOLLOW_OBSERVATION_ACTION,
 parseOperatorFollowObservation,
 matchOperatorFollowObservation,
} from '../lib/providers/apify-pilot-relationship-observation';
import {evaluateUnfollowEligibility,type UnfollowEvidence}
 from '../lib/providers/apify-unfollow-eligibility';

const observed={
 version:1,
 accountInstagramUserId:'17841411544892772',
 targetUsername:'0_crismeendes',
 runId:'9ogdK0qqIaPFn4ZPk',
 relationship:'requested_pending',
 source:'operator_reported_instagram_ui',
 followAccepted:false,
 followIndependentlyVerified:false,
 automatedUnfollowEnabled:false,
} as const;

test('accept pending request as operator report, NEVER an accepted follow',()=>{
 assert.equal(APIFY_FOLLOW_OBSERVATION_ACTION,
  'apify_pilot_relationship_observation_v1');
 const result=parseOperatorFollowObservation(JSON.stringify(observed));
 assert.deepEqual(result,observed);
 assert.equal(result?.followAccepted,false);
 assert.equal(result?.followIndependentlyVerified,false);
 assert.equal(result?.automatedUnfollowEnabled,false);
});

test('observation must match exact run and target; invalid success is rejected',()=>{
 assert.deepEqual(matchOperatorFollowObservation(JSON.stringify(observed),{
  targetUsername:observed.targetUsername,runId:observed.runId,
 }),observed);
 for(const expected of [
  {targetUsername:'outro_destino',runId:observed.runId},
  {targetUsername:observed.targetUsername,runId:'nd88TvRT6EOn8IC1O'},
  {targetUsername:observed.targetUsername,runId:null},
 ]){
  assert.equal(matchOperatorFollowObservation(
   JSON.stringify(observed),expected),null);
 }
 for(const change of [
  {followAccepted:true},
  {followIndependentlyVerified:true},
  {automatedUnfollowEnabled:true},
  {relationship:'following_confirmed'},
  {source:'apify_dataset'},
  {unexpectedProperty:true},
 ]){
  assert.equal(parseOperatorFollowObservation(
    JSON.stringify({...observed,...change})),null);
 }
});

test('pending requests can never qualify for unfollow even at 48h',()=>{
 const evidence:UnfollowEvidence={
  identity:{
   instagramUserId:'17841411544892772',username:'apoistecnologia',
   previousUsernames:['contateste6699'],
  },
  targetUsername:observed.targetUsername,
  targetInstagramUserId:'1122334455667788',
  followedAt:'2026-11-20T00:00:00Z',
  followIndependentlyVerified:true,
  currentlyFollowing:true,
  pendingRequest:true,
  reciprocityVerified:true,followedBack:false,
  protectedAccount:false,anyPriorUnfollowAttempt:false,
  policy:'unfollow-after-48h',
 };
 const r=evaluateUnfollowEligibility(
  evidence,new Date('2026-11-23T00:00:00Z'));
 assert.equal(r.reason,'pending-request');
 assert.equal(r.eligible,false);
 assert.equal(r.executorEnabled,false);
 assert.equal(r.actorRunsStarted,0);
});

test('readiness UI distinguishes user-reported pending from provider report',()=>{
 const route=readFileSync(
  'app/api/operator/apify/reference-one-follow-pilot/route.ts','utf8');
 const ui=readFileSync(
  'app/(app)/references/_components/apify-reference-one-follow-pilot.tsx','utf8');
 assert.match(route,/APIFY_FOLLOW_OBSERVATION_ACTION/);
 assert.match(route,/matchOperatorFollowObservation/);
 assert.match(route,/operatorObservedRelationship:observation\?'requested_pending':'unknown'/);
 assert.match(route,/followAcceptedConfirmed:false/);
 assert.match(route,/followIndependentlyVerified:false/);
 assert.match(ui,/“Solicitado”/);
 assert.match(ui,/Nenhum follow aceito nem unfollow automático foi confirmado/);
 assert.doesNotMatch(route,/startOneUnfollow\(|unfollowEnabled:true/);
});
