import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyFollowerCollectorTemplate } from '../lib/providers/phantombuster-collector-identity';

const ID = '1234567890123456';

test('only the actual Instagram Follower Collector script can be bound', async () => {
  const requests: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],'some-key');
    return new Response(JSON.stringify({
      id: ID, name: 'Custom user-editable label',
      script: 'Instagram Follower Collector.js',
      argument: 'SECRET SESSION COOKIE',
    }), { status: 200 });
  };
  const status = await verifyFollowerCollectorTemplate('some-key',ID,fetcher);
  assert.equal(status,'verified-template');
  assert.equal(requests.length,1);
  assert.match(requests[0],/\/agents\/fetch\?/);
  assert.equal(new URL(requests[0]).searchParams.get('withArgument'),'false');
  assert.doesNotMatch(JSON.stringify(status),/SECRET/);
});

test('Auto Follow and unknown templates are never classified as Follower Collector', async () => {
  const run = async (script: string) => verifyFollowerCollectorTemplate('key',ID,async () =>
    new Response(JSON.stringify({id:ID,script}), {status:200}));
  assert.equal(await run('Instagram Followers Auto Follow.js'),'different-template');
  assert.equal(await run('Instagram Profile Scraper.js'),'different-template');
  assert.equal(await run('Instagram Follower Collector.js'),'verified-template');
});

test('malformed response, wrong agent, invalid id and authentication failure fail closed', async () => {
  const wrong = await verifyFollowerCollectorTemplate('key',ID,async () =>
    new Response(JSON.stringify({id:'9999999999999999',script:'Instagram Follower Collector.js'})));
  assert.equal(wrong,'not-found');
  let count = 0;
  assert.equal(await verifyFollowerCollectorTemplate('key','../unknown',async () => {
    count++; throw Error('should not call'); }), 'unavailable');
  assert.equal(count,0);
  assert.equal(await verifyFollowerCollectorTemplate('key',ID,async () =>
    new Response('PRIVATE', {status:403})), 'invalid-key');
  assert.equal(await verifyFollowerCollectorTemplate('key',ID,async () =>
    new Response('not-json', {status:200})), 'unavailable');
});
