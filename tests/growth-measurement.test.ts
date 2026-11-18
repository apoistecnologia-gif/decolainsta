import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measureFollowers } from '../lib/instagram/growth-measurement';

test('a primeira observação real não inventa uma variação', () => {
  assert.deepEqual(measureFollowers(100, null), {
    current: 100, previous: null, delta: null, source: 'meta_official_api',
  });
});

test('a variação de seguidores preserva aumentos, quedas e zero', () => {
  assert.equal(measureFollowers(110, 100)?.delta, 10);
  assert.equal(measureFollowers(90, 100)?.delta, -10);
  assert.equal(measureFollowers(0, 0)?.delta, 0);
});

test('contagem ausente ou inválida nunca é convertida em seguidores', () => {
  for (const current of [null, undefined, '150', -1, 1.2, NaN, Infinity]) {
    assert.equal(measureFollowers(current, 100), null);
  }
  assert.equal(measureFollowers(105, '100')?.delta, null);
  assert.equal(measureFollowers(105, -1)?.delta, null);
});

test('API registra somente observações oficiais e motor declara 0 ações reais', () => {
  const source = readFileSync('app/api/instagram-accounts/[id]/instagram/route.ts', 'utf8');
  assert.match(source, /measureFollowers\(/);
  assert.match(source, /followers_snapshot/);
  assert.match(source, /\$transaction/);
  assert.match(source, /source: 'meta_official_api'/);

  const tick = readFileSync('app/api/engine/tick/route.ts', 'utf8');
  assert.match(tick, /mode: 'simulation', realFollows: 0, realUnfollows: 0/);
  const engine = readFileSync('lib/worker/engine.ts', 'utf8');
  assert.doesNotMatch(engine, /type: 'rate_limit'/);
  assert.match(engine, /Falha aleatória da demonstração/);
});
