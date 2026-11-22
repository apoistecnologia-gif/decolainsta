import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {inspectApifyPilotConnection} from '../lib/providers/apify-pilot-readiness';

test('absent token never accesses Apify or charges for an Actor',async()=>{
 const r=await inspectApifyPilotConnection(undefined,async()=>{
  throw Error('unexpected remote call');
 });
 assert.deepEqual(r,{
  status:'not-configured',authenticationChecked:false,actorRunsExecuted:0,
  instagramActionsExecuted:0,collectionEnabled:false,
 });
});
test('Apify check is only an authenticated GET to /users/me, with no results exposed',async()=>{
 let count=0;
 const r=await inspectApifyPilotConnection('apify_api_key_for_test',async(url,init)=>{
  count++;
  assert.equal(url,'https://api.apify.com/v2/users/me');
  assert.equal(init?.method,'GET');
  assert.equal(init?.body,undefined);
  assert.equal((init?.headers as Record<string,string>).Authorization,
    'Bearer apify_api_key_for_test');
  return Response.json({data:{id:'sensitive-account',token:'secret'}});
 });
 assert.equal(count,1);
 assert.deepEqual(r,{
  status:'connected',authenticationChecked:true,actorRunsExecuted:0,
  instagramActionsExecuted:0,collectionEnabled:false,
 });
 assert.equal(JSON.stringify(r).includes('sensitive-account'),false);
});
test('rejects invalid token, provider limits and errors without exposing secrets',async()=>{
 for(const [status,expected] of [[401,'invalid-token'],[403,'invalid-token'],
   [429,'rate-limited'],[500,'unavailable']] as const){
   const r=await inspectApifyPilotConnection('apify_api_key_for_test',
     async()=>new Response(null,{status}));
   assert.equal(r.status,expected);
 }
 const bad=await inspectApifyPilotConnection('short',async()=>{
   throw Error('unexpected');
 });
 assert.equal(bad.status,'invalid-token');
 const r=await inspectApifyPilotConnection('apify_api_key_for_test',async()=>{
  throw Error('Provider secret: should not leak');
 });
 assert.equal(r.status,'unavailable');
 assert.equal(JSON.stringify(r).includes('secret'),false);
});
test('Apify readiness API is isolated from production and operator-only',()=>{
 const route=readFileSync('app/api/operator/apify/readiness/route.ts','utf8');
 assert.match(route,/VERCEL_ENV!=='preview'/);
 assert.match(route,/const session=await auth\(\)/);
 assert.match(route,/operator\?\.role!=='admin'/);
 assert.match(route,/process\.env\.APIFY_API_TOKEN/);
 assert.match(route,/Cache-Control.*no-store/);
 assert.doesNotMatch(route,/agents\/launch|actors\/.*runs|run-sync|user_follow|user_unfollow/);
 assert.doesNotMatch(route,/\.create\(|\.update\(|\.delete\(/);
});
