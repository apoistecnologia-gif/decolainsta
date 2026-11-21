import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  admitSequentialCollectorRun, sequentialCollectorReadiness,
  type CollectorRunScope, type CollectorRunProof,
} from '../lib/reference-shared-collector-evidence';

const expected: CollectorRunScope = {
  accountId: 'customer_a', referenceId: 'reference_a',
  referenceUsername: 'uber', collectorAgentId: '1111111111111111',
  containerId: '2222222222222222',
};
const proof: CollectorRunProof = {
  accountId: 'customer_a', referenceId: 'reference_a',
  collectorAgentId: '1111111111111111', containerId: '2222222222222222',
  inputProfileUrls: ['https://www.instagram.com/uber/'],
  inputEvidence: 'provider-run-snapshot', claimRecordedBeforeLaunch: true,
  containerState: 'finalized', resultLocation: 'completed_run',
};
test('only a finalized single-source provider run with durable matching claim can be attributed', () => {
  assert.deepEqual(admitSequentialCollectorRun(expected, proof), {
    allowed: true, source: 'run_scoped_single_reference',
    accountId: 'customer_a', referenceId: 'reference_a',
  });
});
test('mixed customer or reference can never receive the same provider output', () => {
  assert.deepEqual(admitSequentialCollectorRun({...expected,accountId:'customer_b'},proof),
    {allowed:false,reason:'cross-account'});
  assert.deepEqual(admitSequentialCollectorRun({...expected,referenceId:'other_ref'},proof),
    {allowed:false,reason:'reference-mismatch'});
  assert.deepEqual(admitSequentialCollectorRun({...expected,collectorAgentId:'3333333333333333'},proof),
    {allowed:false,reason:'agent-mismatch'});
  assert.deepEqual(admitSequentialCollectorRun({...expected,containerId:'3333333333333333'},proof),
    {allowed:false,reason:'container-mismatch'});
});
test('multi-reference outputs cannot be guessed by matching followers to a saved input list', () => {
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    inputProfileUrls:['https://instagram.com/uber/','https://instagram.com/other/']}),
    {allowed:false,reason:'multi-source-ambiguous'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,inputProfileUrls:[]}),
    {allowed:false,reason:'multi-source-ambiguous'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    inputProfileUrls:['https://instagram.com/prefeituradepetrolina/']}),
    {allowed:false,reason:'reference-mismatch'});
});
test('editable agent arguments, fallback result files and missing claims are not run provenance', () => {
  assert.deepEqual(admitSequentialCollectorRun(expected,null),
    {allowed:false,reason:'missing-evidence'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    inputEvidence:'current-agent-configuration'}),
    {allowed:false,reason:'input-not-verifiable'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    claimRecordedBeforeLaunch:false}),
    {allowed:false,reason:'claim-not-preexisting'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    resultLocation:'latest_agent_file'}),
    {allowed:false,reason:'not-run-scoped'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    containerState:'running'}),
    {allowed:false,reason:'not-finalized'});
});
test('malformed or malicious target never becomes accepted provenance', () => {
  assert.deepEqual(admitSequentialCollectorRun({...expected,referenceUsername:'../other'},proof),
    {allowed:false,reason:'invalid-scope'});
  assert.deepEqual(admitSequentialCollectorRun({...expected,containerId:'../wrong'},proof),
    {allowed:false,reason:'invalid-scope'});
  assert.deepEqual(admitSequentialCollectorRun(expected,{...proof,
    inputProfileUrls:['https://evil.example/uber/']}),
    {allowed:false,reason:'reference-mismatch'});
});
test('preview readiness is descriptive, not permission to import or launch', () => {
  assert.deepEqual(sequentialCollectorReadiness(3), {
    mode:'one_reference_per_execution', pendingReferences:3,
    mayShareOneAgentSequentially:true, collectorAssigned:false,
    providerRunInputVerified:false, exclusiveAgentLeaseImplemented:false,
    exclusiveAgentClaimPrepared:true, exclusiveAgentLeaseEnabled:false,
    importsEnabled:false, actionsEnabled:false,
  });
  const route = readFileSync('app/api/provider/phantombuster/provision-all-customers/route.ts','utf8');
  assert.match(route,/sharedCollector: sequentialCollectorReadiness\(plan\.eligible\)/);
  assert.doesNotMatch(route,/agents\/launch|user_follow|user_unfollow/);
});
