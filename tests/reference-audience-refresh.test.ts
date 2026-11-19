import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AUDIENCE_REFRESH_ACTION, MAX_REFRESH_SOURCES, MAX_REFRESHES_PER_TICK,
  MIN_REFRESH_INTERVAL_MS, newAudienceNames, parseAudienceRefreshSources, refreshIsDue,
} from '../lib/reference-audience-refresh';

const valid = [
  { accountId: 'account_1', referenceId: 'ref_1', collectorAgentId: '6396548176148717' },
  { accountId: 'account_1', referenceId: 'ref_2', collectorAgentId: '1234567890123456' },
];

test('configuração explícita por conta e referência impede atribuição cruzada e IDs maliciosos', () => {
  assert.equal(AUDIENCE_REFRESH_ACTION, 'reference_audience_refresh_v1');
  assert.equal(MAX_REFRESH_SOURCES, 20);
  assert.equal(MAX_REFRESHES_PER_TICK, 3);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify(valid)), valid);
  assert.deepEqual(parseAudienceRefreshSources(undefined), []);
  assert.deepEqual(parseAudienceRefreshSources('invalid JSON'), []);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify([...valid, valid[0]])), []);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify([
    valid[0], { ...valid[1], collectorAgentId: valid[0].collectorAgentId },
  ])), []);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify([{ ...valid[0], apiKey: 'secret' }])), []);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify([{ ...valid[0], referenceId: '../cross-tenant' }])), []);
  assert.deepEqual(parseAudienceRefreshSources(JSON.stringify(Array.from({length: 21}, (_,i) => ({
    accountId: 'a', referenceId: 'r' + i, collectorAgentId: '123456789012' + String(i).padStart(2,'0'),
  })))), []);
});

test('janela de atualização evita reprocessamento e não aceita relógio futuro', () => {
  const now = new Date('2026-11-19T17:00:00Z');
  assert.equal(refreshIsDue(null, now), true);
  assert.equal(refreshIsDue(new Date(now.getTime() - MIN_REFRESH_INTERVAL_MS), now), true);
  assert.equal(refreshIsDue(new Date(now.getTime() - MIN_REFRESH_INTERVAL_MS + 1), now), false);
  assert.equal(refreshIsDue(new Date(now.getTime() + 1), now), false);
  assert.equal(refreshIsDue(new Date('invalid'), now), false);
});

test('ingestão incremental armazena apenas novos usernames em ordem estável', () => {
  const fresh = newAudienceNames(
    ['already', 'Zed', 'second', 'second', 'refowner', 'bad username', 'owner'],
    ['already'], ['owner','refowner'],
  );
  assert.deepEqual(fresh, ['second','zed']);
  assert.deepEqual(newAudienceNames(['known','KNOWN'],['known'],[]), []);
});

test('agendamento só lê execução finalizada e mantém ações sociais desligadas', () => {
  const route = readFileSync('app/api/cron/refresh-reference-audiences/route.ts', 'utf8');
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.ok(config.crons.some((job: {path: string; schedule: string}) =>
    job.path === '/api/cron/refresh-reference-audiences' && job.schedule === '0 10 * * *'));
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /secret\.length < 32/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /PHANTOMBUSTER_AUDIENCE_POLL_ENABLED !== 'yes'/);
  assert.match(route, /parseAudienceRefreshSources/);
  assert.match(route, /where: \{ id: source.referenceId, instagramAccountId: account.id, enabled: true \}/);
  assert.match(route, /result\.resultLocation !== 'completed_run'/);
  assert.match(route, /Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(route, /MAX_HISTORY_BATCHES/);
  assert.match(route, /planCandidateIndex/);
  assert.match(route, /newAudienceNames/);
  assert.match(route, /instagramActionsExecuted: 0/);
  assert.doesNotMatch(route, /agents\/launch|user_follow|user_unfollow|followAction\.(create|update|delete)|api\.instagram\.com|sessionid/);
});
