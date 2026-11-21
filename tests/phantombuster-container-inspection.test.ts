import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { inspectPhantomBusterContainer } from '../lib/providers/phantombuster-container-inspection';

const agentId = '1111111111111111';
const containerId = '2222222222222222';
const completed = () => new Date(Date.now()-90_000).toISOString();
const fixture = (overrides:Record<string,unknown>={}) => ({
  data: {
    id:containerId, agentId, endedAt:completed(),
    argument:JSON.stringify({
      profileUrl:'https://instagram.com/uber/',
      sessionCookie:'SECRET_IG_SESSION_DO_NOT_EXPOSE',
    }),
    ...overrides,
  },
});
const reply = (body:unknown) => new Response(JSON.stringify(body),{status:200});

test('inspects exactly one container, reports no keys or run arguments, and never authorizes release',async()=>{
  let count=0;
  const inspected=await inspectPhantomBusterContainer('SECRET_API_KEY',agentId,
    containerId,'uber',async (url,init)=>{
      count++;
      assert.equal(new URL(url).pathname,'/api/v2/containers/fetch');
      assert.equal(new URL(url).searchParams.get('id'),containerId);
      assert.equal(init?.method,'GET');
      assert.equal(init?.cache,'no-store');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.credentials,'omit');
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],
        'SECRET_API_KEY');
      return reply(fixture());
    });
  assert.equal(count,1);
  assert.equal(inspected.status,'candidate-input-match');
  assert.equal(inspected.immutableInputProven,false);
  assert.equal(inspected.releaseAuthorized,false);
  assert.equal(inspected.instagramActionsExecuted,0);
  assert.ok(inspected.completedAt);
  assert.doesNotMatch(JSON.stringify(inspected),/SECRET|sessionCookie|apiKey|profileUrl/);
});

test('wrong container, agent, reference or pending result is rejected',async()=>{
  for(const [body,expected] of [
    [fixture({id:'3333333333333333'}),'identity-mismatch'],
    [fixture({agentId:'3333333333333333'}),'identity-mismatch'],
    [fixture({endedAt:null}),'not-finalized'],
    [fixture({status:'running'}),'not-finalized'],
    [fixture({argument:JSON.stringify({profileUrl:'https://instagram.com/other/'})}),
      'reference-mismatch'],
    [fixture({argument:JSON.stringify({spreadsheetUrl:'https://example.com/profiles.csv'})}),
      'input-not-verifiable'],
    [fixture({argument:JSON.stringify({profileUrl:'https://instagram.com/uber/',
      urls:['https://instagram.com/other/']})}), 'input-not-verifiable'],
    [fixture({argument:undefined}),'input-not-verifiable'],
  ] as const) {
    const result=await inspectPhantomBusterContainer('key',agentId,containerId,'uber',
      async()=>reply(body));
    assert.equal(result.status,expected);
    assert.equal(result.releaseAuthorized,false);
  }
});

test('invalid identity, failed provider or malformed response fail closed',async()=>{
  assert.equal((await inspectPhantomBusterContainer('key','../../agent',containerId,
    'uber',async()=>{throw Error('must not fetch');})).status,'invalid-request');
  assert.equal((await inspectPhantomBusterContainer('key',agentId,containerId,
    '../uber',async()=>{throw Error('must not fetch');})).status,'invalid-request');
  for(const [status,expected] of [
    [401,'invalid-key'],[404,'not-found'],[429,'rate-limited'],[503,'unavailable'],
  ] as const){
    const actual=await inspectPhantomBusterContainer('key',agentId,containerId,
      'uber',async()=>new Response('SESSION_SECRET',{status}));
    assert.equal(actual.status,expected);
    assert.doesNotMatch(JSON.stringify(actual),/SECRET/);
  }
  assert.equal((await inspectPhantomBusterContainer('key',agentId,containerId,
    'uber',async()=>new Response('{broken',{status:200}))).status,'unexpected-response');
});

test('the container-only probe has no launch, agent settings or result-file fallback',()=>{
  const code=readFileSync('lib/providers/phantombuster-container-inspection.ts','utf8');
  assert.match(code,/containers\/fetch'/);
  assert.match(code,/configuredFollowerCollectorReference\(container\.argument\)/);
  assert.doesNotMatch(code,/agents\/fetch|agents\/save|agents\/launch|fetch-result-object|result\.json|user_follow|user_unfollow/);
  assert.match(code,/releaseAuthorized: false/);
  assert.match(code,/immutableInputProven: false/);
});
