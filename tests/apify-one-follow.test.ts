import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
 APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_ACTION,APIFY_ONE_FOLLOW_MAX_USD,
 parseMinimalInstagramCookies,startOneFollow,inspectOneFollow,
} from '../lib/providers/apify-one-follow';
const runId='NyjWX6l7ULqZft3Rd';
const dataset='YcDiydfyeLZyQoqbg';
const token='apify_api_test_dummy_abcdef';
const raw=JSON.stringify([
  {name:'sessionid',value:'0123456789:abcdefghijklmnopqrstuvwxyz0123456',
   domain:'.instagram.com'},
  {name:'csrftoken',value:'abcdef12345678901234',domain:'.instagram.com'},
  {name:'other_sensitive',value:'must_not_be_forwarded'},
]);
test('minimal Instagram cookie extraction strips other browser data',()=>{
 const parsed=parseMinimalInstagramCookies(raw);
 assert.deepEqual(parsed,[
  {name:'sessionid',value:'0123456789:abcdefghijklmnopqrstuvwxyz0123456'},
  {name:'csrftoken',value:'abcdef12345678901234'},
 ]);
 assert.equal(JSON.stringify(parsed).includes('other_sensitive'),false);
 assert.equal(parseMinimalInstagramCookies(''),null);
 assert.equal(parseMinimalInstagramCookies(raw.replace('.instagram.com','example.org')),null);
 assert.equal(parseMinimalInstagramCookies(JSON.stringify([
  {name:'sessionid',value:'0123456789:abcdefghijklmnopqrstuvwxyz0123456'},
  {name:'sessionid',value:'0123456789:abcdefghijklmnopqrstuvwxyz0123456'},
  {name:'csrftoken',value:'abcdef12345678901234'},
 ])),null);
});
test('only one follow is sent, cost capped, no other cookie or username',async()=>{
 let count=0;
 const result=await startOneFollow(token,raw,'contateste6699',
  async(url,init)=>{
   count++;
   const u=new URL(url);
   assert.equal(u.pathname,'/v2/acts/'+APIFY_ONE_FOLLOW_ACTOR+'/runs');
   assert.equal(u.searchParams.get('maxTotalChargeUsd'),String(APIFY_ONE_FOLLOW_MAX_USD));
   assert.equal(u.searchParams.get('maxItems'),'1');
   assert.equal(init?.method,'POST');
   const body=JSON.parse(String(init?.body)) as Record<string,unknown>;
   assert.deepEqual(Object.keys(body).sort(),
      ['action','cookies','maxActionsPerRun','usernames'].sort());
   assert.equal(body.action,'follow');
   assert.deepEqual(body.usernames,['contateste6699']);
   assert.equal(body.maxActionsPerRun,1);
   assert.deepEqual(body.cookies,parseMinimalInstagramCookies(raw));
   assert.equal(String(init?.body).includes('other_sensitive'),false);
   return Response.json({data:{id:runId,status:'READY'}});
  });
 assert.equal(count,1);
 assert.deepEqual(result,{status:'queued',runId});
});
test('failed requests are never retried after ambiguity',async()=>{
 let calls=0;
 const result=await startOneFollow(token,raw,'contateste6699',async()=>{
  calls++;throw Error('SECRET provider response');
 });
 assert.equal(calls,1);
 assert.deepEqual(result,{status:'unconfirmed',runId:null});
 assert.equal(JSON.stringify(result).includes('SECRET'),false);
 const rejected=await startOneFollow(token,raw,'contateste6699',
  async()=>new Response(null,{status:403}));
 assert.deepEqual(rejected,{status:'refused',runId:null});
});
test('inspect only exact provider run and exact target, no raw logs or secrets',async()=>{
 let checks=0;
 const result=await inspectOneFollow(token,runId,'contateste6699',
  async(url,init)=>{
   checks++;
   const path=new URL(url).pathname;
   assert.equal(init?.method,'GET');
   assert.equal(init?.body,undefined);
   if(path==='/v2/actor-runs/'+runId){
    return Response.json({data:{id:runId,status:'SUCCEEDED',
       defaultDatasetId:dataset,usageTotalUsd:0.03}});
   }
   assert.equal(path,'/v2/datasets/'+dataset+'/items');
   assert.equal(new URL(url).searchParams.get('limit'),'2');
   return Response.json([{
     username:'contateste6699',action:'follow',status:'success',
     message:'private provider message must never be surfaced',
   }]);
  });
 assert.equal(checks,2);
 assert.deepEqual(result,{
  status:'provider-reported',costUsd:0.03,providerReportedFollow:true,
 });
 assert.equal(JSON.stringify(result).includes('private provider'),false);
});
test('block, authentication challenge and ambiguous results are not follow success',async()=>{
 for(const [providerStatus,expected] of [
   ['blocked','provider-blocked'],['rate_limited','provider-blocked'],
   ['auth_error','provider-blocked'],['failed','provider-rejected'],
   ['unexpected','ambiguous'],
 ]){
  const result=await inspectOneFollow(token,runId,'contateste6699',
   async(url)=>{
    if(url.includes('/actor-runs/')){
      return Response.json({data:{id:runId,status:'SUCCEEDED',
        defaultDatasetId:dataset}});
    }
    return Response.json([{
      username:'contateste6699',action:'follow',status:providerStatus,
    }]);
   });
  assert.equal(result.status,expected);
  assert.equal(result.providerReportedFollow,false);
 }
 const mixed=await inspectOneFollow(token,runId,'contateste6699',
   async(url)=>url.includes('/actor-runs/')
     ?Response.json({data:{id:runId,status:'SUCCEEDED',
        defaultDatasetId:dataset}})
     :Response.json([{username:'another',action:'follow',status:'success'}]));
 assert.equal(mixed.status,'ambiguous');
});
test('admin operator, same-origin and durable one-attempt claim protect real follow',()=>{
 const route=readFileSync('app/api/operator/apify/one-follow/route.ts','utf8');
 const ui=readFileSync('app/(app)/references/_components/apify-one-follow-test.tsx','utf8');
 const panel=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
 assert.equal(APIFY_ONE_FOLLOW_ACTION,'apify_one_follow_attempt_v1');
 assert.match(route,/VERCEL_ENV==='preview'/);
 assert.match(route,/user\?\.role!=='admin'/);
 assert.match(route,/req\.headers\.get\('origin'\)!==new URL\(req\.url\)\.origin/);
 assert.match(route,/pg_try_advisory_xact_lock/);
 assert.match(route,/Prisma.TransactionIsolationLevel.Serializable/);
 assert.match(route,/if\(prior\)return null/);
 assert.match(route,/if\(row\)return denied/);
 assert.match(route,/previousReal>0/);
 assert.match(route,/inspected\.combined\.permissions!=='limited'/);
 assert.match(route,/CONFIRMO UM FOLLOW REAL NO INSTAGRAM/);
 assert.match(ui,/window\.confirm/);
 assert.match(ui,/Testar 1 follow real/);
 assert.match(panel,/ApifyOneFollowTest/);
 assert.doesNotMatch(route,/process\.env\.APIFY_INSTAGRAM_COOKIES_JSON\s*\|\|/);
 assert.doesNotMatch(route,/FollowAction\.create|followAction\.create|unfollowEnabled:true|unfollowScheduled:true/);
});
