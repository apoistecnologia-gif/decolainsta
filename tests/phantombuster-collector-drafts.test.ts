import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createUnconfiguredCollectorDraft, findExistingCollectorDraft,
  prepareCollectorDraft,
} from '../lib/providers/phantombuster-collector-drafts';
import {
  COLLECTOR_DRAFT_ACTION, collectorDraftAlreadyAttempted,
  makeCollectorDraftEvent, parseCollectorDraftEvent,
} from '../lib/reference-collector-draft-events';

const ID = '1234567890123456';
const accountId = 'customer_one';
const ref = 'reference_a';
const draft = prepareCollectorDraft(accountId, ref, 'example_ref');
if (!draft) throw Error('draft fixture invalid');

test('draft is deterministic per account+reference and never schedules or authorizes Instagram', () => {
  assert.deepEqual(prepareCollectorDraft(accountId,ref,'example_ref'),draft);
  assert.equal(prepareCollectorDraft('customer_two',ref,'example_ref')?.idempotencyKey ===
    draft.idempotencyKey, false);
  assert.equal(prepareCollectorDraft(accountId,'reference_b','example_ref')?.name ===
    draft.name, false);
  assert.deepEqual(Object.keys(draft).sort(),
    ['branch','idempotencyKey','launchType','name','script']);
  assert.equal(Object.prototype.hasOwnProperty.call(draft,'org'),false);
  assert.equal(draft.script,'Instagram Follower Collector.js');
  assert.equal(draft.branch,'master');
  assert.equal(draft.launchType,'manually');
  assert.equal(JSON.stringify(draft).includes('example_ref'),false);
  assert.equal(JSON.stringify(draft).includes('sessionCookie'),false);
  assert.equal(prepareCollectorDraft('../bad', ref,'example_ref'),null);
  assert.equal(prepareCollectorDraft(accountId,ref,'@bad-ref'),null);
});

test('create adapter uses official endpoint, idempotency and NO argument or automatic execution',async () => {
  let calls = 0;
  const result = await createUnconfiguredCollectorDraft('server-api-key',draft,
    async (url,init) => {
      calls++;
      assert.equal(url,'https://api.phantombuster.com/api/v2/agents/save');
      assert.equal(init?.method,'POST');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.credentials,'omit');
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],
        'server-api-key');
      const payload = JSON.parse(String(init?.body)) as Record<string,unknown>;
      assert.deepEqual(payload,draft);
      assert.equal(Object.prototype.hasOwnProperty.call(payload,'argument'),false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload,'id'),false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload,'launchOnceAt'),false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload,'repeatedLaunchTimes'),false);
      assert.equal(Object.prototype.hasOwnProperty.call(payload,'wasSetupValidWhenSubmittedByTheFrontend'),false);
      assert.equal(payload.idempotencyKey,draft.idempotencyKey);
      return new Response(JSON.stringify({id:ID,argument:'SECRET_COOKIE'}),{status:200});
    });
  assert.equal(calls,1);
  assert.deepEqual(result,{status:'created',agentId:ID});
  assert.doesNotMatch(JSON.stringify(result),/SECRET_COOKIE|server-api-key/);
});

test('remote failures disclose no provider body and never retry ambiguous requests',async () => {
  for(const [code,status] of [
    [401,'invalid-key'],[402,'capacity-reached'],[429,'rate-limited'],
    [400,'rejected'],[412,'rejected'],[503,'unavailable'],
  ] as const){
    let calls = 0;
    const output = await createUnconfiguredCollectorDraft('secret-key',draft,async () => {
      calls++; return new Response('SECRET PROVIDER ERROR',{status:code});
    });
    assert.equal(calls,1);
    assert.equal(output.status,status);
    assert.doesNotMatch(JSON.stringify(output),/SECRET|PROVIDER/);
  }
  assert.deepEqual(await createUnconfiguredCollectorDraft('key',draft,async () =>
    new Response(JSON.stringify({created:true,argument:'SECRET'}),{status:200})),
    {status:'unconfirmed-id'});
  assert.deepEqual(await createUnconfiguredCollectorDraft('key',draft,async () => {
    throw Error('private network details');
  }),{status:'unavailable'});
});

test('existing draft lookup prevents re-creating a previously provisioned agent',async () => {
  let calls=0;
  const check = await findExistingCollectorDraft('secret-key',draft,async (url,init) => {
    calls++;
    assert.equal(new URL(url).searchParams.get('withArgument'),'false');
    assert.equal(init?.method,'GET');
    return new Response(JSON.stringify([
      {id:ID,name:draft.name,script:draft.script,launchType:'manually'},
      {id:'2222222222222222',name:'unrelated',script:'Other.js'},
    ]));
  });
  assert.equal(calls,1);
  assert.deepEqual(check,{status:'found',agentId:ID});
  assert.equal((await findExistingCollectorDraft('key',draft,async () =>
    new Response(JSON.stringify([])))).status,'not-found');
  assert.equal((await findExistingCollectorDraft('key',draft,async () =>
    new Response(JSON.stringify([{id:ID,name:draft.name,script:'Wrong.js'}]))))
    .status,'ambiguous');
  assert.equal((await findExistingCollectorDraft('key',draft,async () =>
    new Response('SECRET',{status:429}))).status,'unavailable');
});

test('claim events are durable and fail closed on malformed or uncertain remote responses', () => {
  assert.equal(COLLECTOR_DRAFT_ACTION,'reference_collector_draft_v1');
  const claim = makeCollectorDraftEvent(ref,'claimed');
  assert.ok(claim);
  assert.equal(claim?.autoLaunchEnabled,false);
  assert.equal(claim?.setupComplete,false);
  assert.deepEqual(parseCollectorDraftEvent(JSON.stringify(claim)),claim);
  assert.equal(makeCollectorDraftEvent(ref,'created',null),null);
  assert.equal(makeCollectorDraftEvent(ref,'created',ID)?.agentId,ID);
  assert.equal(parseCollectorDraftEvent(JSON.stringify({...claim,
    autoLaunchEnabled:true})),null);
  assert.equal(collectorDraftAlreadyAttempted([
    {targetUsername:ref,details:'invalid JSON'},
  ],ref),true);
  assert.equal(collectorDraftAlreadyAttempted([],ref),false);
});

test('route is admin+Preview only and external writes require separate OFF-by-default gate',() => {
  const route = readFileSync(
    'app/api/provider/phantombuster/collector-drafts/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route,/const session = await auth\(\)/);
  assert.match(route,/user\?\.role !== 'admin'/);
  assert.match(route,/request\.headers\.get\('origin'\)/);
  assert.match(route,/process\.env\.PHANTOMBUSTER_DRAFT_CREATION_ENABLED !== 'yes'/);
  assert.match(route,/confirmCreateUnconfiguredDraft !== true/);
  assert.match(route,/operation !== 'create-next-draft'/);
  assert.match(route,/const ref = eligible\[0\]/);
  assert.doesNotMatch(route,/body\.referenceId/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/collectorDraftAlreadyAttempted/);
  assert.match(route,/findExistingCollectorDraft/);
  assert.match(route,/createUnconfiguredCollectorDraft/);
  assert.match(route,/automaticallyScheduled: false/);
  assert.doesNotMatch(route,/agents\/launch|user_follow|user_unfollow|api\.instagram\.com/);
});
