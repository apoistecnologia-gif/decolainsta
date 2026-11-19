import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  evaluateAudienceReadiness, isConfiguredPhantomBusterKey,
} from '../lib/reference-audience-readiness';

const accountId = 'client_1';
const refs = [
  { id: 'r1', username: 'reference_a', enabled: true },
  { id: 'r2', username: 'another_ref', enabled: true },
  { id: 'disabled', username: 'disabled_ref', enabled: false },
];
const sources = [
  { accountId, referenceId: 'r1', collectorAgentId: '1111111111111111' },
  { accountId: 'different_account', referenceId: 'r2',
    collectorAgentId: '2222222222222222' },
];
const configured = {
  readOnlyEnabled: true,
  pollingEnabled: true,
  cronSecretConfigured: true,
  providerKeyConfigured: true,
};

test('preflight never confuses another account collector with owned references', () => {
  const result = evaluateAudienceReadiness(accountId, refs, sources, configured);
  assert.equal(result.technicalReady, false);
  assert.equal(result.referenceCount, 2);
  assert.equal(result.assignedCollectors, 1);
  assert.deepEqual(result.missingCollectorFor, ['@another_ref']);
  assert.deepEqual(result.missingConfiguration, ['VINCULOS_DE_COLETORES']);
  assert.equal(result.collectorTypeVerified, false);
  assert.equal(result.collectorResultsVerified, false);
  assert.equal(result.instagramActionsEnabled, false);
});

test('preflight identifies precisely which server variables are missing without values', () => {
  const flags = { ...configured, pollingEnabled: false, cronSecretConfigured: false,
    providerKeyConfigured: false };
  const readiness = evaluateAudienceReadiness('client_1', [refs[0]], sources, flags);
  assert.deepEqual(readiness.missingConfiguration,
    ['PHANTOMBUSTER_AUDIENCE_POLL_ENABLED', 'CRON_SECRET', 'PHANTOMBUSTER_API_KEY']);
  assert.equal(readiness.technicalReady, false);
  assert.doesNotMatch(JSON.stringify(readiness), /1111111111111111|2222222222222222/);
});

test('all account references explicitly mapped is configured, not verified collection', () => {
  const result = evaluateAudienceReadiness(accountId,
    [refs[0], refs[2]], sources, configured);
  assert.equal(result.technicalReady, true);
  assert.equal(result.referenceCount, 1);
  assert.equal(result.assignedCollectors, 1);
  assert.deepEqual(result.missingCollectorFor, []);
  assert.equal(result.collectorResultsVerified, false);
  assert.equal(result.collectorTypeVerified, false);
  assert.equal(evaluateAudienceReadiness(accountId,
    [refs[2]], sources, configured).technicalReady, false);
});

test('API key shape rejects session/cookie-like values and is never returned', () => {
  assert.equal(isConfiguredPhantomBusterKey(undefined), false);
  assert.equal(isConfiguredPhantomBusterKey('short'), false);
  assert.equal(isConfiguredPhantomBusterKey('workspace-key-123'), true);
  assert.equal(isConfiguredPhantomBusterKey('sessionid=COOKIE'), false);
  assert.equal(isConfiguredPhantomBusterKey('TOKEN with space'), false);
});

test('readiness HTTP route is authenticated, scoped, readonly, no provider operations', () => {
  const route = readFileSync(
    'app/api/provider/phantombuster/refresh-readiness/route.ts', 'utf8');
  assert.match(route, /const session = await auth\(\)/);
  assert.match(route, /where: \{ id: accountId, userId \}/);
  assert.match(route, /instagramAccountId: account.id/);
  assert.match(route, /loadActiveAudienceSources\(account\.id\)/);
  assert.match(route, /testedAgainstLivePhantomBuster: false/);
  assert.match(route, /instagramActionsExecuted: 0/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route,
    /api\.phantombuster\.com|fetch\(|agents\/launch|followAction\.|\.(create|update|delete|upsert)\(/);
});

test('manual preview polling is owner-authenticated, origin-checked and never launches agents', () => {
  const route = readFileSync('app/api/provider/phantombuster/refresh-now/route.ts', 'utf8');
  const runner = readFileSync('lib/server/reference-audience-refresh-runner.ts', 'utf8');
  const ui = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx','utf8');
  assert.match(route, /process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route, /const session = await auth\(\)/);
  assert.match(route, /where: \{ id: input\.accountId, userId \}/);
  assert.match(route, /request\.headers\.get\('origin'\) !== new URL\(request\.url\)\.origin/);
  assert.match(route, /runReadOnlyAudienceRefresh\(account\.id\)/);
  assert.match(runner, /loadActiveAudienceSources\(onlyAccountId\)/);
  assert.match(runner, /result\.resultLocation !== 'completed_run'/);
  assert.match(runner, /MAX_REFRESHES_PER_TICK|dueRefreshSources/);
  assert.match(ui, /\/api\/provider\/phantombuster\/refresh-now/);
  assert.match(ui, /Atualizar dados/);
  assert.doesNotMatch(route + runner, /agents\/launch|api\.instagram\.com|followAction\.(create|update|delete)/);
});

test('manual readiness does not require cron secret, but scheduled polling does', () => {
  const flags = { ...configured, cronSecretConfigured: false };
  const status = evaluateAudienceReadiness(accountId, [refs[0]], sources, flags);
  assert.equal(status.technicalReady, false);
  assert.equal(status.previewManualReady, true);
  assert.deepEqual(status.missingConfiguration, ['CRON_SECRET']);
});

test('two clients can have separate ready registrations with a shared server API key', () => {
  const flags = { ...configured, cronSecretConfigured: false };
  const alice = evaluateAudienceReadiness(accountId, [refs[0]], sources, flags);
  const bob = evaluateAudienceReadiness('different_account',
    [{id:'r2',username:'reference_b',enabled:true}], sources, flags);
  assert.equal(alice.previewManualReady,true);
  assert.equal(bob.previewManualReady,true);
  assert.equal(alice.assignedCollectors,1);
  assert.equal(bob.assignedCollectors,1);
  assert.deepEqual(alice.missingCollectorFor,[]);
  assert.deepEqual(bob.missingCollectorFor,[]);
});
