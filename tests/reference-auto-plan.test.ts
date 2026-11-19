import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { planAudienceAutomatically } from '../lib/reference-auto-plan';

test('automatic plan mixes saved reference followers, excludes existing and protected, no clicks per person', () => {
  const plan = planAudienceAutomatically([
    { referenceId: 'r1', referenceUsername: 'reference_a',
      usernames: ['a1', 'a2', 'duplicate', 'owner', 'protected', 'reference_b'] },
    { referenceId: 'r2', referenceUsername: 'reference_b',
      usernames: ['b1', 'b2', 'duplicate', 'tracked'] },
  ], ['owner', 'protected', 'tracked'], 'testday');
  assert.equal(plan.source, 'saved_snapshots_unverified');
  assert.equal(plan.eligibleDistinct, 6);
  assert.equal(plan.referencesWithSnapshots, 2);
  assert.equal(plan.candidates.length, 6);
  assert.equal(new Set(plan.candidates.map(x => x.username)).size, 6);
  assert.equal(new Set(plan.candidates.map(x => x.referenceUsername)).size, 2);
  assert.ok(plan.candidates.every(x => !['owner','protected','tracked','reference_b'].includes(x.username)));
  assert.equal(plan.actionsEnabled, false);
  assert.equal(plan.readOnly, true);
  assert.equal(plan.referenceVerified, false);
  assert.equal(plan.followbackVerified, false);
  assert.equal(plan.suggestedReviewAfterHours, 48);
});

test('automatic preview never returns more than ten and does not mutate input', () => {
  const pool = [{
    referenceId: 'r', referenceUsername: 'reference',
    usernames: Array.from({ length: 26 }, (_, i) => 'person' + i),
  }];
  const first = planAudienceAutomatically(pool, [], '2026-11-19');
  const second = planAudienceAutomatically(pool, [], '2026-11-19');
  assert.equal(first.candidates.length, 10);
  assert.deepEqual(first.candidates, second.candidates);
  assert.equal(first.eligibleDistinct, 26);
  assert.equal(pool[0].usernames[0], 'person0');
  assert.equal(planAudienceAutomatically([], [], 'today').candidates.length, 0);
});

test('automatic plan route is owned and pilot-scoped with no external actions', () => {
  const route = readFileSync('app/api/reference-auto-plan/route.ts', 'utf8');
  assert.match(route, /const session = await auth\(\)/);
  assert.match(route, /where: \{ id: accountId, userId \}/);
  assert.match(route, /PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(route, /AUDIENCE_HISTORY_ACTION/);
  assert.match(route, /parseAudienceSnapshot\(snapshotRow.details\)/);
  assert.match(route, /planAudienceAutomatically\(/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST|fetch\(|create\(|update\(|upsert\(|delete\(|launch|user_follow|user_unfollow/);
});

test('automatic workflow avoids individual follower selection or claiming live actions', () => {
  const main = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  const ui = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx', 'utf8');
  assert.match(main, /AutomaticAudiencePlanPanel/);
  assert.match(ui, /não precisa selecionar perfis individuais/);
  assert.match(ui, /48 horas após o follow/);
  assert.match(ui, /nenhum temporizador de ação real foi ativado/);
  assert.doesNotMatch(ui, /Acompanhar ao lado|audience-candidate|confirmAdd: true|agents\/launch/);
});
