import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { AUDIENCE_HISTORY_ACTION, MAX_HISTORY_BATCHES,
  makeAudienceSnapshot, parseAudienceSnapshot } from '../lib/reference-audience-history';

test('snapshot permits only ten allowlisted Instagram usernames with provenance and fingerprint', () => {
  const names = ['sample1', 'sample.two', 'sample_3'];
  const record = makeAudienceSnapshot('ref-id', 'mameto_lueji', '6396548176148717', names, 'completed_run');
  assert.ok(record);
  assert.equal(record.version, 1);
  assert.equal(record.verifiedByMeta, false);
  assert.equal(record.provenance, 'operator_assigned_collector_result');
  assert.equal(record.usernames.length, 3);
  assert.equal(record.fingerprint.length, 64);
  assert.deepEqual(parseAudienceSnapshot(JSON.stringify(record)), record);
  assert.equal(AUDIENCE_HISTORY_ACTION, 'reference_audience_snapshot_v1');
  assert.equal(MAX_HISTORY_BATCHES, 25);
});

test('snapshot is stable for exact repeated batches and changes for distinct provenance', () => {
  const a = makeAudienceSnapshot('ref-id', 'mameto_lueji', '6396548176148717', ['person.one'], 'completed_run');
  const b = makeAudienceSnapshot('ref-id', 'mameto_lueji', '6396548176148717', ['person.one'], 'completed_run');
  const c = makeAudienceSnapshot('ref-id', 'mameto_lueji', '6396548176148717', ['person.one'], 'latest_agent_file');
  const d = makeAudienceSnapshot('another', 'mameto_lueji', '6396548176148717', ['person.one'], 'completed_run');
  assert.ok(a && b && c && d);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
  assert.notEqual(a.fingerprint, d.fingerprint);
});

test('snapshot rejects oversized lists, duplicate usernames, bogus source and untrusted fields', () => {
  const make = (names: unknown, location: unknown = 'completed_run') =>
    makeAudienceSnapshot('ref-id', 'mameto_lueji', '6396548176148717', names, location);
  assert.equal(make(Array.from({ length: 11 }, (_, i) => 'person' + i)), null);
  assert.equal(make(['person', 'person']), null);
  assert.equal(make(['person@example.com']), null);
  assert.equal(make(['mameto_lueji']), null);
  assert.equal(make(['person'], 'third_party_site'), null);
  assert.equal(makeAudienceSnapshot('ref-id', 'mameto_lueji', '../../escape', ['person'], 'completed_run'), null);
  assert.equal(makeAudienceSnapshot('ref-id', 'invalid@email', '6396548176148717', ['person'], 'completed_run'), null);
  assert.equal(parseAudienceSnapshot(JSON.stringify({ username: 'person', token: 'PRIVATE' })), null);
  const a = make(['person']);
  assert.ok(a);
  assert.equal(parseAudienceSnapshot(JSON.stringify({ ...a, fingerprint: 'tampered' })), null);
  assert.equal(parseAudienceSnapshot(JSON.stringify({ ...a, verifiedByMeta: true })), null);
});

test('history route gates accounts by owner and reference, requires consent, isolates action and accepts delete', () => {
  const route = readFileSync('app/api/provider/phantombuster/audience-history/route.ts', 'utf8');
  assert.match(route, /const session = await auth\(\)/);
  assert.match(route, /where: \{ id: accountId, userId \}/);
  assert.match(route, /where: \{ id: referenceId, instagramAccountId: account.id \}/);
  assert.match(route, /PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(route, /input.confirmSave !== true/);
  assert.match(route, /p.confirmDelete !== true/);
  assert.match(route, /sameOrigin\(req\)/);
  assert.match(route, /Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(route, /AUDIENCE_HISTORY_ACTION/);
  assert.match(route, /export async function DELETE/);
  assert.doesNotMatch(route, /agents\/launch|user_follow|user_unfollow|prisma\.followAction\.(create|update|delete)/);
});

test('previews are still read-only and new history is an explicit user action', () => {
  const readonly = readFileSync('app/api/provider/phantombuster/audience-preview/route.ts', 'utf8');
  const ui = readFileSync('app/(app)/references/_components/reference-audience-panel.tsx', 'utf8');
  assert.doesNotMatch(readonly, /activityLog\.(create|update|delete)|audience-history|confirmSave/);
  assert.match(ui, /Ler resultados anteriores \(sem executar coletor\)/);
  assert.match(ui, /Registrar consulta no histórico/);
  assert.match(ui, /confirmSave: true/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|agents\/launch|user_follow|user_unfollow/);
});

test('history metrics count distinct, repeated and newly seen usernames chronologically', async () => {
  const { summarizeAudienceHistory } = await import('../lib/reference-audience-metrics');
  const history = [
    { id: 'latest', savedAt: '2026-11-19T16:00:00.000Z', usernames: ['b', 'c', 'c'] },
    { id: 'first', savedAt: '2026-11-19T10:00:00.000Z', usernames: ['a', 'b'] },
    { id: 'middle', savedAt: '2026-11-19T12:00:00.000Z', usernames: ['a', 'd'] },
  ];
  const m = summarizeAudienceHistory(history);
  assert.equal(m.consultations, 3);
  assert.equal(m.distinctNames, 4);
  assert.equal(m.repeatedNames, 2);
  assert.equal(m.appearances, 6);
  assert.deepEqual(m.byBatchId.first, { newNames: 2, repeatedNames: 0 });
  assert.deepEqual(m.byBatchId.middle, { newNames: 1, repeatedNames: 1 });
  assert.deepEqual(m.byBatchId.latest, { newNames: 1, repeatedNames: 1 });
  assert.deepEqual(history.map(x => x.id), ['latest', 'first', 'middle'], 'does not mutate history order');
});

test('history metrics are empty-safe and never transmit or save data', async () => {
  const { summarizeAudienceHistory } = await import('../lib/reference-audience-metrics');
  const m = summarizeAudienceHistory([]);
  assert.equal(m.consultations, 0);
  assert.equal(m.distinctNames, 0);
  assert.equal(m.repeatedNames, 0);
  const ui = readFileSync('app/(app)/references/_components/reference-audience-panel.tsx', 'utf8');
  const helper = readFileSync('lib/reference-audience-metrics.ts', 'utf8');
  assert.match(ui, /summarizeAudienceHistory\(history\)/);
  assert.match(ui, /historyMetrics\.repeatedNames/);
  assert.doesNotMatch(helper, /fetch\(|prisma\.|agents\/launch|user_follow|user_unfollow|localStorage/);
});
