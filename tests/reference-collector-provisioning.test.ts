import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  planCollectorProvisioning, type ProvisioningReference,
} from '../lib/reference-collector-provisioning';
import { makeCollectorDraftEvent } from '../lib/reference-collector-draft-events';

const at=(minute:number)=>new Date(Date.UTC(2026,10,20,9,minute));
const refs:ProvisioningReference[]=[
  {accountId:'customer_a',id:'a_1',username:'reference_a',createdAt:at(0)},
  {accountId:'customer_a',id:'a_2',username:'reference_b',createdAt:at(1)},
  {accountId:'customer_b',id:'b_1',username:'reference_c',createdAt:at(2)},
  {accountId:'customer_b',id:'b_2',username:'reference_d',createdAt:at(3)},
];

test('global intake picks next customer and reference without client selection',()=>{
  const plan=planCollectorProvisioning(refs,[],new Set(),[]);
  assert.deepEqual({
    total:plan.total,eligible:plan.eligible,linked:plan.linked,
    pendingSetup:plan.pendingSetup,previousAttemptNeedsReview:plan.previousAttemptNeedsReview,
  },{total:4,eligible:4,linked:0,pendingSetup:0,previousAttemptNeedsReview:0});
  assert.deepEqual(plan.next,{
    accountId:'customer_a',referenceId:'a_1',username:'reference_a',
  });
});

test('fair intake chooses account B after account A has one claimed reference',()=>{
  const claim=makeCollectorDraftEvent('a_1','claimed');
  const result=planCollectorProvisioning(refs,[],new Set(),[{
    accountId:'customer_a',referenceId:'a_1',details:JSON.stringify(claim),
    createdAt:at(5),
  }]);
  assert.deepEqual(result.next,{
    accountId:'customer_b',referenceId:'b_1',username:'reference_c',
  });
  assert.equal(result.eligible,3);
  assert.equal(result.previousAttemptNeedsReview,1);
});

test('provisioning is fail-closed after any prior claim, including uncertain outcomes',()=>{
  for(const raw of [
    JSON.stringify(makeCollectorDraftEvent('a_1','claimed')),
    JSON.stringify(makeCollectorDraftEvent('a_1','capacity-reached')),
    JSON.stringify(makeCollectorDraftEvent('a_1','unconfirmed')),
    'bad content',
  ]){
    const p=planCollectorProvisioning(refs.slice(0,2),[],new Set(),[{
      accountId:'customer_a',referenceId:'a_1',details:raw,createdAt:at(9),
    }]);
    assert.equal(p.next?.referenceId,'a_2');
    assert.equal(p.eligible,1);
    assert.equal(p.previousAttemptNeedsReview,1);
  }
});

test('created draft is not an active collector or an Instagram connection',()=>{
  const created=makeCollectorDraftEvent('a_1','created','1111111111111111');
  const p=planCollectorProvisioning(refs.slice(0,2),[],new Set(),[{
    accountId:'customer_a',referenceId:'a_1',details:JSON.stringify(created),
    createdAt:at(9),
  }]);
  assert.equal(p.pendingSetup,1);
  assert.equal(p.linked,0);
  assert.equal(p.eligible,1);
  assert.equal(p.next?.referenceId,'a_2');
});

test('active bindings and explicit revocations never get reprovisioned',()=>{
  const p=planCollectorProvisioning(refs,[
    {accountId:'customer_a',referenceId:'a_1',collectorAgentId:'1111111111111111'},
  ],new Set(['customer_b:b_1']),[]);
  assert.equal(p.linked,1);
  assert.equal(p.explicitlyRevoked,1);
  assert.equal(p.eligible,2);
  assert.equal(p.next?.referenceId,'a_2');
});

test('prior attempt for customer A never blocks matching reference ID of customer B',()=>{
  const sameRef=[
    {accountId:'customer_a',id:'shared_id',username:'ref_a',createdAt:at(0)},
    {accountId:'customer_b',id:'shared_id',username:'ref_b',createdAt:at(1)},
  ];
  const p=planCollectorProvisioning(sameRef,[],new Set(),[{
    accountId:'customer_a',referenceId:'shared_id',
    details:JSON.stringify(makeCollectorDraftEvent('shared_id','claimed')),
    createdAt:at(2),
  }]);
  assert.equal(p.eligible,1);
  assert.deepEqual(p.next,{
    accountId:'customer_b',referenceId:'shared_id',username:'ref_b',
  });
});

test('operator provisioning route requires explicit admin, Preview and two separate external write approvals',()=>{
  const code=readFileSync('app/api/provider/phantombuster/provision-all-customers/route.ts','utf8');
  assert.match(code,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(code,/const session = await auth\(\)/);
  assert.match(code,/user\?\.role !== 'admin'/);
  assert.match(code,/request\.headers\.get\('origin'\)/);
  assert.match(code,/confirmCreateUnconfiguredDraft !== true/);
  assert.match(code,/PHANTOMBUSTER_DRAFT_CREATION_ENABLED !== 'yes'/);
  assert.match(code,/const plan = planCollectorProvisioning/);
  assert.match(code,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(code,/makeCollectorDraftEvent\(next.referenceId,'claimed'\)/);
  assert.match(code,/findExistingCollectorDraft\(key,draft\)/);
  assert.match(code,/createUnconfiguredCollectorDraft\(key,draft\)/);
  assert.match(code,/automaticallyScheduled:false/);
  assert.match(code,/instagramActionsExecuted:0/);
  assert.doesNotMatch(code,/agents\/launch|user_follow|user_unfollow|api\.instagram\.com/);
  assert.doesNotMatch(code,/body\.accountId|body\.referenceId|body\.collectorAgentId/);
});

test('customer status only exposes account-scoped flags, no raw draft data',()=>{
  const c=readFileSync('app/api/reference-collection-status/route.ts','utf8');
  assert.match(c,/where: \{ id: accountId, userId \}/);
  assert.match(c,/instagramAccountId: account\.id, action: COLLECTOR_DRAFT_ACTION/);
  assert.match(c,/awaiting-provider-setup/);
  assert.match(c,/awaiting-provider-capacity/);
  assert.match(c,/needs-operator-review/);
  assert.doesNotMatch(c,/agentId:|collectorAgentId:|process\.env\.PHANTOMBUSTER_API_KEY/);
  const ui=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/Aguardando configuração da fonte/);
  assert.match(ui,/Preparação pendente: capacidade do provedor/);
  assert.doesNotMatch(ui,/provision-all-customers/);
});
