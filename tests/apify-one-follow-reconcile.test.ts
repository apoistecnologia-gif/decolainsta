import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {inspectOneFollow} from '../lib/providers/apify-one-follow';

const token='apify_api_test_dummy_abcdef';
const runId='nd88TvRT6EOn8IC1O';
const datasetId='YcDiydfyeLZyQoqbg';

test('preserve authenticated Actor run cost when dataset access fails',async()=>{
 const calls:string[]=[];
 const result=await inspectOneFollow(token,runId,'contateste6699',
  async(url,init)=>{
   calls.push(new URL(url).pathname);
   assert.equal(init?.method,'GET');
   if(url.includes('/actor-runs/'))
    return Response.json({data:{
     id:runId,status:'SUCCEEDED',defaultDatasetId:datasetId,
     usageTotalUsd:0.02125,
    }});
   return Response.json({error:{type:'insufficient-permissions'}},
    {status:403});
  });
 assert.deepEqual(calls,[
  '/v2/actor-runs/'+runId,
  '/v2/datasets/'+datasetId+'/items',
 ]);
 assert.deepEqual(result,{
  status:'unavailable',costUsd:0.02125,providerReportedFollow:false,
 });
});

test('Preview cron only reconciles the original run, never starts social action',()=>{
 const route=readFileSync(
  'app/api/cron/preview-apify-one-follow-reconcile/route.ts','utf8');
 const runner=readFileSync(
  'experimental/preview-audience-scheduler/run.py','utf8');
 assert.match(route,/VERCEL_ENV!=='preview'/);
 assert.match(route,/timingSafeEqual/);
 assert.match(route,/ORIGINAL_RUN_ID='nd88TvRT6EOn8IC1O'/);
 assert.match(route,/EXECUTOR_ID='17841411544892772'/);
 assert.match(route,/row\.targetUsername!==OLD_USERNAME/);
 assert.match(route,/inspectOneFollow\(token,ORIGINAL_RUN_ID,OLD_USERNAME\)/);
 assert.match(route,/details:row\.details,success:false/);
 assert.match(route,/actorRunsLaunched:0,instagramActionsExecuted:0/);
 assert.match(route,/independentlyVerified:false,unfollowEnabled:false/);
 assert.doesNotMatch(route,/startOneFollow\(|startOneUnfollow\(|followAction\.create\(/);
 assert.match(runner,/PREVIEW_APIFY_ONE_FOLLOW_AUDIT_CRON_ENABLED/);
 assert.match(runner,/method="GET"/);
});
