import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guardedRoutes = [
  'app/api/alerts/route.ts',
  'app/api/dashboard/route.ts',
  'app/api/instagram-accounts/[id]/targets/route.ts',
  'app/api/instagram-accounts/[id]/whitelist/route.ts',
  'app/api/instagram-accounts/[id]/logs/route.ts',
];

test('all multi-tenant list routes reject sessions with missing user ID', () => {
  for (const file of guardedRoutes) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /\(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/, file);
    assert.doesNotMatch(source, /if \(!session\?\.user\)/, file);
  }
});

test('alert write operation scopes updateMany by current user', () => {
  const source = readFileSync('app/api/alerts/route.ts', 'utf8');
  const patch = source.split('export async function PATCH')[1];
  assert.ok(patch, 'PATCH must exist');
  assert.match(patch, /const userId =/);
  assert.match(patch, /updateMany\(\{\s*where: \{ id: alertId, instagramAccount: \{ userId \} \}/);
});
