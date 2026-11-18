import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('laboratório local: segurança e filas de nichos passam no Node sem abrir Instagram', () => {
  const child = spawnSync(process.execPath,
    ['--test', 'labs/instagram-local/test/guard.test.mjs', 'labs/instagram-local/test/candidates.test.mjs', 'labs/instagram-local/test/references.test.mjs'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, [child.stdout, child.stderr].join('\n'));
  // Some test runners route nested TAP output away from stdout. Exit 0 is the portable success condition.
});
