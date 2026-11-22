import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  makeCandidateEvidence,makeApifyCandidateEvidence,parseCandidateEvidence,
} from '../lib/reference-candidate-queue';
import {
  parseCompletedApifyReceipt,parseSavedApifySample,
  planSavedApifyCandidates,
} from '../lib/reference-apify-candidate-source';
import {
  APIFY_PILOT_ACTOR,APIFY_PILOT_RESULTS_LIMIT,
} from '../lib/providers/apify-followers-trial';

const runId='NyjWX6l7ULqZft3Rd';
const referenceId='pref_ref_id';
const name='prefeituradepetrolina';
const accountId='operator_account';

const receipt=()=>JSON.stringify({
 version:1,state:'finished',accountId,referenceId,referenceUsername:name,
 actor:APIFY_PILOT_ACTOR,runId,resultsLimit:APIFY_PILOT_RESULTS_LIMIT,
 maxUsd:0.25,resultCount:25,costUsd:0.02125,
});
const sample=(id:string,names:string[],override:Record<string,unknown>={})=>({
 id,targetUsername:name,success:true,
 details:JSON.stringify({
  version:1,source:'apify-public-no-cookie',actor:APIFY_PILOT_ACTOR,
  runId,referenceId,referenceUsername:name,usernames:names,
  completeFollowerList:false,verifiedByMeta:false,...override,
 }),
});
const rows=()=>[
 sample('snapshot1',Array.from({length:10},(_,i)=>'sample'+i)),
 sample('snapshot2',Array.from({length:10},(_,i)=>'sample'+(i+10))),
 sample('snapshot3',Array.from({length:5},(_,i)=>'sample'+(i+20))),
];

test('legacy PhantomBuster v1 and Apify v2 candidate evidence stay distinct',()=>{
 const old=makeCandidateEvidence(referenceId,name,'snapshotold','6405192514345545');
 assert.ok(old);
 assert.deepEqual(parseCandidateEvidence(JSON.stringify(old)),old);
 const evidence=makeApifyCandidateEvidence(referenceId,name,'snapshot1',runId);
 assert.ok(evidence);
 assert.equal(evidence.version,2);
 assert.equal(evidence.provider,'apify');
 assert.equal(evidence.provenance,'apify-public-no-cookie');
 assert.equal(evidence.verifiedByMeta,false);
 assert.equal(evidence.followbackVerified,false);
 assert.equal(evidence.actionsEnabled,false);
 assert.deepEqual(parseCandidateEvidence(JSON.stringify(evidence)),evidence);
 assert.equal(parseCandidateEvidence(JSON.stringify({...evidence,
   actionsEnabled:true})),null);
 assert.equal(parseCandidateEvidence(JSON.stringify({...evidence,
   provider:'phantombuster'})),null);
 assert.equal(parseCandidateEvidence(JSON.stringify({...evidence,
   sessionCookie:'sensitive'})),null);
 assert.equal(makeApifyCandidateEvidence(referenceId,name,'sample1','wrong'),null);
});

test('only complete finished trial and exact capped samples can be indexed',()=>{
 const completed=parseCompletedApifyReceipt(receipt());
 assert.ok(completed);
 assert.equal(completed.runId,runId);
 assert.equal(parseCompletedApifyReceipt(JSON.stringify({
   ...JSON.parse(receipt()),state:'finished-unverified'})),null);
 assert.equal(parseCompletedApifyReceipt(JSON.stringify({
   ...JSON.parse(receipt()),resultCount:26})),null);
 assert.equal(parseCompletedApifyReceipt(JSON.stringify({
   ...JSON.parse(receipt()),maxUsd:20})),null);
 assert.equal(parseCompletedApifyReceipt(JSON.stringify({
   ...JSON.parse(receipt()),token:'private'})),null);
 const batch=sample('s1',['sample1']);
 assert.equal(parseSavedApifySample(batch.details)?.usernames.length,1);
 assert.equal(parseSavedApifySample(sample('s1',['sample1'],{
   completeFollowerList:true}).details),null);
 assert.equal(parseSavedApifySample(sample('s1',['sample1'],{
   actor:'another_actor'}).details),null);
});

test('25 saved names enter candidate index with real per-sample provenance and dedup',()=>{
 const completed=parseCompletedApifyReceipt(receipt());
 assert.ok(completed);
 const plan=planSavedApifyCandidates(completed,rows(),['sample0','sample1'],
   ['sample2','apoistecnologia'],900);
 assert.equal(plan.status,'verified');
 if(plan.status!=='verified')throw Error('unverified');
 assert.equal(plan.found,25);
 assert.equal(plan.skippedExisting,2);
 assert.equal(plan.insert.length,22);
 assert.equal(new Set(plan.insert.map(x=>x.username)).size,22);
 assert.equal(plan.insert.find(x=>x.username==='sample10')?.evidence.snapshotId,
  'snapshot2');
 assert.equal(plan.insert[0].evidence.sourceRunId,runId);
 assert.equal(plan.insert.some(x=>x.username==='sample2'),false);
 // Running a second time is idempotent, even after mixed-provider imports.
 const again=planSavedApifyCandidates(completed,rows(),
  [...plan.insert.map(x=>x.username),'sample0','sample1'],['sample2'],900);
 assert.equal(again.status,'verified');
 if(again.status==='verified')assert.equal(again.insert.length,0);
});

test('fail closed on missing/wrong/mixed batches, duplicate usernames and capacity',()=>{
 const completed=parseCompletedApifyReceipt(receipt());
 assert.ok(completed);
 const invalidSets=[
  rows().slice(0,2),
  [...rows(),sample('snapshot4',['extra'])],
  [rows()[0],sample('snapshot2',['sample0']),rows()[2]],
  [rows()[0],sample('snapshot2',['a'],{referenceUsername:'uber'}),rows()[2]],
  [rows()[0],sample('snapshot2',['a'],{runId:'AAAAAAAAAAAAAAAAA'}),rows()[2]],
  [rows()[0],{...rows()[1],success:false},rows()[2]],
  [rows()[0],{...rows()[1],targetUsername:'uber'},rows()[2]],
 ];
 for(const list of invalidSets)
  assert.equal(planSavedApifyCandidates(completed,list,[],[],100).status,'invalid');
 const capped=planSavedApifyCandidates(completed,rows(),[],[],20);
 assert.equal(capped.status,'capacity-reached');
 assert.deepEqual(capped.insert,[]);
});

test('server import is Preview-only, authenticated, isolated and no remote actions',()=>{
 const code=readFileSync('app/api/cron/preview-apify-candidate-index/route.ts','utf8');
 const service=readFileSync('lib/server/apify-candidate-index.ts','utf8');
 assert.match(code,/VERCEL_ENV!=='preview'/);
 assert.match(code,/PREVIEW_APIFY_INDEX_ENABLED!=='yes'/);
 assert.match(code,/timingSafeEqual/);
 assert.match(code,/pg_try_advisory_xact_lock/);
 assert.match(code,/Prisma.TransactionIsolationLevel.Serializable/);
 assert.match(code,/indexSavedApifyCandidates/);
 assert.match(service,/APIFY_PILOT_ACTION/);
 assert.match(service,/APIFY_PILOT_SAMPLE_ACTION/);
 assert.match(service,/planSavedApifyCandidates/);
 assert.match(service,/tx.activityLog.createMany/);
 assert.match(service,/AUDIENCE_CANDIDATE_ACTION/);
 assert.doesNotMatch(service+/\n/+code,/startCappedApifyPilot|user_follow|user_unfollow|followAction\.create|agents\/launch|sessionCookie/);
});
