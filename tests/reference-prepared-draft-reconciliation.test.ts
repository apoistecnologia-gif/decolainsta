import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { makeCollectorDraftEvent } from '../lib/reference-collector-draft-events';
import {
  planPreparedDraftReconciliation,
  type PreparedReference, type PreparedDraft,
} from '../lib/reference-prepared-draft-reconciliation';

const timestamp = (m:number)=>new Date(Date.UTC(2026,10,20,14,m));
const refs:PreparedReference[] = [
  {id:'ref_a',accountId:'customer_a',username:'shared_reference',createdAt:timestamp(0)},
  {id:'ref_b',accountId:'customer_b',username:'shared_reference',createdAt:timestamp(1)},
  {id:'ref_c',accountId:'customer_c',username:'different_reference',createdAt:timestamp(2)},
];
const draft = (
  accountId:string, referenceId:string, agentId:string,
  state:'created'|'existing-draft'='created',
):PreparedDraft=>({
  accountId, referenceId, createdAt: timestamp(5),
  details:JSON.stringify(makeCollectorDraftEvent(referenceId,state,agentId)),
});

test('distinct deterministic prepared agents can be matched to customers with same reference',()=>{
  const entries = [
    draft('customer_a','ref_a','1111111111111111'),
    draft('customer_b','ref_b','2222222222222222'),
  ];
  const p=planPreparedDraftReconciliation(refs,entries,[],new Set());
  assert.deepEqual(p,{
    candidates:[
      {accountId:'customer_a',referenceId:'ref_a',username:'shared_reference',
        agentId:'1111111111111111'},
      {accountId:'customer_b',referenceId:'ref_b',username:'shared_reference',
        agentId:'2222222222222222'},
    ],
    pending:2,ambiguous:0,nextOffset:null,
  });
});

test('same agent ID across customers is ambiguous and never auto-bound',()=>{
  const entries=[
    draft('customer_a','ref_a','1111111111111111'),
    draft('customer_b','ref_b','1111111111111111'),
  ];
  const p=planPreparedDraftReconciliation(refs,entries,[],new Set());
  assert.equal(p.candidates.length,0);
  assert.equal(p.ambiguous,2);
});

test('a prior draft-owned agent cannot be assigned to a reference if already bound elsewhere',()=>{
  const p=planPreparedDraftReconciliation(refs,
    [draft('customer_a','ref_a','1111111111111111')],
    [{accountId:'customer_c',referenceId:'ref_c',
      collectorAgentId:'1111111111111111'}],
    new Set());
  assert.equal(p.pending,0);
  assert.equal(p.ambiguous,1);
});

test('revoked, already linked, and removed references cannot be rebound',()=>{
  const events=[
    draft('customer_a','ref_a','1111111111111111'),
    draft('customer_b','ref_b','2222222222222222'),
    draft('customer_c','ref_c','3333333333333333'),
  ];
  assert.deepEqual(planPreparedDraftReconciliation(refs,events,[
    {accountId:'customer_a',referenceId:'ref_a',collectorAgentId:'1111111111111111'},
  ],new Set(['customer_b:ref_b'])).candidates.map(x=>x.referenceId),['ref_c']);
  assert.equal(planPreparedDraftReconciliation(refs.slice(0,1),
    events.slice(2),[],new Set()).candidates.length,0);
});

test('unknown, malformed, claimed and unconfirmed attempts cannot produce a source binding',()=>{
  const badEvents:PreparedDraft[]=[
    {accountId:'customer_a',referenceId:'ref_a',createdAt:timestamp(5),
      details:JSON.stringify(makeCollectorDraftEvent('ref_a','claimed'))},
    {accountId:'customer_b',referenceId:'ref_b',createdAt:timestamp(5),
      details:'malformed'},
    {accountId:'customer_c',referenceId:'ref_c',createdAt:timestamp(5),
      details:JSON.stringify(makeCollectorDraftEvent('ref_c','unconfirmed'))},
  ];
  assert.deepEqual(planPreparedDraftReconciliation(refs,badEvents,[],new Set()),{
    candidates:[],pending:0,ambiguous:0,nextOffset:null,
  });
  const past=draft('customer_a','ref_a','1111111111111111');
  const newer:PreparedDraft={
    accountId:'customer_a',referenceId:'ref_a',createdAt:timestamp(15),
    details:JSON.stringify(makeCollectorDraftEvent('ref_a','unconfirmed')),
  };
  assert.equal(planPreparedDraftReconciliation(refs,[past,newer],[],
    new Set()).candidates.length,0);
});

