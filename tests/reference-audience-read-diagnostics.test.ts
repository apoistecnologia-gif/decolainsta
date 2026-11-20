import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  lastReadStatusFromDetails, presentCollectorReadHealth,
} from '../lib/reference-audience-last-read';
import {
  inspectConfiguredFollowerCollector,
  verifyConfiguredFollowerCollector,
} from '../lib/providers/phantombuster-collector-discovery';

const agentId = '6396548176148717';
const allowed = (status: string) => JSON.stringify({
  version: 1, status, newNames: 0, indexed: 0,
});

test('sanitize status codes from account-scoped log; never return raw API errors', () => {
  assert.equal(lastReadStatusFromDetails(allowed('source-unavailable')),'source-unavailable');
  assert.equal(lastReadStatusFromDetails(allowed('historical-only')),'historical-only');
  assert.equal(lastReadStatusFromDetails(allowed('imported')),'imported');
  assert.equal(lastReadStatusFromDetails(allowed('unhandled PRIVATE_SESSION')),'other');
  assert.equal(lastReadStatusFromDetails('NOT JSON'),null);
  assert.equal(lastReadStatusFromDetails(JSON.stringify({version:2,status:'imported'})),null);
  assert.equal(presentCollectorReadHealth('source-unavailable','unavailable'),'provider-error');
  assert.equal(presentCollectorReadHealth('historical-only','matched'),'historical-only');
  assert.equal(presentCollectorReadHealth('imported','matched'),'ready');
  assert.equal(presentCollectorReadHealth('source-unavailable','matched'),'last-attempt-failed');
});

test('authenticated collector metadata read identifies exact reference without any Instagram action', async () => {
  let calls=0;
  const fetcher = async (url: string, opts?: RequestInit) => {
    calls++;
    assert.equal(new URL(url).searchParams.get('id'),agentId);
    assert.equal(opts?.method,'GET');
    assert.equal(opts?.redirect,'error');
    assert.equal(opts?.credentials,'omit');
    assert.equal((opts?.headers as Record<string,string>)['X-Phantombuster-Key'],'test-key');
    return new Response(JSON.stringify({
      id:agentId, script:'Instagram Follower Collector.js',
      argument:JSON.stringify({
        spreadsheetUrl:'https://www.instagram.com/example_ref/',
        sessionCookie:'PRIVATE_SESSION',
      }),
    }));
  };
  const matched = await inspectConfiguredFollowerCollector('test-key',agentId,'example_ref',fetcher);
  assert.equal(matched,'matched');
  assert.equal(calls,1);
  assert.doesNotMatch(JSON.stringify(matched),/PRIVATE_SESSION|test-key/);
  assert.equal(await verifyConfiguredFollowerCollector('test-key',agentId,'different',fetcher),
    'mismatch');
});

test('provider-specific failure codes are distinct and do not leak response bodies', async () => {
  for (const [status,result] of [
    [401,'invalid-key'],[403,'invalid-key'],[404,'not-found'],
    [429,'rate-limited'],[502,'unavailable'],
  ] as const) {
    let called=0;
    const output = await inspectConfiguredFollowerCollector('key',agentId,'reference',async () => {
      called++;
      return new Response('COOKIE_PRIVATE',{status});
    });
    assert.equal(called,1);
    assert.equal(output,result);
    assert.doesNotMatch(JSON.stringify(output),/COOKIE_PRIVATE/);
  }
  assert.equal(await inspectConfiguredFollowerCollector('key','../unsafe','reference',
    async () => { throw Error('should not call'); }),'unavailable');
});

test('customer connection check is scoped to owned Instagram account and bound references', () => {
  const route = readFileSync('app/api/provider/phantombuster/connection-status/route.ts','utf8');
  assert.match(route,/where: \{ id: accountId, userId \}/);
  assert.match(route,/loadActiveAudienceSources\(account\.id\)/);
  assert.match(route,/targetUsername: \{ in: sourceIds \}/);
  assert.match(route,/instagramAccountId: account\.id/);
  assert.match(route,/inspectConfiguredFollowerCollector/);
  assert.match(route,/lastReadStatusFromDetails/);
  assert.match(route,/presentCollectorReadHealth/);
  assert.match(route,/sources\.slice\(0, 3\)/);
  assert.doesNotMatch(route,/agents\/launch|followAction\.(create|update)|api\.instagram\.com/);
  const ui = readFileSync(
    'app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/A API responde, mas não foi possível consultar os detalhes do coletor/);
  assert.match(ui,/Resultado antigo preservado/);
  assert.match(ui,/connection\.collectorCheck/);
  assert.match(ui,/Atualizar dados/);
});
