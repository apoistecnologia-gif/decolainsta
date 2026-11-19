import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MANUAL_SOURCE_PREFIX,
  REFERENCE_ACTIONS,
  referenceFromSource,
  referenceSource,
  reviewIsDue,
  reviewTime,
} from '../lib/reference-workflow';

test('reference manual source is namespaced and reversible', () => {
  assert.equal(referenceSource('conta_referencia'), `${MANUAL_SOURCE_PREFIX}conta_referencia`);
  assert.equal(referenceFromSource(referenceSource('conta_referencia')), 'conta_referencia');
  assert.equal(referenceFromSource('simulated_reference'), null);
  assert.equal(referenceFromSource(null), null);
  assert.deepEqual(REFERENCE_ACTIONS, [
    'reference_candidate', 'reference_followed', 'reference_kept', 'reference_unfollowed',
  ]);
});

test('24h and 72h review deadlines use the confirmed follow timestamp', () => {
  const followed = new Date('2026-11-18T12:00:00.000Z');
  assert.equal(reviewTime(followed, 24)?.toISOString(), '2026-11-19T12:00:00.000Z');
  assert.equal(reviewTime(followed, 72)?.toISOString(), '2026-11-21T12:00:00.000Z');
  assert.equal(reviewTime(followed, 12), null);
  assert.equal(reviewTime(followed, 0), null);
  assert.equal(reviewTime(followed, '24'), null);
  assert.equal(reviewTime(followed, undefined), null);
});

test('only a due follow without follow-back qualifies for manual review', () => {
  const deadline = new Date('2026-11-19T12:00:00.000Z');
  assert.equal(reviewIsDue('reference_followed', false, deadline, new Date('2026-11-19T11:59:59Z')), false);
  assert.equal(reviewIsDue('reference_followed', false, deadline, new Date('2026-11-19T12:00:00Z')), true);
  assert.equal(reviewIsDue('reference_followed', true, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_candidate', false, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_unfollowed', false, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_followed', false, null, new Date('2026-11-25T12:00:00Z')), false);
});

test('cloud workflow requires auth, scopes reference and lead by owned account and isolates demo', () => {
  const code = readFileSync('app/api/reference-workflow/route.ts', 'utf8');
  assert.match(code, /const userId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/);
  assert.match(code, /where: \{ id: accountId, userId \}/);
  assert.match(code, /id: input\.referenceId, instagramAccountId: ctx\.accountId/);
  assert.match(code, /instagramAccountId: ctx\.accountId/);
  assert.match(code, /isDryRun: false/);
  assert.match(code, /sourceTarget: \{ startsWith: MANUAL_SOURCE_PREFIX \}/);
  assert.match(code, /followedBack: false, unfollowScheduledAt: \{ lte: now \}/);
  assert.match(code, /prisma\.whitelist\.findUnique/);
  assert.doesNotMatch(code, /simulateFollow|simulateUnfollow|collectFollowers|publishPhoto|getProfile\(/);
  assert.match(code, /source: 'user_reported_not_meta_verified'/);
});

test('reference screen is primary and never claims Instagram action was executed', () => {
  const page = readFileSync('app/(app)/references/page.tsx', 'utf8');
  const panel = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  const sidebar = readFileSync('app/(app)/_components/app-sidebar.tsx', 'utf8');
  assert.match(page, /ReferenceWorkflowPanel/);
  assert.match(panel, /Confirmei que segui/);
  assert.match(panel, /Confirmei que deixei de seguir/);
  assert.match(panel, /não executa unfollow automaticamente/);
  assert.match(panel, /não uma coleta automatizada ou auditoria da Meta/);
  assert.ok(sidebar.indexOf("href: '/references'") < sidebar.indexOf("href: '/scheduled-posts'"));
});
