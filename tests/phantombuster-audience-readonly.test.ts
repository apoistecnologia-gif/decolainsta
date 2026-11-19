
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

test('collector reads more than 150 KB of completed-run JSON while exposing only ten usernames', async () => {
  const largeRows = Array.from({ length: 429 }, (_, i) => ({
    username: 'largeprofile' + i,
    imageUrl: 'https://cdn.instagram.com/' + 'x'.repeat(550),
    phoneNumber: 'PRIVATE PHONE', sessionid: 'PRIVATE TOKEN',
  }));
  assert.ok(JSON.stringify({ resultObject: largeRows }).length > 150_000);
  let calls = 0;
  const value = await previewCollectorResult('test-key', '1234567890123456', [], async url => {
    calls++;
    return url.includes('/fetch-all')
      ? new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 })
      : new Response(JSON.stringify({ resultObject: largeRows }), { status: 200 });
  });
  assert.equal(calls, 2);
  assert.equal(value.status, 'found');
  assert.equal(value.resultLocation, 'completed_run');
  assert.deepEqual(value.usernames, Array.from({ length: 10 }, (_, i) => 'largeprofile' + i));
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|cdn.instagram/);
});

test('collector safely falls back to its latest result.json without exposing the API key to S3', async () => {
  const urls: string[] = [];
  const output = await previewCollectorResult('secret-api-key', '1234567890123456', ['mameto_lueji'], async (url, opts) => {
    urls.push(url);
    if (url.includes('/fetch-all'))
      return new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 });
    if (url.includes('/fetch-result-object'))
      return new Response(JSON.stringify({ resultObject: { resultFile: 'file-backed' } }), { status: 200 });
    if (url.includes('/agents/fetch')) {
      assert.equal((opts?.headers as Record<string,string>)['X-Phantombuster-Key'], 'secret-api-key');
      assert.equal(new URL(url).searchParams.get('withArgument'), 'false');
      return new Response(JSON.stringify({
        id: '1234567890123456', orgS3Folder: 'test_workspace', s3Folder: 'test_collector',
        argument: 'PRIVATE SESSION',
      }), { status: 200 });
    }
    assert.equal(url, 'https://phantombuster.s3.amazonaws.com/test_workspace/test_collector/result.json');
    assert.equal((opts?.headers as Record<string,string>)['X-Phantombuster-Key'], undefined);
    assert.equal(opts?.credentials, 'omit');
    assert.equal(opts?.redirect, 'error');
    return new Response(JSON.stringify([
      { username: 'mameto_lueji', email: 'PRIVATE MAIL' },
      { username: 'safe_follower', email: 'PRIVATE MAIL' },
    ]), { status: 200 });
  });
  assert.equal(urls.length, 4);
  assert.equal(output.status, 'found');
  assert.deepEqual(output.usernames, ['safe_follower']);
  assert.equal(output.resultLocation, 'latest_agent_file');
  assert.equal(output.referenceVerified, false);
  assert.equal(output.savedToDatabase, false);
  assert.equal(output.actionsEnabled, false);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|secret-api-key/);
});

test('collector cannot redirect fallback to arbitrary URL or path traversal', async () => {
  const urls: string[] = [];
  const output = await previewCollectorResult('test-key', '1234567890123456', [], async url => {
    urls.push(url);
    if (url.includes('/fetch-all'))
      return new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 });
    if (url.includes('/fetch-result-object'))
      return new Response(JSON.stringify({ resultObject: { unsupported: true } }), { status: 200 });
    if (url.includes('/agents/fetch'))
      return new Response(JSON.stringify({
        id: '1234567890123456', orgS3Folder: '../../evil.test', s3Folder: 'subfolder',
      }), { status: 200 });
    throw new Error('Unexpected external request');
  });
  assert.equal(output.status, 'unsupported-result');
  assert.equal(urls.length, 3);
  assert.ok(urls.every(u => u.startsWith('https://api.phantombuster.com/api/v2/')));
});

test('collector does not attempt result-file fallback after authentication failure', async () => {
  let calls = 0;
  const output = await previewCollectorResult('test-key', '1234567890123456', [], async url => {
    calls++;
    return url.includes('/fetch-all')
      ? new Response(JSON.stringify([{ id: '1111111111111111' }]), { status: 200 })
      : new Response('PRIVATE', { status: 403 });
  });
  assert.equal(calls, 2);
  assert.equal(output.status, 'invalid-key');
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE/);
});

