import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('laboratório local: validações de estado e segurança passam no Node sem abrir Instagram', () => {
  const child = spawnSync(process.execPath,
    ['--test', 'labs/instagram-local/test/guard.test.mjs'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, [child.stdout, child.stderr].join('\n'));
  assert.match(child.stdout, /# pass 6/);
  assert.match(child.stdout, /# fail 0/);
});
