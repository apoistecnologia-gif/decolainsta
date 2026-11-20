import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { planGlobalReadOnlyBindings } from '../lib/reference-audience-global-matching';
import {
  makeCollectorDraftEvent, reservedCollectorDraftAgents,
} from '../lib/reference-collector-draft-events';

const collectors = [
  {collectorAgentId:'1111111111111111',referenceUsername:'ref_a'},
  {collectorAgentId:'2222222222222222',referenceUsername:'ref_b'},
  {collectorAgentId:'3333333333333333',referenceUsername:'shared_ref'},
];

test('can associate different existing collectors for different customers without manual profile choice', () => {
  const refs = [
    {accountId:'customer_1',id:'a',username:'ref_a'},
    {accountId:'customer_2',id:'b',username:'ref_b'},
  ];
  const result = planGlobalReadOnlyBindings(refs,collectors,[],new Set());
  assert.equal(result.referencesExamined,2);
  assert.equal(result.candidates.length,2);
  assert.deepEqual(result.candidates,[
    {accountId:'customer_1',referenceId:'a',collectorAgentId:'1111111111111111'},
    {accountId:'customer_2',referenceId:'b',collectorAgentId:'2222222222222222'},
  ]);
  const repeated = planGlobalReadOnlyBindings(refs,collectors,result.candidates,new Set());
  assert.equal(repeated.candidates.length,0);
  assert.equal(repeated.alreadyBound,2);
});

test('two customers with same reference username cannot auto-claim shared provider agent', () => {
  const refs = [
    {accountId:'customer_1',id:'ref_1',username:'shared_ref'},
    {accountId:'customer_2',id:'ref_2',username:'shared_ref'},
  ];
  const result = planGlobalReadOnlyBindings(refs,collectors,[],new Set());
  assert.equal(result.candidates.length,0);
  assert.equal(result.ambiguousAcrossCustomers,2);
  assert.equal(result.referencesExamined,2);
});

test('revoked targets are excluded; one collector already owned cannot cross tenants', () => {
  const refs = [
    {accountId:'customer_1',id:'a',username:'ref_a'},
    {accountId:'customer_2',id:'b',username:'ref_b'},
  ];
  const revoked = planGlobalReadOnlyBindings(refs,collectors,[],new Set(['customer_1:a']));
  assert.equal(revoked.revoked,1);
  assert.deepEqual(revoked.candidates.map(x=>x.accountId),['customer_2']);
  const shared = planGlobalReadOnlyBindings(refs,collectors,[
    {accountId:'customer_1',referenceId:'another',collectorAgentId:'2222222222222222'},
  ],new Set());
  assert.equal(shared.candidates.length,1);
  assert.equal(shared.candidates[0].accountId,'customer_1');
  assert.equal(shared.ambiguousOrInUse,1);
});

test('a draft agent stays reserved for its original owner after revoked or deleted reference', () => {
  const agentId = '1111111111111111';
  const reserved = reservedCollectorDraftAgents([
    {
      targetUsername: 'old_reference',
      details: JSON.stringify(makeCollectorDraftEvent(
        'old_reference', 'created', agentId)),
    },
    {
      targetUsername: 'old_reference',
      details: JSON.stringify(makeCollectorDraftEvent('old_reference', 'unconfirmed')),
    },
  ]);
  assert.deepEqual([...reserved], [agentId]);
  const foreign = [{accountId:'customer_2',id:'new_ref',username:'ref_a'}];
  const plan = planGlobalReadOnlyBindings(foreign, collectors, [],
    new Set(['customer_1:old_reference']), 3, reserved);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.ambiguousOrInUse, 1);
  assert.equal(plan.unmatched, 0);
  // No reservation means an independent existing source remains matchable.
  assert.equal(planGlobalReadOnlyBindings(foreign, collectors, [],
    new Set()).candidates.length, 1);
});

