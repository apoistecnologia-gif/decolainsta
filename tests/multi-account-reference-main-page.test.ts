import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('main references page never selects one pilot account or asks for collector IDs', () => {
  const page = readFileSync('app/(app)/references/page.tsx','utf8');
  const ui = readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(page,/SimpleReferencesPanel/);
  assert.match(ui,/const preferred = valid\.find\(a => a\.connected\) \?\? valid\[0\]/);
  assert.doesNotMatch(ui,/valid\.find\(a => a\.username.*contateste6699/);
  assert.match(ui,/Adicionar referência/);
  assert.match(ui,/Atualizar dados/);
  assert.doesNotMatch(ui,/collectorAgentId|agentId|sessionid/);
});

test('main refresh discovers approved collectors and reads their finalized results by account', () => {
  const ui = readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/\/api\/provider\/phantombuster\/match-collectors/);
  assert.match(ui,/operation: 'match-existing'/);
  assert.match(ui,/\/api\/provider\/phantombuster\/refresh-now/);
  assert.match(ui,/operation: 'refresh-readonly'/);
  assert.match(ui,/\/api\/provider\/phantombuster\/connection-status\?accountId=/);
  assert.match(ui,/API conectada/);
  assert.match(ui,/referência\(s\) aguardando coletor/);
  assert.match(ui,/\/api\/reference-candidate-queue/);
  assert.match(ui,/operation: 'sync-saved-history'/);
  assert.doesNotMatch(ui,/agents\/launch|user_follow|user_unfollow|followAction\.(create|update)/);
});

test('candidate index and saved plan work for any owned account only on preview', () => {
  const candidate = readFileSync('app/api/reference-candidate-queue/route.ts','utf8');
  const plan = readFileSync('app/api/reference-auto-plan/route.ts','utf8');
  for (const route of [candidate, plan]) {
    assert.match(route,/where: \{ id: accountId, userId \}/);
    assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
    assert.match(route,/PHANTOMBUSTER_READONLY_ENABLED !== 'yes'/);
    assert.doesNotMatch(route,/PHANTOMBUSTER_PILOT_USERNAME/);
  }
  assert.match(candidate,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(candidate,/instagramActionsExecuted: 0/);
});
