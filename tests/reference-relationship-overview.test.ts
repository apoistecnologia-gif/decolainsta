import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { summarizeReportedRelationships, type ReportedRelationship } from '../lib/reference-relationship-overview';

const now = new Date('2026-11-19T18:00:00.000Z');
const row = (username: string, action: string, followedAt: Date | null, followedBack = false):
  ReportedRelationship => ({ targetUsername: username, action, followedAt, followedBack });

test('inert overview preserves collector-only status for every saved candidate', () => {
  const s = summarizeReportedRelationships(['a','b','c'], [], [], now);
  assert.equal(s.identifiedWithoutReportedAction,3);
  assert.equal(s.identifiedWithReportedAction,0);
  assert.equal(s.reportedFollowed,0);
  assert.equal(s.followBackReported,0);
  assert.equal(s.due48hReview,0);
  assert.equal(s.socialActionsEnabled,false);
  assert.equal(s.followbackVerifiedByMeta,false);
  assert.equal(s.reviewHours,48);
});

test('48 hours starts at reported follow timestamp, not at collection or follow-back', () => {
  const prior = new Date('2026-11-17T18:00:00.000Z');
  const justBefore = new Date('2026-11-17T18:00:00.001Z');
  const s = summarizeReportedRelationships(['a','b','c','d','e','f','g'], [
    row('a','reference_followed',prior,true),
    row('b','reference_followed',justBefore,true),
    row('c','reference_followed',prior,false),
    row('d','reference_followed',prior,true),
    row('e','reference_followed',null,true),
    row('f','reference_kept',prior,true),
    row('g','reference_unfollowed',prior,true),
    row('other','reference_candidate',null,false),
  ], ['d'], now);
  assert.equal(s.reportedRecords,8);
  assert.equal(s.reportedFollowed,5);
  assert.equal(s.followBackReported,3);
  assert.equal(s.due48hReview,1);
  assert.equal(s.awaiting48h,1);
  assert.equal(s.followBackNotReported,1);
  assert.equal(s.protectedDue48h,1);
  assert.equal(s.invalidFollowTimestamps,1);
  assert.equal(s.keptReported,1);
  assert.equal(s.unfollowReported,1);
  assert.equal(s.manuallyTrackedCandidates,1);
  assert.equal(s.identifiedWithReportedAction,7);
  assert.equal(s.identifiedWithoutReportedAction,0);
});

test('future timestamps, malformed users and unknown actions never count as eligible review', () => {
  const result = summarizeReportedRelationships(['safe','foo'], [
    row('safe','reference_followed',new Date('2026-11-20T00:00:00Z'),true),
    row('invalid/user','reference_followed',new Date('2020-01-01'),true),
    row('foo','unknown',new Date('2020-01-01'),true),
  ], [], now);
  assert.equal(result.reportedRecords,2);
  assert.equal(result.invalidFollowTimestamps,1);
  assert.equal(result.due48hReview,0);
  assert.equal(result.identifiedWithReportedAction,2);
  assert.equal(result.identifiedWithoutReportedAction,0);
});

test('account-scoped read-only endpoint supplies explicit separated overview and UI', () => {
  const route = readFileSync('app/api/reference-candidate-queue/route.ts','utf8');
  const ui = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx','utf8');
  const helper = readFileSync('lib/reference-relationship-overview.ts','utf8');
  assert.match(route,/where: \{ id: accountId, userId \}/);
  assert.match(route,/sourceTarget: \{ startsWith: MANUAL_SOURCE_PREFIX \}/);
  assert.match(route,/summarizeReportedRelationships\(/);
  assert.match(ui,/Estados de acompanhamento — somente registros informados/);
  assert.match(ui,/Identificados sem ação informada/);
  assert.match(ui,/Nenhum follow ou unfollow executado pelo DECOLA INSTA/);
  assert.doesNotMatch(helper,/prisma\.|fetch\(|user_follow|user_unfollow|agents\/launch|setTimeout/);
});
