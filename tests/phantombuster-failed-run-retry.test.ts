import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  inspectFailedRetryPreflight,inspectUnverifiedRecoveryPreflight,
} from '../lib/providers/phantombuster-failed-run-retry';

const id='1111111111111111',container='2222222222222222';
test('only exact latest finalized failed container is safe to retry',async()=>{
  let calls=0;
  const result=await inspectFailedRetryPreflight('key',id,container,async(url,init)=>{
    calls++;
    assert.equal(new URL(url).pathname,'/api/v2/containers/fetch-all');
    assert.equal(new URL(url).searchParams.get('agentId'),id);
    assert.equal(init?.method,'GET');
    return Response.json({containers:[{id:container,agentId:id,status:'failed'},
      {id:'1111111111111112',agentId:id,status:'completed'}]});
  });
  assert.equal(result,'ready');
  assert.equal(calls,1);
});
test('active or newer other container prevents repeat',async()=>{
  const run=async(rows:unknown)=>inspectFailedRetryPreflight('key',id,container,
    async()=>Response.json({containers:rows}));
  assert.equal(await run([{id:'3333333333333333',status:'running'},
    {id:container,status:'failed'}]),'active');
  assert.equal(await run([{id:'3333333333333333',status:'failed'},
    {id:container,status:'failed'}]),'other-run');
  assert.equal(await run([{id:container,status:'completed'}]),'unavailable');
  assert.equal(await run([{id:container,status:'finalized',exitCode:1}]),'ready');
  assert.equal(await run([{id:container,status:'finished',exitCode:'1'}]),'ready');
  assert.equal(await run([{id:container,status:'finalized',exitCode:0}]),'unavailable');
  assert.equal(await run([{id:container,status:'failed',agentId:'9999999999999999'}]),
    'unavailable');
  assert.equal(await run([]),'unavailable');
});
test('provider response errors do not authorize retry',async()=>{
  assert.equal(await inspectFailedRetryPreflight('key',id,container,
    async()=>new Response(null,{status:429})),'unavailable');
  assert.equal(await inspectFailedRetryPreflight('key',id,container,
    async()=>{throw Error('failed');}),'unavailable');
  assert.equal(await inspectFailedRetryPreflight('key','bad',container,
    async()=>{throw Error('not reachable');}),'unavailable');
});

test('top-level container arrays are accepted without loosening the last-run check',async()=>{
  const result=await inspectFailedRetryPreflight('key',id,container,
    async()=>Response.json([{id:container,agentId:id,status:'failed'}]));
  assert.equal(result,'ready');
});

test('unverified recovery requires exact latest completed container, not a failed or active run',async()=>{
  const run=async(rows:unknown)=>inspectUnverifiedRecoveryPreflight('key',id,container,
    async()=>Response.json({containers:rows}));
  assert.equal(await run([{id:container,status:'finished',exitCode:0}]),'ready');
  assert.equal(await run([{id:container,status:'completed'}]),'ready');
  assert.equal(await run([{id:container,status:'failed'}]),'unavailable');
  assert.equal(await run([{id:container,status:'finished',exitCode:1}]),'unavailable');
  assert.equal(await run([{id:'3333333333333333',status:'finished'},
    {id:container,status:'finished'}]),'other-run');
  assert.equal(await run([{id:container,status:'running'}]),'active');
  assert.equal(await run([{id:container,status:'finished',agentId:'9999999999999999'}]),
    'unavailable');
  assert.equal(await run([]),'unavailable');
});
