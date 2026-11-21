import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SHARED_COLLECTOR_LEASE_ACTION,
  makeSharedCollectorLease, parseSharedCollectorLease,
  reserveSharedCollectorForFutureRead,
} from '../lib/reference-shared-collector-lease';

const claimId = '97c745bd-f8dd-476b-99f8-e3ce64183c56';
const event = makeSharedCollectorLease({
  claimId, accountId:'account_a', referenceId:'reference_a',
  collectorAgentId:'1111111111111111',
});

test('exclusive shared-agent lease requires explicit immutable tenant and agent provenance', () => {
  assert.equal(SHARED_COLLECTOR_LEASE_ACTION,'reference_shared_collector_lease_v1');
  assert.ok(event);
  assert.equal(event?.state, 'reserved');
  assert.equal(event?.launchesProvider, false);
  assert.deepEqual(parseSharedCollectorLease(JSON.stringify(event)), event);
  assert.equal(parseSharedCollectorLease(null),null);
  assert.equal(parseSharedCollectorLease('not json'),null);
  assert.equal(parseSharedCollectorLease(JSON.stringify({...event,apiKey:'secret'})),null);
  assert.equal(parseSharedCollectorLease(JSON.stringify({...event,accountId:'../tenant'})),null);
  assert.equal(parseSharedCollectorLease(JSON.stringify({...event,claimId:'different'})),null);
  assert.equal(parseSharedCollectorLease(JSON.stringify({...event,state:'released'})),null);
  assert.equal(makeSharedCollectorLease({
    claimId, accountId:'account_a', referenceId:'reference_a',
    collectorAgentId:'not-a-provider-id',
  }),null);
});

test('disabled lease cannot touch database or external provider', async () => {
  const previous = process.env.PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED;
  try {
    process.env.PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED = 'no';
    assert.deepEqual(await reserveSharedCollectorForFutureRead({
      operatorUserId: 'admin', accountId: 'account_a',
      referenceId: 'reference_a', collectorAgentId: '1111111111111111',
    }), {status:'disabled'});
  } finally {
    if (previous === undefined) delete process.env.PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED;
    else process.env.PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED = previous;
  }
});

test('global per-agent transaction gate precedes persistent claim and checks other client bindings',()=>{
  const source=readFileSync('lib/reference-shared-collector-lease.ts','utf8');
  assert.match(source,/VERCEL_ENV !== 'preview'/);
  assert.match(source,/PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED !== 'yes'/);
  assert.match(source,/PHANTOMBUSTER_SHARED_COLLECTOR_AGENT_ID !== input\.collectorAgentId/);
  assert.match(source,/admin\?\.role !== 'admin'/);
  assert.match(source,/pg_advisory_xact_lock/);
  assert.match(source,/hashtext\(\$\{input\.collectorAgentId\}\)/);
  assert.match(source,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(source,/instagramAccount: \{ userId: input\.operatorUserId \}/);
  assert.match(source,/SHARED_COLLECTOR_LEASE_ACTION/);
  assert.match(source,/resolveLatestAudienceBindings\(bindings\)/);
  assert.match(source,/reservedCollectorDraftAgents\(drafts\)/);
  assert.match(source,/await tx\.activityLog\.create/);
  assert.match(source,/'already-reserved'/);
  assert.match(source,/status: 'review-required'/);
  assert.doesNotMatch(source,/agents\/launch|agents\/save|user_follow|user_unfollow|instagram\.com\/api/);
});
