import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkPhantomBusterWorkspace } from '../lib/providers/phantombuster';

test('provider uses single documented GET with no agent arguments', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const res = await checkPhantomBusterWorkspace('server-only-key', async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([{ id: 1, argument: 'COOKIE_SECRET' }, { id: 2 }]), { status: 200 });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.phantombuster.com/api/v2/agents/fetch-all?withArgument=false');
  assert.equal(calls[0].init?.method, 'GET');
  assert.equal((calls[0].init?.headers as Record<string, string>)['X-Phantombuster-Key'], 'server-only-key');
  assert.equal(calls[0].init?.redirect, 'error');
  assert.deepEqual(res, {
    status: 'verified', workspaceAgentCount: 2, pilotAgentFound: undefined,
    instagramConnectionVerified: false, actionsEnabled: false,
  });
  assert.doesNotMatch(JSON.stringify(res), /COOKIE_SECRET|server-only-key/);
});

test('known Phantom ID query filters metadata without launching an action', async () => {
  const agentId = '1838046655144130';
  const seen: string[] = [];
  const result = await checkPhantomBusterWorkspace('example-test-key', async (url) => {
    seen.push(url);
    return new Response(JSON.stringify([{ id: Number(agentId), argument: 'secret sessionid' }]), { status: 200 });
  }, agentId);
  assert.equal(seen.length, 1);
  const parsed = new URL(seen[0]);
  assert.equal(parsed.searchParams.get('agentIds'), agentId);
  assert.equal(parsed.searchParams.get('withArgument'), 'false');
  assert.equal(result.status, 'verified');
  assert.equal(result.pilotAgentFound, true);
  assert.equal(result.instagramConnectionVerified, false);
  assert.equal(result.actionsEnabled, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|sessionid/i);
});

test('wrong or missing agent not reported as authenticated Instagram', async () => {
  const result = await checkPhantomBusterWorkspace('key', async () =>
    new Response(JSON.stringify([{ id: 999 }]), { status: 200 }), '1838046655144130');
  assert.equal(result.status, 'agent-not-found');
  assert.equal(result.pilotAgentFound, false);
  assert.equal(result.instagramConnectionVerified, false);
});

test('empty key, malformed agent and transport failure are safe', async () => {
  let called = false;
  const fake = async () => { called = true; throw Error('do not contact provider'); };
  const empty = await checkPhantomBusterWorkspace(' ', fake);
  assert.equal(empty.status, 'not-configured');
  const malformed = await checkPhantomBusterWorkspace('key', fake, '../../../launch');
  assert.equal(malformed.status, 'unexpected-response');
  assert.equal(called, false);
  const failed = await checkPhantomBusterWorkspace('key', async () => { throw Error('leaked-secret-token'); });
  assert.equal(failed.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /leaked-secret-token/);
});

test('rate limit, auth error, and unexpected responses are sanitized', async () => {
  for (const [code, expected] of [[401, 'invalid-key'], [403, 'invalid-key'], [429, 'limited'], [500, 'unavailable']] as const) {
    const res = await checkPhantomBusterWorkspace('key', async () =>
      new Response('PRIVATE_COOKIE', { status: code }));
    assert.equal(res.status, expected);
    assert.doesNotMatch(JSON.stringify(res), /PRIVATE_COOKIE/);
  }
  const invalid = await checkPhantomBusterWorkspace('key', async () =>
    new Response(JSON.stringify({ secretCookie: 'PRIVATE_COOKIE' }), { status: 200 }));
  assert.equal(invalid.status, 'unexpected-response');
});

test('one-time key route requires user, ownership, same-origin, pilot gates and no writes', () => {
  const code = readFileSync('app/api/provider/phantombuster/route.ts', 'utf8');
  assert.match(code, /const session = await auth\(\)/);
  assert.match(code, /where: \{ id: accountId, userId \}/);
  assert.match(code, /PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(code, /PHANTOMBUSTER_PILOT_USERNAME/);
  assert.match(code, /export async function GET/);
  assert.match(code, /export async function POST/);
  assert.match(code, /origin !== new URL\(req.url\).origin/);
  assert.match(code, /key.length > 512/);
  assert.match(code, /checkPhantomBusterWorkspace\(key, fetch, pilotAgentId\(\)\)/);
  assert.doesNotMatch(code, /agents\/launch|user_follow|user_unfollow|PRIVATE_API_IG_PASSWORD|prisma\.[a-zA-Z]+\.(create|update|upsert|delete)/);
});

test('preview shows one-time secret entry, no session-cookie field and accurate status', () => {
  const ui = readFileSync('app/(app)/references/_components/provider-connection-panel.tsx', 'utf8');
  assert.match(ui, /autoComplete="off"/);
  assert.match(ui, /type="password"/);
  assert.match(ui, /setApiKey\(''\)/);
  assert.match(ui, /Instagram: não verificado/);
  assert.match(ui, /Ações automáticas: desativadas/);
  assert.match(ui, /não será iniciada/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|cookieValue|sessionid=/);
});
