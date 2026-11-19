
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { previewCollectorResult } from '../lib/providers/phantombuster-audience';

test('collector preview reads existing finalized run only, returns 10 allowlisted distinct usernames', async () => {
  const seen: string[] = [];
  const value = await previewCollectorResult('work-api-key', '1234567890123456', ['contateste6699', 'source'], async (url, opts) => {
    seen.push(url);
    assert.equal(opts?.method, 'GET');
    assert.equal(opts?.redirect, 'error');
    assert.equal((opts?.headers as Record<string,string>)['X-Phantombuster-Key'], 'work-api-key');
    if (url.includes('/fetch-all')) {
      return new Response(JSON.stringify([{ id: '123123123123123' }]), { status: 200 });
    }
    return new Response(JSON.stringify({ resultObject: [
      { username: 'source', email: 'SECRET@EXAMPLE.COM' },
      { username: 'contateste6699', token: 'SECRET' },
      ...Array.from({length: 20}, (_, i) => ({ username: 'sample'+i, profileUrl: 'https://instagram.com/sample'+i, mailFound: 'SECRET' })),
      { username: 'sample0' },
    ] }), { status: 200 });
  });
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[0]).searchParams.get('mode'), 'finalized');
  assert.equal(new URL(seen[0]).searchParams.get('limit'), '3');
  assert.equal(new URL(seen[1]).searchParams.get('id'), '123123123123123');
  assert.deepEqual(value.usernames, Array.from({length:10},(_,i)=>'sample'+i));
  assert.equal(value.status, 'found');
  assert.equal(value.savedToDatabase, false);
  assert.equal(value.referenceVerified, false);
  assert.equal(value.actionsEnabled, false);
  assert.doesNotMatch(JSON.stringify(value), /SECRET|EXAMPLE|token|mailFound/);
});

test('collector preview rejects malformed agent, filters malicious URLs, handles rate limits and empty results', async () => {
  let calls = 0;
  const bad = await previewCollectorResult('key', '../../../launch', [], async () => { calls++; throw Error('no'); });
  assert.equal(bad.status, 'unsupported-result');
  assert.equal(calls, 0);
  const limited = await previewCollectorResult('key', '12345678901234', [], async () =>
    new Response('secret error', { status: 429 }));
  assert.equal(limited.status, 'rate-limited');
  assert.doesNotMatch(JSON.stringify(limited), /secret error/);
  const none = await previewCollectorResult('key', '12345678901234', [], async () =>
    new Response(JSON.stringify([]), { status: 200 }));
  assert.equal(none.status, 'no-run');
  const malicious = await previewCollectorResult('key', '12345678901234', [], async (url) =>
    url.includes('/fetch-all') ?
      new Response(JSON.stringify([{id:'12345678901234'}]), {status:200}) :
      new Response(JSON.stringify({resultObject:[{profileUrl:'https://evil.test/owner'}, {username:'@safe.user'}, {profileUrl:'https://www.instagram.com/other/'}, {username:'invalid entry!'}]}), {status:200}));
  assert.deepEqual(malicious.usernames,['safe.user','other']);
});

test('collector route authenticates, checks account ownership and references, performs no mutation', () => {
  const route = readFileSync('app/api/provider/phantombuster/audience-preview/route.ts','utf8');
  assert.match(route,/const session = await auth\(\)/);
  assert.match(route,/where: \{ id: p.accountId, userId \}/);
  assert.match(route,/where: \{ id: p.referenceId, instagramAccountId: account.id \}/);
  assert.match(route,/PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(route,/origin !== new URL\(req.url\).origin/);
  assert.match(route,/previewCollectorResult/);
  assert.doesNotMatch(route,/agents\/launch|prisma\.[a-zA-Z]+\.(create|update|upsert|delete)|user_follow|user_unfollow/);
});

test('references page adds explicitly labeled read-only audience preview', () => {
  const main = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  const component = readFileSync('app/(app)/references/_components/reference-audience-panel.tsx', 'utf8');
  assert.match(main, /ReferenceAudiencePanel/);
  assert.match(component, /Ler resultados anteriores \(sem executar coletor\)/);
  assert.match(component, /setApiKey\(''\)/);
  assert.match(component, /no máximo 10 nomes/);
  assert.match(component, /onClick=\{\(\) => void check\(\)\}/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|agents\/launch|user_follow|user_unfollow/);
});

test('collector selects newest valid finalized run even when provider order differs', async () => {
  const accessed: string[] = [];
  const value = await previewCollectorResult('test-key', '1234567890123456', [], async url => {
    accessed.push(url);
    if (url.includes('/fetch-all')) {
      return new Response(JSON.stringify([
        { id: '1111111111111111', endedAt: 100 },
        { id: 'invalid-container-id', endedAt: 99999 },
        { id: '2222222222222222', endedAt: 200 },
      ]), { status: 200 });
    }
    return new Response(JSON.stringify({
      resultObject: JSON.stringify([{ username: 'newest.follower', email: 'PRIVATE@EXAMPLE.COM' }]),
    }), { status: 200 });
  });
  assert.equal(accessed.length, 2);
  assert.equal(new URL(accessed[1]).searchParams.get('id'), '2222222222222222');
  assert.equal(value.status, 'found');
  assert.deepEqual(value.usernames, ['newest.follower']);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|EXAMPLE/);
});

test('collector distinguishes valid empty runs from malformed provider responses', async () => {
  for (const empty of [null, 'null', '']) {
    const value = await previewCollectorResult('key', '1234567890123456', [], async url =>
      url.includes('/fetch-all')
        ? new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 })
        : new Response(JSON.stringify({ resultObject: empty, apiKey: 'PRIVATE' }), { status: 200 }));
    assert.equal(value.status, 'no-results');
    assert.deepEqual(value.usernames, []);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE/);
  }
  const malformed = await previewCollectorResult('key', '1234567890123456', [], async url =>
    url.includes('/fetch-all')
      ? new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 })
      : new Response(JSON.stringify({ error: 'PRIVATE' }), { status: 200 }));
  assert.equal(malformed.status, 'unsupported-result');
  assert.doesNotMatch(JSON.stringify(malformed), /PRIVATE/);
});
