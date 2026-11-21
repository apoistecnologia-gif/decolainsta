import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  makeDynamicJobEvent,planOneShotUnverifiedRecovery,
} from '../lib/reference-dynamic-collection';

const accountId='operator_account',agentId='1111111111111111';
const refs=[
  {id:'r_am',username:'ammplamob'},
  {id:'r_pref',username:'prefeituradepetrolina'},
];
const make=(ref:typeof refs[number],state:'finished'|'finished-unverified'|'claimed',
  claim:string,owner=accountId)=>{
  const item=makeDynamicJobEvent({
    state,accountId:owner,agentId,referenceId:ref.id,
    referenceUsername:ref.username,claimId:claim,
    containerId:state==='claimed'?null:'2222222222222222',
  });
  assert.ok(item);
  return item;
};
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';

test('selects the latest single unverified reference without losing older successful proof',()=>{
 const jobs=[
  make(refs[1],'finished-unverified',c),
  make(refs[0],'finished',b),
  make(refs[0],'finished-unverified',a),
 ];
 assert.deepEqual(planOneShotUnverifiedRecovery(refs,jobs,accountId,agentId),refs[1]);
 assert.equal(planOneShotUnverifiedRecovery(refs,jobs,'other_account',agentId),null);
 assert.equal(planOneShotUnverifiedRecovery(refs,jobs,accountId,'9999999999999999'),null);
});

test('never repeats a recovery, and never starts while another claim is unresolved',()=>{
 const old=make(refs[1],'finished-unverified',a);
 const recovered=make(refs[1],'finished-unverified',b);
 assert.equal(planOneShotUnverifiedRecovery(refs,[recovered,old],accountId,agentId),null);
 assert.equal(planOneShotUnverifiedRecovery(refs,
   [make(refs[1],'claimed',c),old],accountId,agentId),null);
 assert.equal(planOneShotUnverifiedRecovery(refs,
   [old,make(refs[0],'finished-unverified',b)],accountId,agentId),null);
 assert.equal(planOneShotUnverifiedRecovery(refs,
   [old],accountId,agentId)?.username,'prefeituradepetrolina');
 assert.equal(planOneShotUnverifiedRecovery(refs.slice(0,1),[old],accountId,agentId),null);
});

test('finished or different-account latest receipt is not a recovery request',()=>{
 const old=make(refs[1],'finished-unverified',a);
 assert.equal(planOneShotUnverifiedRecovery(refs,
   [make(refs[1],'finished',b),old],accountId,agentId),null);
 assert.equal(planOneShotUnverifiedRecovery(refs,
   [make(refs[1],'finished-unverified',b,'other_account'),old],
   accountId,agentId),null);
});