test('the reconciliation batch inspects no more than three prepared sources',()=>{
  const accounts=Array.from({length:6},(_,i)=>({
    id:'r'+i, accountId:'customer_'+i,username:'reference_'+i,
    createdAt:new Date(Date.UTC(2026,10,20,14,i)),
  }));
  const events=accounts.map((ref,i)=>draft(ref.accountId,ref.id,
    '12345678901234'+String(i).padStart(2,'0')));
  const p=planPreparedDraftReconciliation(accounts,events,[],new Set());
  assert.equal(p.pending,6);
  assert.equal(p.candidates.length,3);
  assert.deepEqual(p.candidates.map(x=>x.referenceId),['r0','r1','r2']);
  assert.equal(p.nextOffset,3);
  const second = planPreparedDraftReconciliation(accounts,events,[],
    new Set(),3,p.nextOffset);
  assert.deepEqual(second.candidates.map(x=>x.referenceId),['r3','r4','r5']);
  assert.equal(second.nextOffset,null);
  // Earlier pages can become linked without shifting the stable cursor.
  const firstBound = p.candidates.map(c=>({
    accountId:c.accountId,referenceId:c.referenceId,collectorAgentId:c.agentId,
  }));
  const afterBinding = planPreparedDraftReconciliation(accounts,events,
    firstBound,new Set(),3,p.nextOffset);
  assert.deepEqual(afterBinding.candidates.map(x=>x.referenceId),['r3','r4','r5']);
  assert.equal(afterBinding.pending,3);
  assert.equal(afterBinding.nextOffset,null);
  // Replaying a page after binding is safe: it never proposes the old links.
  assert.deepEqual(planPreparedDraftReconciliation(accounts,events,
    firstBound,new Set()).candidates.map(x=>x.referenceId),['r3','r4','r5']);
});

test('operator reconciliation checks provider identity and config before serializable binding',()=>{
  const route=readFileSync('app/api/provider/phantombuster/reconcile-prepared/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route,/operator\?\.role !== 'admin'/);
  assert.match(route,/request\.headers\.get\('origin'\)/);
  assert.match(route,/operation !== 'reconcile-prepared'|\.operation !== 'reconcile-prepared'/);
  assert.match(route,/prepareCollectorDraft/);
  assert.match(route,/findExistingCollectorDraft\(apiKey, expected\)/);
  assert.match(route,/nameCheck\.agentId !== pair\.agentId/);
  assert.match(route,/inspectConfiguredFollowerCollector/);
  assert.match(route,/configured === 'matched'/);
  assert.match(route,/tx\.activityLog\.createMany/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/const fresh = await load\(tx as typeof prisma\)/);
  assert.match(route,/Number\.isInteger\(body\.offset\)/);
  assert.match(route,/scanOffset = typeof body\.offset/);
  assert.match(route,/disabledAudienceReferenceKeys\(bindings\), 3, scanOffset/);
  assert.match(route,/nextOffset: planned\.nextOffset/);
  assert.match(route,/makeAudienceSourceBinding/);
  assert.match(route,/instagramActionsExecuted: 0/);
  assert.doesNotMatch(route,/agents\/launch|agents\/save|user_follow|user_unfollow|sessionCookie|followAction\.create/);
  assert.doesNotMatch(route,/body\.accountId|body\.referenceId|body\.collectorAgentId/);
  const ui=readFileSync('app/(app)/references/_components/operator-collector-intake-panel.tsx','utf8');
  assert.match(ui,/Conferir rascunhos configurados/);
  assert.match(ui,/\/api\/provider\/phantombuster\/reconcile-prepared/);
  assert.doesNotMatch(readFileSync('app/(app)/references/page.tsx','utf8'),
    /OperatorCollectorIntakePanel/);
});
