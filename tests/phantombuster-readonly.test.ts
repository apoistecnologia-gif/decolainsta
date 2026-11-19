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

test('reference screen can register the exact pilot username locally without Instagram login', () => {
  const source = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  assert.match(source, /const PILOT_USERNAME = 'contateste6699'/);
  assert.match(source, /async function registerPilotAccount\(\)/);
  assert.match(source, /method: 'POST'/);
  assert.match(source, /fetch\('\/api\/instagram-accounts'/);
  assert.match(source, /body: JSON.stringify\(\{ username: PILOT_USERNAME \}\)/);
  assert.match(source, /Cadastrar @contateste6699 no piloto/);
  assert.doesNotMatch(source, /PASSWORD|sessionid=|api\/instagram\/connect|agents\/launch/);
  assert.match(source, /onClick=\{registerPilotAccount\}/);
});

test('preview shows one-time secret entry, no session-cookie field and accurate status', () => {
  const ui = readFileSync('app/(app)/references/_components/provider-connection-panel.tsx', 'utf8');
  assert.match(ui, /autoComplete="off"/);
  assert.match(ui, /type="password"/);
  assert.match(ui, /setApiKey\(''\)/);
  assert.match(ui, /Instagram: não verificado/);
  assert.match(ui, /Ações automáticas: desativadas/);
  assert.match(ui, /nenhuma execução de follow\/unfollow será iniciada/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|cookieValue|sessionid=/);
});

test('read-only Profile Scraper result is scoped to the exact pilot profile and never leaks raw provider data', async () => {
  const { getLatestTestProfile } = await import('../lib/providers/phantombuster-profile-result');
  const urls: string[] = [];
  const result = await getLatestTestProfile('private-server-key', '3648918782366739', 'contateste6699', async (url, init) => {
    urls.push(url);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>)['X-Phantombuster-Key'], 'private-server-key');
    if (url.includes('/containers/fetch-all')) {
      return new Response(JSON.stringify([{ id: '7777777777777777', endedAt: 1795098800000 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ resultObject: JSON.stringify([
      { profileName: 'contateste6699', followersCount: 0, followingCount: '0', email: 'secret@example.com', sessionid: 'secret-cookie' },
    ]) }), { status: 200 });
  });
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]).searchParams.get('agentId'), '3648918782366739');
  assert.equal(new URL(urls[0]).searchParams.get('mode'), 'finalized');
  assert.equal(new URL(urls[1]).searchParams.get('id'), '7777777777777777');
  assert.deepEqual(result, {
    status: 'found',
    profile: { username: 'contateste6699', followersCount: 0, followingCount: 0 },
    source: 'phantombuster-profile-scraper',
    savedToDatabase: false,
    instagramSessionForActionsVerified: false,
    actionsEnabled: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|example.com|cookie|private-server-key/i);
});

test('unknown target, no run or invalid response cannot import a different person', async () => {
  const { getLatestTestProfile } = await import('../lib/providers/phantombuster-profile-result');
  const noRun = await getLatestTestProfile('key', '3648918782366739', 'contateste6699', async () =>
    new Response(JSON.stringify({ containers: [] }), { status: 200 }));
  assert.equal(noRun.status, 'no-launch');
  const mismatched = await getLatestTestProfile('key', '3648918782366739', 'contateste6699', async (url) =>
    url.includes('fetch-all')
      ? new Response(JSON.stringify([{ id: '7777777777777777' }]), { status: 200 })
      : new Response(JSON.stringify({ resultObject: [{ profileName: 'someone_else', followersCount: 999 }] }), { status: 200 }));
  assert.equal(mismatched.status, 'profile-not-found');
  assert.equal(mismatched.profile, undefined);
});

test('profile result integration is read-only, backend scoped and UI never stores API keys', () => {
  const route = readFileSync('app/api/provider/phantombuster/route.ts', 'utf8');
  const adapter = readFileSync('lib/providers/phantombuster-profile-result.ts', 'utf8');
  const ui = readFileSync('app/(app)/references/_components/provider-connection-panel.tsx', 'utf8');
  assert.match(route, /PHANTOMBUSTER_PROFILE_AGENT_ID/);
  assert.match(route, /pilot.username/);
  assert.match(route, /getLatestTestProfile/);
  assert.match(route, /await authorizePilot\(obj.accountId\)/);
  assert.match(ui, /Ler resultado anterior de @contateste6699/);
  assert.match(ui, /setApiKey\(''\)/);
  assert.doesNotMatch(route + adapter, /agents\/launch|\.create\(|\.update\(|\.upsert\(/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|sessionid=/);
});
