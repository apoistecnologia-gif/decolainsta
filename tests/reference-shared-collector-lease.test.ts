import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SHARED_COLLECTOR_LEASE_ACTION,
  makeSharedCollectorLease, parseSharedCollectorLease,
  reserveSharedCollectorForFutureRead, reservedSharedCollectorAgents,
  MAX_SHARED_COLLECTOR_LEASE_LOGS,
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

test('a global reservation fences its agent even when a different customer attempts binding', () => {
  const rows = [{
    instagramAccountId:'account_a', targetUsername:'1111111111111111',
    details:JSON.stringify(event),
  }];
  const scan = reservedSharedCollectorAgents(rows);
  assert.equal(scan.valid, true);
  assert.deepEqual([...scan.agents],['1111111111111111']);
  assert.equal(MAX_SHARED_COLLECTOR_LEASE_LOGS, 5000);
  // Never scope this registry by tenant: account B must see account A's claim.
  assert.equal(scan.agents.has('1111111111111111'),true);
  assert.deepEqual(reservedSharedCollectorAgents([]),{
    agents:new Set<string>(),valid:true,
  });
});

test('malformed and cross-tenant reservation records fail closed', () => {
  const record = {
    instagramAccountId:'account_a',
    targetUsername:'1111111111111111',
    details:JSON.stringify(event),
  };
  for (const bad of [
    {...record,instagramAccountId:'account_b'},
    {...record,targetUsername:'2222222222222222'},
    {...record,details:'{bad-json'},
    {...record,details:JSON.stringify({...event,referenceId:'../other'})},
    {...record,details:null},
  ]) {
    const scan = reservedSharedCollectorAgents([record,bad]);
    assert.equal(scan.valid,false);
    assert.equal(scan.agents.size,0);
  }
});

test('all existing binding writers check global shared claims before committing', () => {
  const routes = [
    'app/api/provider/phantombuster/match-all-customers/route.ts',
    'app/api/provider/phantombuster/match-collectors/route.ts',
    'app/api/provider/phantombuster/reconcile-prepared/route.ts',
    'app/api/provider/phantombuster/collector-bindings/route.ts',
  ];
  for (const path of routes) {
    const code = readFileSync(path,'utf8');
    assert.match(code,/SHARED_COLLECTOR_LEASE_ACTION/,path);
    assert.match(code,/where: \{ action: SHARED_COLLECTOR_LEASE_ACTION \}/,path);
    assert.match(code,/MAX_SHARED_COLLECTOR_LEASE_LOGS/,path);
    assert.match(code,/reservedSharedCollectorAgents\(leases\)/,path);
    assert.match(code,/if \(!shared\.valid\)/,path);
    assert.match(code,/Prisma\.TransactionIsolationLevel\.Serializable/,path);
    assert.doesNotMatch(code,/agents\/launch|user_follow|user_unfollow/,path);
  }
});
