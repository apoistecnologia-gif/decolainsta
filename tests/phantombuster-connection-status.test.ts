import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('connection diagnostic is strictly scoped to the signed-in owner in Preview', () => {
  const route = readFileSync(
    'app/api/provider/phantombuster/connection-status/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route,/const session = await auth\(\)/);
  assert.match(route,/where: \{ id: accountId, userId \}/);
  assert.match(route,/loadActiveAudienceSources\(account\.id\)/);
  assert.match(route,/instagramAccountId: account\.id/);
  assert.match(route,/checkPhantomBusterWorkspace\(process\.env\.PHANTOMBUSTER_API_KEY!\)/);
  assert.match(route,/keyStoredOnServer/);
  assert.match(route,/collectionVerifiedByMeta: false/);
  assert.match(route,/anyCollectorLaunched: false/);
  assert.match(route,/instagramActionsExecuted: 0/);
  assert.match(route,/Cache-Control.*no-store/);
  assert.doesNotMatch(route,/\.create\(|\.upsert\(|\.update\(|agents\/launch|user_follow|user_unfollow/);
  assert.doesNotMatch(route,/return.*apiKey|return.*argument|apiKey: process\.env/);
});

test('the existing update button shows real connectivity without exposing credentials', () => {
  const ui = readFileSync(
    'app/(app)/references/_components/automatic-audience-plan-panel.tsx','utf8');
  assert.match(ui,/\/api\/provider\/phantombuster\/connection-status\?accountId=/);
  assert.match(ui,/API conectada/);
  assert.match(ui,/referência\(s\) aguardando coletor/);
  assert.match(ui,/A chave API cadastrada não foi autorizada/);
  assert.match(ui,/Atualizar dados/);
  assert.doesNotMatch(ui,/sessionid|apiKey\s*=|localStorage|sessionStorage/);
});
