import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  FOLLOWERS_TRIAL_ACTION,makeTrialEvidence,parseTrialEvidence,
} from '../lib/reference-followers-trial';
import {
  launchFollowersTrial,inspectTrialContainer,parseTrialContainer,
  parseAgentScopedContainer,
} from '../lib/providers/phantombuster-followers-trial';
const agent='1838046655144130',container='1234567890123';
test('one-shot launch sends only one controlled launch and never returns follower identities',async()=>{
  let n=0;
  const result=await launchFollowersTrial('sensitive-api-key',agent,async(url,options)=>{
    n++;
    assert.equal(url,'https://api.phantombuster.com/api/v2/agents/launch');
    assert.equal(options?.method,'POST');
    assert.equal(options?.redirect,'error');
    assert.equal(options?.credentials,'omit');
    assert.deepEqual(JSON.parse(String(options?.body)),
      {id:agent,manualLaunch:true,maxInstanceCount:1});
    return new Response(JSON.stringify({data:{containerId:container,
      cookie:'PRIVATE'}}),{status:200});
  });
  assert.deepEqual(result,{status:'accepted',containerId:container});
  assert.equal(n,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|sensitive-api-key/);
});
test('ambiguous and rate-limited launch results cannot retry',async()=>{
  let n=0;
  const result=await launchFollowersTrial('key',agent,async()=>{
    n++;throw Error('SESSION_COOKIE_SHOULD_NOT_LEAK');
  });
  assert.equal(n,1);assert.deepEqual(result,{status:'uncertain'});
  const limited=await launchFollowersTrial('key',agent,
    async()=>new Response('hidden',{status:429}));
  assert.equal(limited.status,'rate-limited');
});
test('container completion never becomes proof of a follow',async()=>{
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:0,
  }},agent,container),'finished');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:1,
  }},agent,container),'failed');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:null,
  }},agent,container),'in-progress');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:'11111111111111',exitCode:0,
  }},agent,container),'mismatch');
  let n=0;
  const outcome=await inspectTrialContainer('key',agent,container,async(url,options)=>{
    n++;
    assert.ok(url.includes('containers/fetch?'));
    assert.equal(options?.method,'GET');
    return new Response(JSON.stringify({id:container,agentId:agent,exitCode:0,
      result:{sessionCookie:'DO_NOT_LEAK'}}),{status:200});
  });
  assert.equal(n,1);assert.equal(outcome,'finished');
});
test('missing agentId in container detail does not mean wrong agent',()=>{
  assert.equal(parseTrialContainer({data:{
    id:container,exitCode:0,
  }},agent,container),'membership-unverified');
  assert.equal(parseTrialContainer({data:{
    containerId:container,exitCode:0,
  }},agent,container),'membership-unverified');
  assert.equal(parseAgentScopedContainer({data:[
    {id:container,exitCode:0},
    {id:'9876543219876',exitCode:1},
  ]},agent,container,{data:{id:container,exitCode:0}}),'finished');
  assert.equal(parseAgentScopedContainer({data:[
    {id:'9876543219876',exitCode:0},
  ]},agent,container,{data:{id:container,exitCode:0}}),
  'membership-unverified');
  assert.equal(parseAgentScopedContainer({data:[
    {id:container,agentId:'9876543219876',exitCode:0},
  ]},agent,container,{data:{id:container,exitCode:0}}),'mismatch');
});

test('uses only read-only agent-scoped history if detail has no agentId',async()=>{
  const urls:string[]=[];
  const outcome=await inspectTrialContainer('key',agent,container,async(url,options)=>{
    urls.push(url);
    assert.equal(options?.method,'GET');
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    if(url.includes('/containers/fetch?'))
      return new Response(JSON.stringify({data:{id:container,exitCode:0,
        sessionCookie:'SECRET_NEVER_OUTPUT'}}),{status:200});
    const u=new URL(url);
    assert.equal(u.pathname,'/api/v2/containers/fetch-all');
    assert.equal(u.searchParams.get('agentId'),agent);
    assert.equal(u.searchParams.get('mode'),'all');
    return new Response(JSON.stringify({data:[{id:container}]}),{status:200});
  });
  assert.deepEqual(urls.length,2);
  assert.equal(outcome,'finished');
  assert.doesNotMatch(outcome,/SECRET_NEVER_OUTPUT/);
});
test('fails closed on wrong membership or unavailable history',async()=>{
  const cases=[
    {data:[{id:'9999999999999'}]}, {data:[{id:container,agentId:'9999999999999'}]},
    {data:[{id:container},{id:container}]}, {data:{unsupported:1}},
  ];
  for(const payload of cases){
    const r=await inspectTrialContainer('key',agent,container,async url=>
      new Response(JSON.stringify(url.includes('/fetch?')
        ? {data:{id:container,exitCode:0}} : payload),{status:200}));
    assert.ok(r==='membership-unverified'||r==='mismatch');
    assert.notEqual(r,'finished');
  }
  let n=0;
  const unavailable=await inspectTrialContainer('key',agent,container,async url=>{
    n++;
    return new Response(url.includes('/fetch?')
      ? JSON.stringify({id:container,exitCode:0}) : 'private provider error',
      {status:url.includes('/fetch?')?200:503});
  });
  assert.equal(unavailable,'membership-unverified');
  assert.equal(n,2);
});
test('audit record never fabricates target username or follow success',()=>{
  assert.equal(FOLLOWERS_TRIAL_ACTION,'reference_followers_trial_v1');
  const evidence=makeTrialEvidence({
    version:1,referenceId:'refA',agentId:agent,stage:'reserved',
    followConfirmed:false,sessionOwnerVerifiedByProvider:false,recipientKnown:false,
  });
  assert.ok(evidence);
  assert.deepEqual(parseTrialEvidence(JSON.stringify(evidence)),evidence);
  assert.equal(parseTrialEvidence(JSON.stringify({...evidence,followConfirmed:true})),null);
  assert.equal(parseTrialEvidence('sessioncookie'),null);
});
test('route is admin Preview only, idempotent and separate from read-only cron',()=>{
  const route=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  for(const token of [
    "process.env.VERCEL_ENV!=='preview'",
    "PHANTOMBUSTER_FOLLOWERS_ONE_SHOT_ENABLED",
    "FOLLOWERS_TRIAL_APPROVAL",
    "req.headers.get('origin')",
    "user?.role!=='admin'",
    "userId:uid",
    "instagramAccountId:account.id",
    "tx.activityLog.count(",
    "pg_advisory_xact_lock",
    "Prisma.TransactionIsolationLevel.Serializable",
    "stage:'reserved'",
    "followConfirmed:false",
    "unfollowScheduled:false",
  ])assert.ok(route.includes(token),token);
  assert.doesNotMatch(route,/user_unfollow|agents\/save|sessionCookie/);
  assert.match(route,/launchFollowersTrial/);
  assert.match(route,/inspectTrialContainer/);
});
