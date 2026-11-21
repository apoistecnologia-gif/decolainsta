import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolvePinnedDynamicCollector} from '../lib/providers/phantombuster-dynamic-reference';
import {inspectPinnedCollectorProgress} from '../lib/providers/phantombuster-collector-progress';

const selectedAgent='6405192514345545';
test('pilot resolves the user-selected existing collector without looking up the old template reference', async()=>{
  let requests=0;
  const result=await resolvePinnedDynamicCollector('KEY',selectedAgent,async(url,init)=>{
    requests++;
    assert.equal(new URL(url).pathname,'/api/v2/agents/fetch');
    assert.equal(new URL(url).searchParams.get('id'),selectedAgent);
    assert.equal(init?.method,'GET');
    return Response.json({data:{
      id:selectedAgent,
      script:'Instagram Follower Collector.js',
      argument:JSON.stringify({
        spreadsheetUrl:'https://www.instagram.com/mameto_lueji/',
        sessionCookie:'SENSITIVE_IG_SESSION_FOR_OWN_ACCOUNT',
      }),
    }});
  });
  assert.deepEqual(result,{status:'ready',agentId:selectedAgent});
  assert.equal(requests,1);
  assert.doesNotMatch(JSON.stringify(result),/SENSITIVE|cookie/);
});
test('invalid or inaccessible pinned agent cannot start a collector',async()=>{
  assert.deepEqual(await resolvePinnedDynamicCollector('KEY',undefined,
    async()=>{throw Error('should never fetch');}),
    {status:'not-configured',agentId:null});
  assert.deepEqual(await resolvePinnedDynamicCollector('KEY','wrong-id',
    async()=>{throw Error('should never fetch');}),
    {status:'invalid-agent-id',agentId:null});
  const wrong=await resolvePinnedDynamicCollector('KEY',selectedAgent,async()=>Response.json({
    data:{id:selectedAgent,script:'Instagram Followers Auto Follow.js',
      argument:'{}'},
  }));
  assert.deepEqual(wrong,{status:'mismatch',agentId:null});
  const noCookie=await resolvePinnedDynamicCollector('KEY',selectedAgent,async()=>Response.json({
    data:{id:selectedAgent,script:'Instagram Follower Collector.js',
      argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/mameto_lueji/'})},
  }));
  assert.deepEqual(noCookie,{status:'missing-cookie',agentId:null});
});
test('live progress check is read-only and keyed by the same pinned collector',async()=>{
  let count=0;
  const state=await inspectPinnedCollectorProgress('KEY',selectedAgent,async(url,init)=>{
    count++;
    const u=new URL(url);
    assert.equal(u.pathname,'/api/v2/containers/fetch-all');
    assert.equal(u.searchParams.get('agentId'),selectedAgent);
    assert.equal(init?.method,'GET');
    assert.equal(init?.credentials,'omit');
    return Response.json({data:[{id:'9999999999999999',agentId:selectedAgent,
      status:'running',startedAt:'2026-11-21T12:00:00Z'}]});
  });
  assert.equal(state,'running');
  assert.equal(count,1);
});
test('dynamic endpoint prefers exact pinned collector over ambiguous reference discovery',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/PHANTOMBUSTER_DYNAMIC_COLLECTOR_AGENT_ID/);
  assert.match(route,/resolvePinnedDynamicCollector/);
  assert.match(route,/inspectPinnedCollectorProgress/);
  assert.doesNotMatch(route,/discoverFollowerCollectors\(/);
  assert.doesNotMatch(route,/inspectExistingReferenceCollector\(/);
  assert.match(route,/collectorIssue\(selected.status\)/);
  assert.match(route,/PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes'/);
});
