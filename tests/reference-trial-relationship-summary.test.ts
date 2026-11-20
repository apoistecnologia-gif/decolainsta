import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {summarizeTrialRelationships} from '../lib/reference-trial-relationship-summary';
import {makeTrialEvidence} from '../lib/reference-followers-trial';

const base={
  version:1 as const,referenceId:'refA',agentId:'1838046655144130',
  stage:'provider-reported' as const,containerId:'1838046655144131',
  followConfirmed:false as const,recipientKnown:false as const,
  sessionOwnerVerifiedByProvider:false as const,
  providerReportedUsername:'test_record1',providerReportedCount:1 as const,
};
const record=(input:Record<string,unknown>,at='2026-11-20T21:00:00.000Z')=>{
  const details=makeTrialEvidence({...base,...input});
  assert.ok(details);
  return {createdAt:new Date(at),details:JSON.stringify(details)};
};
test('pending request is not a follow or eligibility',()=>{
  const data=summarizeTrialRelationships([
    record({relationshipObservation:'requested',
      relationshipObservedAt:'2026-11-20T20:00:00.000Z',
      relationshipSource:'owner-visual-check'}),
  ]);
  assert.equal(data.providerActions,1);
  assert.equal(data.pendingObserved,1);
  assert.equal(data.independentlyConfirmedFollows,0);
  assert.equal(data.eligibleForAutomaticUnfollow,0);
  assert.equal(data.unfollowAutomationEnabled,false);
});
test('deduplicated owner observations never become independently verified',()=>{
  const following=record({relationshipObservation:'following',
    relationshipObservedAt:'2026-11-20T20:00:00.000Z',
    relationshipSource:'owner-visual-check',
    followBackObservation:'yes',followBackSource:'owner-visual-check',
    followBackObservedAt:'2026-11-20T20:10:00.000Z'});
  const data=summarizeTrialRelationships([following,following,
    record({providerReportedUsername:'test_record2',
      relationshipObservation:'none',relationshipObservedAt:'2026-11-20T21:00:00.000Z',
      relationshipSource:'owner-visual-check'})]);
  assert.equal(data.providerActions,2);
  assert.equal(data.followingObserved,1);
  assert.equal(data.followBackYesObserved,1);
  assert.equal(data.endedObserved,1);
  assert.equal(data.independentlyConfirmedFollowBacks,0);
  assert.equal(data.eligibleForAutomaticUnfollow,0);
});
test('malformed or unfinished provider reports do not inflate counts',()=>{
  const data=summarizeTrialRelationships([
    {details:'{"version":1,"followConfirmed":true}',createdAt:new Date()},
    {details:null,createdAt:new Date()},
    record({}),
  ]);
  assert.equal(data.providerActions,1);
  assert.equal(data.unknownRelationships,1);
});
test('account-only API never returns recipient names or performs provider calls',()=>{
  const route=readFileSync('app/api/reference-relationships/route.ts','utf8');
  assert.match(route,/where:\{id:accountId,userId\}/);
  assert.match(route,/instagramAccountId:account.id/);
  assert.match(route,/process.env.VERCEL_ENV!=='preview'/);
  assert.doesNotMatch(route,/agents\/launch|agents\/save|user_unfollow/);
  const panel=readFileSync(
    'app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(panel,/Solicitações|Pedidos pendentes observados/);
  assert.match(panel,/setRelationships/);
});
