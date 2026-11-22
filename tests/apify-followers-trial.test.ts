import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
 APIFY_PILOT_ACTOR,APIFY_PILOT_MAX_USD,APIFY_PILOT_RESULTS_LIMIT,
 startCappedApifyPilot,inspectCappedApifyRun,readApifyTrialDataset,
 validateApifyRows,
} from '../lib/providers/apify-followers-trial';

const token='apify_api_test_only_long_token';
const id='bEI4kWh8GB8kb0s9M';
test('only 25 public no-cookie followers can launch, with a hard charge limit',async()=>{
 let calls=0;
 const r=await startCappedApifyPilot(token,'prefeituradepetrolina',async(url,init)=>{
   calls++;
   const parsed=new URL(url);
   assert.equal(parsed.hostname,'api.apify.com');
   assert.equal(parsed.pathname,'/v2/acts/'+APIFY_PILOT_ACTOR+'/runs');
   assert.equal(parsed.searchParams.get('maxTotalChargeUsd'),String(APIFY_PILOT_MAX_USD));
   assert.equal(parsed.searchParams.get('maxItems'),String(APIFY_PILOT_RESULTS_LIMIT));
   assert.equal(init?.method,'POST');
   assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer '+token);
   assert.deepEqual(JSON.parse(String(init?.body)),{
      Account:['prefeituradepetrolina'],resultsLimit:25,dataToScrape:'Followers',
   });
   assert.equal(String(init?.body).includes('cookie'),false);
   assert.equal(String(init?.body).includes('apoistecnologia'),false);
   return Response.json({data:{id,status:'READY'}});
 });
 assert.deepEqual(r,{status:'queued',runId:id});
 assert.equal(calls,1);
});
test('refused and ambiguous remote launches never automatically retry',async()=>{
 let calls=0;
 const refused=await startCappedApifyPilot(token,'prefeituradepetrolina',
   async()=>{calls++;return new Response(null,{status:402});});
 assert.deepEqual(refused,{status:'refused',runId:null});
 const unclear=await startCappedApifyPilot(token,'prefeituradepetrolina',
   async()=>{calls++;throw Error('sensitive provider error');});
 assert.deepEqual(unclear,{status:'unconfirmed',runId:null});
 assert.equal(calls,2);
});
test('read only exact Apify run and capped dataset, never another run',async()=>{
 const run=await inspectCappedApifyRun(token,id,
   async(url,init)=>{
    assert.equal(url,'https://api.apify.com/v2/actor-runs/'+id);
    assert.equal(init?.method,'GET');
    return Response.json({data:{id,status:'SUCCEEDED',
      defaultDatasetId:'YcDiydfyeLZyQoqbg',usageTotalUsd:0.017}});
   });
 assert.deepEqual(run,{status:'succeeded',datasetId:'YcDiydfyeLZyQoqbg',costUsd:0.017});
 const rows=await readApifyTrialDataset(token,'YcDiydfyeLZyQoqbg',
   'prefeituradepetrolina',async(url,init)=>{
     assert.equal(new URL(url).searchParams.get('limit'),'26');
     assert.equal(init?.method,'GET');
     return Response.json([
       {username_scrape:'prefeituradepetrolina',type:'Followers',username:'public_a'},
       {username_scrape:'prefeituradepetrolina',type:'Followers',username:'public_b'},
     ]);
   });
 assert.deepEqual(rows,{status:'verified',usernames:['public_a','public_b']});
});
test('reject mixed reference attribution, duplicates, 26 rows and non follower data',()=>{
 const row=(name:string,source='prefeituradepetrolina',type='Followers')=>({
  username_scrape:source,type,username:name,
 });
 assert.equal(validateApifyRows([row('x','wrong')],'prefeituradepetrolina').status,'invalid');
 assert.equal(validateApifyRows([row('x'),row('x')],'prefeituradepetrolina').status,'invalid');
 assert.equal(validateApifyRows([row('x','prefeituradepetrolina','Followings')],
    'prefeituradepetrolina').status,'invalid');
 assert.equal(validateApifyRows(Array.from({length:26},(_,i)=>row('u'+i)),
   'prefeituradepetrolina').status,'invalid');
 assert.equal(validateApifyRows([],'prefeituradepetrolina').status,'verified');
});
test('cron trial cannot act outside Preview or start an uncapped job',()=>{
 const route=readFileSync('app/api/cron/preview-apify-pilot/route.ts','utf8');
 assert.match(route,/VERCEL_ENV!=='preview'/);
 assert.match(route,/PREVIEW_APIFY_PILOT_ENABLED!=='yes'/);
 assert.match(route,/timingSafeEqual/);
 assert.match(route,/pg_try_advisory_xact_lock/);
 assert.match(route,/if\(old\)return null/);
 assert.match(route,/PREVIEW_APIFY_PILOT_REFERENCE/);
 assert.match(route,/startCappedApifyPilot/);
 assert.match(route,/readApifyTrialDataset/);
 assert.match(route,/APIFY_PILOT_SAMPLE_ACTION/);
 assert.doesNotMatch(route,/user_follow|user_unfollow|sessionCookie|agents\/launch/);
});
