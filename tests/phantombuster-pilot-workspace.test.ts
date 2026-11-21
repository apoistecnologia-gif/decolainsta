import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  pickPilotCollectorFromInventory,resolvePilotCollectorInWorkspace,
} from '../lib/providers/phantombuster-pilot-workspace';

const id='1111111111111111';
const other='2222222222222222';
const name='Untitled Instagram Follower Collector (2)';
const collector=(agentId=id, options:Record<string,unknown>={})=>({
  id:agentId, name, script:'Instagram Follower Collector.js',
  argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/mameto_lueji/',
    sessionCookie:'SECRET_DO_NOT_EXPOSE'}),
  ...options,
});
const response=(v:unknown)=>Response.json({data:v});
test('autodiscovers exact collector name from the workspace and verifies its arguments',async()=>{
  const requests:string[]=[];
  const result=await resolvePilotCollectorInWorkspace('SECRET_API','mameto_lueji',name,
    async(url,init)=>{
      requests.push(url);
      assert.equal(init?.method,'GET');
      assert.equal(init?.credentials,'omit');
      assert.equal(init?.cache,'no-store');
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],'SECRET_API');
      if(url.includes('/agents/fetch-all'))return response([
        collector(other,{name:'Unrelated Follower Collector',
          argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/uber/'})}),
        collector(),
      ]);
      if(url.includes('/agents/fetch'))return response(collector());
      throw Error('Unexpected endpoint');
    });
  assert.deepEqual(result,{status:'ready',agentId:id});
  assert.equal(requests.length,2);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|sessionCookie/);
});
test('ambiguity and mismatched workspace do not choose a random agent',()=>{
  const sameNamed=[collector(),collector(other)];
  assert.deepEqual(pickPilotCollectorFromInventory({data:sameNamed},'mameto_lueji',name),
    {status:'ambiguous',id:null});
  assert.deepEqual(pickPilotCollectorFromInventory({data:[
    collector(id,{name:'Other Collector',
      argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/uber/'})}),
  ]},'mameto_lueji',name),{status:'not-found',id:null});
  assert.deepEqual(pickPilotCollectorFromInventory({data:[]},'mameto_lueji',name),
    {status:'not-found',id:null});
  assert.deepEqual(pickPilotCollectorFromInventory({data:{}},'mameto_lueji',name),
    {status:'invalid',id:null});
});
test('a misleading name cannot select a follow agent, and unknown args require verification',async()=>{
  const wrongScript=pickPilotCollectorFromInventory({data:[collector(id,{
    script:'Instagram Followers Auto Follow.js',
  })]},'mameto_lueji',name);
  assert.equal(wrongScript.status,'not-found');
  const result=await resolvePilotCollectorInWorkspace('key','mameto_lueji',name,
    async(url)=>{
      if(url.includes('fetch-all'))return response([{
        id,name,script:'Instagram Follower Collector.js',
        // Some provider listings omit arguments, require exact agent verification.
      }]);
      return response(collector(id,{
        argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/uber/',
          sessionCookie:'SECRET'}),
      }));
    });
  assert.deepEqual(result,{status:'mismatch',agentId:null});
});
test('specific errors for rejected API key, rate limiting and different workspace',async()=>{
  const cases=[
    [401,'invalid-key'],[403,'invalid-key'],
    [429,'rate-limited'],[503,'unavailable'],
  ] as const;
  for(const [code,wanted] of cases){
    const got=await resolvePilotCollectorInWorkspace('key','mameto_lueji',name,
      async()=>new Response(null,{status:code}));
    assert.deepEqual(got,{status:wanted,agentId:null});
  }
  const missing=await resolvePilotCollectorInWorkspace('key','mameto_lueji',name,
    async()=>response([{
      id:other,name:'Another unrelated agent',
      script:'Instagram Follower Collector.js',
      argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/uber/'}),
    }]));
  assert.deepEqual(missing,{status:'workspace-mismatch',agentId:null});
});
test('never activates an agent without valid saved Instagram cookie',async()=>{
  const noCookie=await resolvePilotCollectorInWorkspace('key','mameto_lueji',name,
    async(url)=>{
      if(url.includes('fetch-all'))return response([collector(id,{argument:undefined})]);
      return response(collector(id,{
        argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/mameto_lueji/'}),
      }));
    });
  assert.deepEqual(noCookie,{status:'missing-cookie',agentId:null});
});
test('route has operator and preview gate and does not trust an invented agent ID',()=>{
  const code=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(code,/VERCEL_ENV!=='preview'/);
  assert.match(code,/user\?\.role!=='admin'/);
  assert.match(code,/resolvePilotCollectorInWorkspace/);
  assert.match(code,/workspace-mismatch/);
  assert.doesNotMatch(code,/PHANTOMBUSTER_DYNAMIC_COLLECTOR_AGENT_ID/);
  assert.doesNotMatch(code,/agents\/save|user_follow|user_unfollow/);
});
