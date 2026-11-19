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
