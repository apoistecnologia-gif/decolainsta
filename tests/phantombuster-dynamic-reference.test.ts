import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  dynamicReferenceLaunchPayload,launchExistingCollectorForReference,
  inspectDynamicCollectorTemplate,
} from '../lib/providers/phantombuster-dynamic-reference';
import {
  makeDynamicJobEvent,parseDynamicJobEvent,planDynamicReferenceQueue,
} from '../lib/reference-dynamic-collection';

const id='1111111111111111';
const claimId='a789b196-a830-4a44-93ca-9d2f53b0f772';
test('dynamic input overrides one reference without changing agent URL or session',()=>{
  const value=dynamicReferenceLaunchPayload(id,'uber',claimId);
  assert.deepEqual(value,{
    id,bonusArgument:{spreadsheetUrl:'https://www.instagram.com/uber/'},
    saveArgument:false,manualLaunch:true,maxInstanceCount:1,
    userCustomMetadata:{decolainstaClaimId:claimId},
  });
  assert.equal(dynamicReferenceLaunchPayload(id,'https://instagram.com/uber',claimId),null);
  assert.equal(dynamicReferenceLaunchPayload(id,'../uber',claimId),null);
  assert.equal(dynamicReferenceLaunchPayload('bad', 'uber', claimId),null);
  assert.doesNotMatch(JSON.stringify(value),/sessionCookie|SECRET|password|proxy/);
});
test('PhantomBuster launches use one-time bonusArgument and do not save settings',async()=>{
  let calls=0;
  const result=await launchExistingCollectorForReference('SECRET_API_KEY',id,'uber',claimId,
    async(url,init)=>{
      calls++;
      assert.equal(url,'https://api.phantombuster.com/api/v2/agents/launch');
      assert.equal(init?.method,'POST');
      assert.equal(init?.credentials,'omit');
      const body=JSON.parse(String(init?.body));
      assert.equal(body.bonusArgument.spreadsheetUrl,'https://www.instagram.com/uber/');
      assert.equal(body.saveArgument,false);
      assert.equal(body.maxInstanceCount,1);
      assert.deepEqual(Object.keys(body).sort(),
        ['bonusArgument','id','manualLaunch','maxInstanceCount','saveArgument','userCustomMetadata'].sort());
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],'SECRET_API_KEY');
      return Response.json({data:{containerId:'2222222222222222'}});
    });
  assert.equal(calls,1);
  assert.deepEqual(result,{status:'queued',containerId:'2222222222222222'});
  assert.doesNotMatch(JSON.stringify(result),/SECRET|spreadsheetUrl|password/);
});
test('uncertain launch responses never authorize automatic repeat',async()=>{
  const unavailable=await launchExistingCollectorForReference('key',id,'uber',claimId,
    async()=>{throw new Error('connection lost after sending request');});
  assert.deepEqual(unavailable,{status:'unconfirmed',containerId:null});
  const ambiguous=await launchExistingCollectorForReference('key',id,'uber',claimId,
    async()=>Response.json({success:true}));
  assert.deepEqual(ambiguous,{status:'unconfirmed',containerId:null});
});
test('existing agent inspected without returning saved cookie',async()=>{
  const check=await inspectDynamicCollectorTemplate('key',id,async(url,init)=>{
    assert.match(url,/agents\/fetch/);
    assert.equal(init?.method,'GET');
    return Response.json({data:{id,script:'Instagram Follower Collector.js',
      argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/mameto_lueji/',
        sessionCookie:'SENSITIVE_IG_SESSION'})}});
  });
  assert.equal(check,'ready');
});
test('queue selects only saved references and never retries attempted reference',()=>{
  const refs=[{id:'r1',username:'uber'},{id:'r2',username:'ammplamob'}];
  const base={accountId:'account_a',referenceId:'r1',
    referenceUsername:'uber',agentId:id,claimId,containerId:null};
  const claimed=makeDynamicJobEvent({...base,state:'claimed'});
  assert.ok(claimed);
  assert.deepEqual(parseDynamicJobEvent(JSON.stringify(claimed)),claimed);
  assert.equal(planDynamicReferenceQueue(refs,[claimed!],id).unresolved,true);
  assert.equal(planDynamicReferenceQueue(refs,[claimed!],id).next,null);
  const finished=makeDynamicJobEvent({...base,state:'finished'});
  assert.deepEqual(planDynamicReferenceQueue(refs,[finished!],id).next,
    {id:'r2',username:'ammplamob'});
  assert.equal(parseDynamicJobEvent(JSON.stringify({...finished,state:'unknown'})),null);
  assert.equal(parseDynamicJobEvent(JSON.stringify({...finished,sessionCookie:'s'})),null);
});
test('dynamic controller is preview gated, operator only, idempotent and account isolated',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(src,/process\.env\.VERCEL_ENV!=='preview'/);
  assert.match(src,/user\?\.role!=='admin'/);
  assert.match(src,/request\.headers\.get\('origin'\)/);
  assert.match(src,/PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes'/);
  assert.match(src,/instagramAccountId:accountId/);
  assert.match(src,/pg_try_advisory_xact_lock/);
  assert.match(src,/\$queryRaw<Array<\{acquired:boolean\}>>/);
  assert.match(src,/lockRows\[0\]\.acquired!==true/);
  assert.doesNotMatch(src,/\$queryRawUnsafe\(/);
  assert.match(src,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(src,/event&&event.accountId!==accountId/);
  assert.match(src,/state:'claimed'/);
  assert.match(src,/launchExistingCollectorForReference/);
  assert.match(src,/noAutomaticRetry/);
  assert.doesNotMatch(src,/followSingle|unfollowSingle|InstagramFollowersAutoFollow|agents\/save/);
});
