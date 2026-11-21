import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the main account panel prioritizes official metrics and refresh without activating demo actions', () => {
  const source = readFileSync('app/(app)/accounts/_components/accounts-list.tsx', 'utf8');
  assert.match(source, /if \(!account\.connected \|\| syncingId\) return;/);
  assert.match(source, /api\/instagram-accounts\/\$\{encodeURIComponent\(account\.id\)\}\/instagram/);
  assert.match(source, /result\.source !== 'meta_official_api'/);
  assert.match(source, /result\.profile\?\.id !== account\.instagramUserId/);
  assert.match(source, /account\.profileFollowersCount/);
  assert.match(source, /account\.profileMediaCount/);
  assert.match(source, /Última sincronização/);
  assert.match(source, /Atualizar dados/);
  assert.match(source, /!account\.connected && <Badge/);
  assert.match(source, /Recursos opcionais: IA e simulação/);
  // Existing functions remain present, and no real follow or unfollow action is added.
  assert.match(source, /onClick=\{createDemo\}/);
  assert.match(source, /toggleStatus\(account\.id, account\.status\)/);
  assert.doesNotMatch(source, /phantombuster|follow\/unfollow/i);
});

test('official synchronization returns its persisted timestamp and requires user-scoped account access', () => {
  const source = readFileSync('app/api/instagram-accounts/[id]/instagram/route.ts', 'utf8');
  assert.match(source, /const connected = await connectedAccount\(id, userId\)/);
  assert.match(source, /source: 'meta_official_api'/);
  assert.match(source, /syncedAt: syncedAt\.toISOString\(\)/);
  assert.match(source, /profileFollowersCount/);
});
