import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  configuredFollowerCollectorReference, discoverFollowerCollectors,
  matchUniqueCollectorForReference, parseSingleInstagramReference,
  verifyConfiguredFollowerCollector,
} from '../lib/providers/phantombuster-collector-discovery';
import { planExactReadOnlyCollectorBindings } from '../lib/reference-audience-auto-binding';

const agent = (id: string, username: string, script = 'Instagram Follower Collector.js') => ({
  id, script, name: 'Anything (editable)', argument: JSON.stringify({
    profileUrl: 'https://www.instagram.com/' + username + '/',
    sessionCookie: 'SECRET-SESSION-COOKIE',
  }),
});

test('extract only unique explicit Instagram target, never login or spreadsheet values', () => {
  assert.equal(parseSingleInstagramReference('@foo.bar'),'foo.bar');
  assert.equal(parseSingleInstagramReference('https://www.instagram.com/Foo.Bar/'),'foo.bar');
  assert.equal(parseSingleInstagramReference('https://instagram.com/foo.bar/?x=1'),null);
  assert.equal(parseSingleInstagramReference('https://evil.example/foo.bar'),null);
  assert.equal(parseSingleInstagramReference('https://instagram.com/foo.bar/followers/'),null);
  assert.equal(configuredFollowerCollectorReference({profileUrl:'@fo.o'}),'fo.o');
  assert.equal(configuredFollowerCollectorReference({
    spreadsheetUrl:'https://www.instagram.com/mameto_lueji/',
    sessionCookie:'SENSITIVE_DO_NOT_OUTPUT',
  }),'mameto_lueji');
  assert.equal(configuredFollowerCollectorReference({
    spreadsheetUrl:'https://docs.google.com/spreadsheets/d/test-id/edit',
  }),null);
  assert.equal(configuredFollowerCollectorReference({
    spreadsheetUrl:'https://example.com/results.csv',
  }),null);
  assert.equal(configuredFollowerCollectorReference({
    profileUrl:'@one',spreadsheetUrl:'https://www.instagram.com/two/',
  }),null);
  assert.equal(configuredFollowerCollectorReference({
    profileUrl:'@one',spreadsheetUrl:'https://www.instagram.com/one/',
  }),'one');
  assert.equal(configuredFollowerCollectorReference({
    spreadsheetUrl:'https://www.instagram.com/one/?source=test',
  }),null);
  assert.equal(configuredFollowerCollectorReference({
    spreadsheetUrl:'https://www.instagram.com/one/followers/',
  }),null);

  assert.equal(configuredFollowerCollectorReference({profileUrl:'@foo',targetUsername:'@bar'}),null);
  assert.equal(configuredFollowerCollectorReference({
    profileUrl:'@foo',spreadsheetUrl:'https://example.com/list.csv'}),null);
  assert.equal(configuredFollowerCollectorReference({
    profileUrl: ['@foo'],sessionCookie:'SECRET'}),null);
  assert.equal(configuredFollowerCollectorReference({sessionCookie:'SECRET'}),null);
  assert.equal(configuredFollowerCollectorReference('not-json'),null);
});

test('discover via documented agent inventory then inspect exact agent details', async () => {
  const seen: string[] = [];
  const items = [
    agent('1111111111111111','reference_a'),
    agent('2222222222222222','reference_b'),
    agent('3333333333333333','reference_a','Instagram Followers Auto Follow.js'),
    {id:'4444444444444444',script:'Instagram Follower Collector.js',
      argument:JSON.stringify({sessionCookie:'SECRET'})},
  ];
  const result = await discoverFollowerCollectors('valid-server-key', async (url, init) => {
    seen.push(url);
    assert.equal(init?.method,'GET');
    assert.equal(init?.redirect,'error');
    assert.equal(init?.credentials,'omit');
    assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],
      'valid-server-key');
    if (url.includes('fetch-all')) {
      assert.equal(new URL(url).searchParams.get('withArgument'),'true');
      // The actual inventory may OMIT argument.
      return new Response(JSON.stringify(items.map(({id,script})=>({id,script}))),
        {status:200});
    }
    const id = new URL(url).searchParams.get('id');
    const item = items.find(x=>x.id===id);
    return new Response(JSON.stringify(item),{status:200});
  });
  assert.equal(seen.length,4); // one inventory, 3 detail reads
  assert.equal(result.status,'ok');
  assert.equal(result.agentsExamined,4);
  assert.deepEqual(result.collectors,[
    {collectorAgentId:'1111111111111111',referenceUsername:'reference_a'},
    {collectorAgentId:'2222222222222222',referenceUsername:'reference_b'},
  ]);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|sessionCookie|profileUrl|valid-server-key/);
});

test('previously configured single-URL follower collector can be discovered without new launch',async () => {
  let calls = 0;
  const scan = await discoverFollowerCollectors('server-key',async url => {
    calls++;
    assert.match(url,/agents\/fetch-all/);
    return new Response(JSON.stringify({
      data: [{
        id:'6396548176148717', script:'Instagram Follower Collector.js',
        argument:JSON.stringify({
          spreadsheetUrl:'https://www.instagram.com/mameto_lueji/',
          sessionCookie:'PRIVATE_IG_SESSION',
        }),
      }],
    }),{status:200});
  });
  assert.equal(calls,1);
  assert.equal(scan.status,'ok');
  assert.deepEqual(scan.collectors,[{
    collectorAgentId:'6396548176148717',
    referenceUsername:'mameto_lueji',
  }]);
  assert.equal(matchUniqueCollectorForReference(scan.collectors,'mameto_lueji'),
    '6396548176148717');
  assert.doesNotMatch(JSON.stringify(scan),/PRIVATE_IG_SESSION|sessionCookie|spreadsheetUrl/);
});

