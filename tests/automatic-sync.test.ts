import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTOMATIC_SYNC_INTERVAL_MS, AUTOMATIC_SYNC_BATCH_LIMIT, isDueForAutomaticSync, prepareAutomaticSnapshot } from '../lib/instagram/automatic-sync';

test('sincronização diária respeita intervalo, datas futuras e ausência de leitura anterior', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');
  assert.equal(isDueForAutomaticSync(null, now), true);
  assert.equal(isDueForAutomaticSync(new Date(now.getTime() - AUTOMATIC_SYNC_INTERVAL_MS), now), true);
  assert.equal(isDueForAutomaticSync(new Date(now.getTime() - AUTOMATIC_SYNC_INTERVAL_MS + 1), now), false);
  assert.equal(isDueForAutomaticSync(new Date(now.getTime() + 5_000), now), false);
  assert.equal(isDueForAutomaticSync(new Date('invalid'), now), false);
});

test('sincronização utiliza somente métricas realmente fornecidas pela Meta', () => {
  const observed = new Date('2026-11-18T12:00:00Z');
  const snapshot = prepareAutomaticSnapshot({ id: '1', username: 'conta', followers_count: 103, media_count: 7 }, 100, observed);
  assert.deepEqual(snapshot.update, { lastSyncedAt: observed, profileFollowersCount: 103, profileMediaCount: 7 });
  assert.deepEqual(snapshot.measurement, { current: 103, previous: 100, delta: 3, source: 'meta_official_api' });

  const unavailable = prepareAutomaticSnapshot({ id: '1', username: 'conta', followers_count: undefined, media_count: -1 }, 100, observed);
  assert.deepEqual(unavailable.update, { lastSyncedAt: observed });
  assert.equal(unavailable.measurement, null);
});

test('cron autenticado, limitado e sem escrita de follows ou coleta de seguidores', () => {
  const source = readFileSync('app/api/cron/sync-insights/route.ts', 'utf8');
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(AUTOMATIC_SYNC_BATCH_LIMIT, 5);
  assert.ok(config.crons.some((job: { path: string; schedule: string }) =>
    job.path === '/api/cron/sync-insights' && job.schedule === '0 12 * * *'));
  assert.equal(config.crons.length, 3);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /secret\.length < 32/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /DECOLAINSTA_AUTO_SYNC_ENABLED !== 'true'/);
  assert.match(source, /lastSyncedAt: account\.lastSyncedAt/);
  assert.match(source, /\$transaction/);
  assert.match(source, /realFollows: 0/);
  assert.doesNotMatch(source, /processFollowsForAccount|processUnfollowsForAccount|simulateCollectFollowers/);
});
