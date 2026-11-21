import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('reference status reports persisted dynamic receipts for only the owned account',()=>{
  const api=readFileSync('app/api/reference-collection-status/route.ts','utf8');
  assert.match(api,/where: \{ id: accountId, userId \}/);
  assert.match(api,/instagramAccountId: account\.id, action: DYNAMIC_COLLECTION_ACTION/);
  assert.match(api,/parseDynamicJobEvent\(row\.details\)/);
  assert.match(api,/event\.accountId !== account\.id/);
  assert.match(api,/event\.agentId !== row\.targetUsername/);
  assert.match(api,/lastDynamicByRef\.has\(event\.referenceId\)/);
  assert.match(api,/event\?\.state === 'finished' \? 'collection-completed'/);
  assert.match(api,/event\?\.state === 'launched' \? 'collection-started'/);
  assert.match(api,/ref\.state !== 'collection-completed'/);
  assert.match(api,/launchesCollectors: false/);
  assert.match(api,/actionsEnabled: false/);
});

test('main page differentiates completed, started and unverified collection',()=>{
  const ui=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/collection-completed/);
  assert.match(ui,/collection-started/);
  assert.match(ui,/Coleta concluída/);
  assert.match(ui,/aguardando confirmação/);
  assert.match(ui,/Coleta ou configuração exige revisão/);
  assert.match(ui,/sem coleta confirmada/);
  assert.doesNotMatch(ui,/agents\/launch|user_follow|user_unfollow/);
});