test('documented inventory with argument returns matching collectors in one provider call',async () => {
  let calls = 0;
  const result = await discoverFollowerCollectors('server-key',async (url) => {
    calls++;
    assert.match(url,/fetch-all/);
    assert.equal(new URL(url).searchParams.get('withArgument'),'true');
    return new Response(JSON.stringify([
      agent('1111111111111111','reference_a'),
      agent('2222222222222222','reference_b'),
    ]),{status:200});
  });
  assert.equal(calls,1);
  assert.equal(result.status,'ok');
  assert.equal(result.collectors.length,2);
  assert.doesNotMatch(JSON.stringify(result),/SECRET-SESSION-COOKIE|server-key/);
});

test('a failed detail read cannot silently return incomplete matches',async () => {
  let call = 0;
  const result = await discoverFollowerCollectors('key',async (url) => {
    call++;
    return url.includes('fetch-all')
      ? new Response(JSON.stringify([
          {id:'1111111111111111',script:'Instagram Follower Collector.js'},
          {id:'2222222222222222',script:'Instagram Follower Collector.js'},
        ]),{status:200})
      : new Response('Too many requests',{status:429});
  });
  assert.equal(call,2);
  assert.equal(result.status,'rate-limited');
  assert.deepEqual(result.collectors,[]);
});

test('ambiguous agents cannot be assigned to any reference', () => {
  const candidates = [
    {collectorAgentId:'1111111111111111',referenceUsername:'reference_a'},
    {collectorAgentId:'2222222222222222',referenceUsername:'reference_a'},
  ];
  assert.equal(matchUniqueCollectorForReference(candidates,'@reference_a'),null);
  assert.equal(matchUniqueCollectorForReference(candidates,'@reference_b'),null);
});

test('client isolation prevents reusing an agent already bound to another account', () => {
  const discovered = [
    {collectorAgentId:'1111111111111111',referenceUsername:'reference_a'},
    {collectorAgentId:'2222222222222222',referenceUsername:'reference_b'},
  ];
  const refs = [
    {id:'r1',username:'reference_a',accountId:'account_a'},
    {id:'r2',username:'reference_b',accountId:'account_a'},
  ];
  const cross = [{accountId:'account_b',referenceId:'other',
    collectorAgentId:'1111111111111111'}];
  const plan = planExactReadOnlyCollectorBindings(refs,discovered,cross);
  assert.deepEqual(plan.candidates,[{
    accountId:'account_a',referenceId:'r2',collectorAgentId:'2222222222222222',
  }]);
  assert.equal(plan.ambiguousOrInUse,1);
  assert.equal(plan.alreadyBound,0);
  assert.equal(plan.unmatched,0);
  assert.deepEqual(planExactReadOnlyCollectorBindings(refs,discovered,[],1).candidates,
    [{accountId:'account_a',referenceId:'r1',collectorAgentId:'1111111111111111'}]);
});

test('revalidate target and script before reading completed collector output', async () => {
  let count=0;
  const valid = await verifyConfiguredFollowerCollector('key','1111111111111111','reference_a',
    async (url, init) => {
      count++;
      assert.equal(new URL(url).searchParams.get('id'),'1111111111111111');
      assert.equal(init?.method,'GET');
      return new Response(JSON.stringify(agent('1111111111111111','reference_a')),{status:200});
    });
  assert.equal(count,1);
  assert.equal(valid,'matched');
  const wrong = await verifyConfiguredFollowerCollector('key','1111111111111111','reference_b',
    async () => new Response(JSON.stringify(agent('1111111111111111','reference_a'))));
  assert.equal(wrong,'mismatch');
  const mutate = await verifyConfiguredFollowerCollector('key','1111111111111111','reference_a',
    async () => new Response(JSON.stringify(agent('1111111111111111','reference_a',
      'Instagram Followers Auto Follow.js'))));
  assert.equal(mutate,'mismatch');
  const unavailable = await verifyConfiguredFollowerCollector('key','1111111111111111',
    'reference_a',async () => new Response('SECRET ERROR',{status:429}));
  assert.equal(unavailable,'unavailable');
  assert.equal(await verifyConfiguredFollowerCollector('key','../launch','reference_a',
    async () => {throw Error('should not be called');}),'unavailable');
});

test('inventory limits responses and never trusts a partially truncated agent list',async () => {
  const many = Array.from({length:201},(_,i)=>agent(
    String(1000000000000000+i),'reference_'+i));
  const result = await discoverFollowerCollectors('key',async () =>
    new Response(JSON.stringify({data:many}),{status:200}));
  assert.equal(result.status,'too-many-agents');
  assert.deepEqual(result.collectors,[]);
  assert.equal((await discoverFollowerCollectors('key',async () =>
    new Response('SECRET ERROR',{status:401}))).status,'invalid-key');
});