test('full read keeps preview limited to ten and imports at most 500 validated usernames', async () => {
  const { readCollectorAudience } = await import('../lib/providers/phantombuster-audience');
  const rows = Array.from({ length: 429 }, (_, i) => ({
    username: 'follower' + i, email: 'PRIVATE@EXAMPLE.COM',
  }));
  const get = async (url: string) => url.includes('/fetch-all')
    ? new Response(JSON.stringify([{ id:'1111111111111111' }]), { status: 200 })
    : new Response(JSON.stringify({ resultObject: rows }), { status: 200 });
  const all = await readCollectorAudience('test-key','1234567890123456',['follower5'],get);
  const preview = await previewCollectorResult('test-key','1234567890123456',[],get);
  assert.equal(all.status,'found');
  assert.equal(all.usernames.length,428);
  assert.equal(all.usernames.includes('follower5'),false);
  assert.equal(preview.usernames.length,10);
  assert.doesNotMatch(JSON.stringify(all),/PRIVATE|EXAMPLE/);
  const extra = await readCollectorAudience('test-key','1234567890123456',[],async url =>
    url.includes('/fetch-all')
      ? new Response(JSON.stringify([{id:'1111111111111111'}]),{status:200})
      : new Response(JSON.stringify({resultObject:Array.from({length:600},(_,i)=>({username:'person'+i}))}),{status:200}));
  assert.equal(extra.usernames.length,500);
});

test('bulk import is explicit, scoped, idempotent, serializable and never launches collector or IG actions', () => {
  const code = readFileSync('app/api/provider/phantombuster/audience-bulk-import/route.ts','utf8');
  const ui = readFileSync('app/(app)/references/_components/reference-audience-panel.tsx','utf8');
  assert.match(code, /const session = await auth\(\)/);
  assert.match(code, /where: \{ id: input.accountId, userId \}/);
  assert.match(code, /where: \{ id: input.referenceId, instagramAccountId: account.id \}/);
  assert.match(code, /origin !== new URL\(req.url\).origin/);
  assert.match(code, /input.confirmBulkImport !== true/);
  assert.match(code, /readCollectorAudience\(/);
  assert.match(code, /names\.slice\(offset, offset \+ 10\)/);
  assert.match(code, /Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(code, /fingerprints\.has\(batch.fingerprint\)/);
  assert.match(code, /tx.activityLog.createMany\(/);
  assert.match(code, /MAX_HISTORY_BATCHES/);
  assert.doesNotMatch(code, /agents\/launch|user_follow|user_unfollow|followAction\.(create|update|delete)|instagram\.com/);
  assert.match(ui, /Importar resultado completo do coletor/);
  assert.match(ui, /confirmBulkImport: true/);
  assert.match(ui, /setApiKey\(''\)/);
});

test('completed-run timestamp is normalized for safe post-binding ingestion', async () => {
  const { readCollectorAudience, collectorRunCompletedAt } =
    await import('../lib/providers/phantombuster-audience');
  assert.equal(collectorRunCompletedAt('not-a-date'),null);
  assert.equal(collectorRunCompletedAt(100),null);
  const ended = '2026-11-19T15:00:00.000Z';
  assert.equal(collectorRunCompletedAt(Date.parse(ended)/1000),ended);
  assert.equal(collectorRunCompletedAt(String(Date.parse(ended))),ended);
  const value = await readCollectorAudience('test-key','1234567890123456',[],
    async url => url.includes('/fetch-all')
      ? new Response(JSON.stringify([{id:'1111111111111111',
        endedAt:Date.parse(ended)/1000}]), {status:200})
      : new Response(JSON.stringify({resultObject:[{username:'sample.follower'}]}),
        {status:200}));
  assert.equal(value.status,'found');
  assert.equal(value.resultLocation,'completed_run');
  assert.equal(value.completedAt,ended);
  assert.equal(value.referenceVerified,false);
  const unknown = await readCollectorAudience('test-key','1234567890123456',[],
    async url => url.includes('/fetch-all')
      ? new Response(JSON.stringify([{id:'1111111111111111'}]), {status:200})
      : new Response(JSON.stringify({resultObject:[{username:'sample.follower'}]}),
        {status:200}));
  assert.equal(unknown.status,'found');
  assert.equal(unknown.completedAt,undefined);
});
