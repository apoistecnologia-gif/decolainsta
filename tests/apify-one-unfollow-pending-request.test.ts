import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {startOneUnfollow,inspectOneUnfollow}
 from '../lib/providers/apify-one-unfollow';
import {APIFY_ONE_FOLLOW_MAX_USD} from '../lib/providers/apify-one-follow';

const token='apify_api_test_dummy_abcdef';
const identity={
 instagramUserId:'17841411544892772',
 username:'apoistecnologia',
 previousUsernames:['contateste6699'],
} as const;
const target='0_crismeendes';
const runId='9ogdK0qqIaPFn4ZPk';
const datasetId='YcDiydfyeLZyQoqbg';
const cookies=JSON.stringify([
 {name:'sessionid',value:'0123456789:abcdefghijklmnopqrstuvwxyz0123456'},
 {name:'csrftoken',value:'abcdef12345678901234'},
 {name:'private_other',value:'do-not-send'},
]);

test('one unfollow Actor POST only, source is exact pending target',async()=>{
 const calls:string[]=[];
 const result=await startOneUnfollow(token,cookies,target,identity,
  async(url,init)=>{
   calls.push(url);
   assert.equal(init?.method,'POST');
   const u=new URL(url);
   assert.equal(u.searchParams.get('maxTotalChargeUsd'),
    String(APIFY_ONE_FOLLOW_MAX_USD));
   assert.equal(u.searchParams.get('maxItems'),'1');
   const body=JSON.parse(String(init?.body));
   assert.deepEqual(Object.keys(body).sort(),
    ['cookies','action','usernames','maxActionsPerRun'].sort());
   assert.equal(body.action,'unfollow');
   assert.deepEqual(body.usernames,[target]);
   assert.equal(body.maxActionsPerRun,1);
   assert.equal(String(init?.body).includes('do-not-send'),false);
   return Response.json({data:{id:runId,status:'READY'}});
  });
 assert.equal(calls.length,1);
 assert.deepEqual(result,{status:'queued',runId});
});

test('same Instagram account, missing cookies and timeout cannot launch/retry',async()=>{
 let calls=0;
 const network=async():Promise<Response>=>{
  calls++;throw Error('private token must not leak');
 };
 for(const name of ['apoistecnologia','contateste6699']){
  assert.deepEqual(await startOneUnfollow(
   token,cookies,name,identity,network
  ),{status:'refused',runId:null});
 }
 assert.deepEqual(await startOneUnfollow(
  token,undefined,target,identity,network
 ),{status:'refused',runId:null});
 assert.equal(calls,0);
 const result=await startOneUnfollow(token,cookies,target,identity,network);
 assert.deepEqual(result,{status:'unconfirmed',runId:null});
 assert.equal(calls,1);
 assert.equal(JSON.stringify(result).includes('private token'),false);
});

test('provider unfollow report is NOT independent cancellation evidence',async()=>{
 const out=await inspectOneUnfollow(token,runId,target,
  async(url,init)=>{
   assert.equal(init?.method,'GET');
   if(url.includes('/actor-runs/'))
    return Response.json({data:{id:runId,status:'SUCCEEDED',
     defaultDatasetId:datasetId,usageTotalUsd:0.004}});
   return Response.json([{
    username:target,action:'unfollow',status:'success',
    message:'private actor log must not be returned',
   }]);
  });
 assert.deepEqual(out,{
  status:'provider-reported',costUsd:0.004,
  providerReportedUnfollow:true,
 });
 assert.equal(JSON.stringify(out).includes('private actor'),false);
});

test('blocked, wrong action and wrong account are not successful cancellation',async()=>{
 for(const [status,expect] of [
  ['blocked','provider-blocked'],
  ['auth_error','provider-blocked'],
  ['failed','provider-rejected'],
  ['unknown','ambiguous'],
 ]){
  const result=await inspectOneUnfollow(token,runId,target,
   async(url)=>url.includes('/actor-runs/')
    ?Response.json({data:{id:runId,status:'SUCCEEDED',
      defaultDatasetId:datasetId}})
    :Response.json([{username:target,action:'unfollow',status}]));
  assert.equal(result.status,expect);
  assert.equal(result.providerReportedUnfollow,false);
 }
 const mismatch=await inspectOneUnfollow(token,runId,target,
  async(url)=>url.includes('/actor-runs/')
   ?Response.json({data:{id:runId,status:'SUCCEEDED',
     defaultDatasetId:datasetId}})
   :Response.json([{username:target,action:'follow',status:'success'}]));
 assert.equal(mismatch.status,'ambiguous');
});

test('preview route exclusively targets observed pending original request',()=>{
 const route=readFileSync(
  'app/api/operator/apify/pending-request-cancel-test/route.ts','utf8');
 const panel=readFileSync(
  'app/(app)/references/_components/simple-references-panel.tsx','utf8');
 const ui=readFileSync(
  'app/(app)/references/_components/apify-pending-request-cancel-test.tsx','utf8');
 assert.match(route,/VERCEL_ENV!=='preview'/);
 assert.match(route,/user\?\.role!=='admin'/);
 assert.match(route,/matchOperatorFollowObservation/);
 assert.match(route,/d\?\.state!=='provider-reported'/);
 assert.match(route,/d\?\.providerReportedFollow!==true/);
 assert.match(route,/PREVIEW_APIFY_PENDING_REQUEST_CANCEL_ENABLED==='yes'/);
 assert.match(route,/confirmRealInstagramAction!==true/);
 assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
 assert.match(route,/const started=await startOneUnfollow/);
 assert.match(route,/sourceFollowRunId:h\.followRunId/);
 assert.match(route,/cancelledIndependentlyVerified:false/);
 assert.match(route,/automatedUnfollowEnabled:false/);
 assert.match(route,/mayRetryAutomatically:false/);
 assert.match(ui,/window\.confirm/);
 assert.match(ui,/Testar 1 cancelamento/);
 assert.match(panel,/ApifyPendingRequestCancelTest/);
 assert.doesNotMatch(route,/startOneFollow\(|followAction\.create\(/);
 assert.doesNotMatch(route,/instagramAccount\.update\(/);
});
