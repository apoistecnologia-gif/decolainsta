import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManualReviewQueue } from '../review-plan.mjs';

const now = '2026-11-18T12:00:00.000Z';
const follow = (username, timestamp, realActions = 1, status = 'following_confirmed') => ({
  action: 'follow', username, timestamp, realActions, status,
});
const unfollow = (username, timestamp) => ({
  action: 'unfollow', username, timestamp, realActions: 1, status: 'unfollow_confirmed',
});

test('revisão 24 e 72 horas usa somente follows reais e não agenda ações', () => {
  const events = [
    follow('perfil_teste', '2026-11-17T10:00:00.000Z'),
    follow('INCONCLUSIVO', '2026-11-17T10:00:00.000Z', 'unknown', 'unverified'),
    follow('simulado', '2026-11-17T10:00:00.000Z', 0),
  ];
  const daily = buildManualReviewQueue(events, 24, now);
  assert.equal(daily.length, 1);
  assert.deepEqual(daily[0], {
    username: 'perfil_teste',
    followObservedAt: '2026-11-17T10:00:00.000Z',
    reviewDueAt: '2026-11-18T10:00:00.000Z',
    status: 'review_due',
    followbackVerified: false,
    requiresManualDecision: true,
  });
  assert.equal(buildManualReviewQueue(events, 72, now)[0].status, 'review_pending');
});

test('unfollow já confirmado remove pendência; refollow cria revisão nova', () => {
  const events = [
    follow('perfil_a', '2026-11-17T09:00:00.000Z'),
    follow('perfil_b', '2026-11-17T09:00:00.000Z'),
    unfollow('perfil_a', '2026-11-17T11:00:00.000Z'),
    follow('PERFIL_A', '2026-11-18T10:00:00.000Z'),
    unfollow('perfil_b', '2026-11-17T10:00:00.000Z'),
  ];
  const queue = buildManualReviewQueue(events, 24, now);
  assert.deepEqual(queue.map(item => item.username), ['perfil_a']);
  assert.equal(queue[0].reviewDueAt, '2026-11-19T10:00:00.000Z');
});

test('eventos malformados, futuras confirmações e datas incorretas são ignorados', () => {
  assert.deepEqual(buildManualReviewQueue([
    {}, null, { username: 'teste', action: 'follow', status: 'following_confirmed',
      realActions: 1, timestamp: '2027-01-01T00:00:00.000Z' },
    follow('ruim!', '2026-11-17T09:00:00.000Z'),
    follow('perfil_b', 'invalid'),
  ], 24, now), []);
  assert.throws(() => buildManualReviewQueue([], 5, now));
  assert.throws(() => buildManualReviewQueue('invalid', 24, now));
});

test('CLI de revisão aceita 24/72h sem integrar Chrome ou ações', () => {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(base, '..', 'review-cli.mjs');
  const invalid = spawnSync(process.execPath, [cli, '8'], {encoding:'utf8',timeout:5000});
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /24/);
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /buildManualReviewQueue/);
  assert.doesNotMatch(source, /playwright|chromium|\.click\(|setTimeout|setInterval|unfollow --/);
});
