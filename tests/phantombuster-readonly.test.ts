import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkPhantomBusterWorkspace } from '../lib/providers/phantombuster';

test('read-only provider check uses the official v2 endpoint and private header', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const result = await checkPhantomBusterWorkspace('server-only-key', async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify([
      { id: 1, name: 'collector', argument: 'PRIVATE_COOKIE_DO_NOT_RETURN' },
      { id: 2, name: 'other' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.phantombuster\.com\/api\/v2\/agents\/fetch-all\?withArgument=false$/);
  assert.equal(requests[0].init?.method, 'GET');
  assert.equal((requests[0].init?.headers as Record<string, string>)['X-Phantombuster-Key'], 'server-only-key');
  assert.equal(requests[0].init?.redirect, 'error');
  assert.deepEqual(result, { status: 'verified', workspaceAgentCount: 2, instagramConnectionVerified: false, actionsEnabled: false });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_COOKIE_DO_NOT_RETURN|server-only-key/);
});

test('empty key never makes an outbound request', async () => {
  const result = await checkPhantomBusterWorkspace(' ', async () => {
    throw Error('request should not occur');
  });
  assert.equal(result.status, 'not-configured');
});

test('provider responses are safe for unauthorized, throttled and unexpected cases', async () => {
  for (const [http, expected] of [[401, 'invalid-key'], [403, 'invalid-key'], [429, 'limited'], [503, 'unavailable']] as const) {
    const result = await checkPhantomBusterWorkspace('key', async () => new Response('SECRET_PAYLOAD', { status: http }));
    assert.equal(result.status, expected);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_PAYLOAD/);
  }
  const malformed = await checkPhantomBusterWorkspace('key', async () => new Response(JSON.stringify({ token: 'SECRET_PAYLOAD' }), { status: 200 }));
  assert.equal(malformed.status, 'unexpected-response');
  assert.doesNotMatch(JSON.stringify(malformed), /SECRET_PAYLOAD/);
});

test('provider JSON shapes and errors cannot leak settings or cookies', async () => {
  const wrapped = await checkPhantomBusterWorkspace('key', async () =>
    new Response(JSON.stringify({ data: [{ id: 1, argument: { session: 'SENSITIVE' } }] }), { status: 200 }));
  assert.deepEqual(wrapped, { status: 'verified', workspaceAgentCount: 1, instagramConnectionVerified: false, actionsEnabled: false });
  const failure = await checkPhantomBusterWorkspace('key', async () => { throw new Error('my-private-cookie=secret'); });
  assert.equal(failure.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failure), /private|cookie|secret/i);
});

test('route is authenticated, tenant scoped, pilot only, read-only and does not expose keys', () => {
  const src = readFileSync('app/api/provider/phantombuster/route.ts', 'utf8');
  assert.match(src, /const session = await auth\(\)/);
  assert.match(src, /where: \{ id: accountId, userId \}/);
  assert.match(src, /PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(src, /PHANTOMBUSTER_PILOT_ACCOUNT_ID !== account.id/);
  assert.match(src, /process\.env\.PHANTOMBUSTER_API_KEY/);
  assert.match(src, /export async function GET/);
  assert.doesNotMatch(src, /export async function POST|agents\/launch|user_follow|user_unfollow|PRIVATE_API_IG_PASSWORD/);
});

test('the UI explicitly distinguishes workspace connectivity from Instagram authentication', () => {
  const page = readFileSync('app/(app)/references/_components/provider-connection-panel.tsx', 'utf8');
  const refPage = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  assert.match(page, /Instagram: não verificado/);
  assert.match(page, /Ações automáticas: desativadas/);
  assert.match(refPage, /ProviderConnectionPanel/);
  assert.doesNotMatch(page, /input.*type=.password.|Cookie de sessão/);
});