test('malformed or wrongly associated draft records do not invent ownership', () => {
  const reserved = reservedCollectorDraftAgents([
    {targetUsername:'ref_a', details:'malformed'},
    {targetUsername:'ref_a',details:JSON.stringify(makeCollectorDraftEvent(
      'other_ref','created','9999999999999999'))},
    {targetUsername:'ref_b',details:JSON.stringify(makeCollectorDraftEvent(
      'ref_b','existing-draft','2222222222222222'))},
  ]);
  assert.deepEqual([...reserved], ['2222222222222222']);
});

test('global operator batch is bounded and uses full candidate set, not just first customer', () => {
  const refs = [
    {accountId:'customer_a',id:'r1',username:'ref_a'},
    {accountId:'customer_b',id:'r2',username:'ref_b'},
    {accountId:'customer_c',id:'r3',username:'shared_ref'},
  ];
  const result = planGlobalReadOnlyBindings(refs,collectors,[],new Set(),2);
  assert.equal(result.candidates.length,2);
  assert.equal(result.deferred,1);
  assert.equal(result.referencesExamined,3);
});

test('operator endpoint is privileged, origin checked, transactionally scoped and never launches provider', () => {
  const route = readFileSync(
    'app/api/provider/phantombuster/match-all-customers/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route,/const session = await auth\(\)/);
  assert.match(route,/user\?\.role !== 'admin'/);
  assert.match(route,/request\.headers\.get\('origin'\)/);
  assert.match(route,/operation !== 'match-all-existing'|\.operation !== 'match-all-existing'/);
  assert.match(route,/discoverFollowerCollectors\(apiKey\)/);
  assert.match(route,/tx\.targetAccount\.findMany/);
  assert.match(route,/tx\.activityLog\.findMany/);
  assert.match(route,/action: COLLECTOR_DRAFT_ACTION/);
  assert.match(route,/reservedCollectorDraftAgents\(drafts\)/);
  assert.match(route,/planGlobalReadOnlyBindings/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/makeAudienceSourceBinding/);
  assert.match(route,/tx\.activityLog\.createMany/);
  assert.match(route,/take: 1001/);
  assert.match(route,/launchesCollectors: false/);
  assert.match(route,/instagramActionsExecuted: 0/);
  assert.doesNotMatch(route,/agents\/launch|agents\/save|user_follow|user_unfollow|followAction\.(create|update|delete)/);
  const oneCustomer = readFileSync(
    'app/api/provider/phantombuster/match-collectors/route.ts','utf8');
  assert.match(oneCustomer,/action: COLLECTOR_DRAFT_ACTION/);
  assert.match(oneCustomer,/reservedCollectorDraftAgents\(drafts\)/);
  assert.match(oneCustomer,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(oneCustomer,/const \[rows, currentRefs, drafts, allRefs\]/);
  assert.match(oneCustomer,/allRefs\.length > 1000/);
  assert.match(oneCustomer,/owners\.get\(ref\.username\.toLowerCase\(\)\)/);
  assert.match(oneCustomer,/uniqueToCustomer, discovered\.collectors/);
});

test('customer status endpoint only returns owned reference readiness and no provider secrets', () => {
  const route = readFileSync('app/api/reference-collection-status/route.ts','utf8');
  assert.match(route,/where: \{ id: accountId, userId \}/);
  assert.match(route,/instagramAccountId: account\.id/);
  assert.match(route,/loadActiveAudienceSources\(account\.id\)/);
  assert.match(route,/source-linked/);
  assert.match(route,/awaiting-collector/);
  assert.doesNotMatch(route,/collectorAgentId:|PHANTOMBUSTER_API_KEY|apiKey|instagramActionsExecuted: [1-9]/);
  const ui = readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/\/api\/reference-collection-status\?accountId=/);
  assert.match(ui,/Aguardando preparação/);
  assert.match(ui,/Fonte de dados vinculada/);
  const diagnostic = readFileSync('app/(app)/references/diagnostics/page.tsx','utf8');
  assert.match(diagnostic,/operator\?\.role === 'admin'/);
  assert.match(diagnostic,/OperatorCollectorIntakePanel/);
  assert.doesNotMatch(readFileSync('app/(app)/references/page.tsx','utf8'),
    /OperatorCollectorIntakePanel/);
});
