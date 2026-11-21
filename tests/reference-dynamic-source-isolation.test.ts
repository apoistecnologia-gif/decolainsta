import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legacy agent-wide ingestion never reads a collector reused per dynamic reference',()=>{
  const runner=readFileSync('lib/server/reference-audience-refresh-runner.ts','utf8');
  const manual=readFileSync('app/api/provider/phantombuster/audience-bulk-import/route.ts','utf8');
  assert.match(runner,/DYNAMIC_COLLECTION_ACTION/);
  assert.match(runner,/const dynamicUse = await prisma\.activityLog\.findFirst/);
  assert.match(runner,/targetUsername: source\.collectorAgentId/);
  assert.match(runner,/if \(dynamicUse\) return \{ status: 'skipped'/);
  assert.match(manual,/DYNAMIC_COLLECTION_ACTION/);
  assert.match(manual,/const dynamicallyAssigned = await prisma\.activityLog\.findFirst/);
  assert.match(manual,/targetUsername: input\.collectorAgentId/);
  assert.match(manual,/if \(dynamicallyAssigned\)/);
  assert.match(manual,/status: 409/);
  assert.doesNotMatch(runner+manual,/agents\/launch/);
});
