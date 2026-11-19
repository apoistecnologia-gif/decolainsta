import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  evaluateAudienceReadiness, isConfiguredPhantomBusterKey,
} from '../lib/reference-audience-readiness';

const accountId = 'pilot_1';
const refs = [
  { id: 'r1', username: 'mameto_lueji', enabled: true },
  { id: 'r2', username: 'another_ref', enabled: true },
  { id: 'disabled', username: 'disabled_ref', enabled: false },
];
const sources = JSON.stringify([
  { accountId, referenceId: 'r1', collectorAgentId: '1111111111111111' },
  { accountId: 'different_account', referenceId: 'r2',
    collectorAgentId: '2222222222222222' },
]);
const configured = {
  readOnlyEnabled: true,
  pollingEnabled: true,
  authorizedPilot: true,
  cronSecretConfigured: true,
  providerKeyConfigured: true,
};

test('preflight never confuses another account collector with owned references', () => {
  const result = evaluateAudienceReadiness(accountId, refs, sources, configured);
  assert.equal(result.technicalReady, false);
  assert.equal(result.referenceCount, 2);
  assert.equal(result.assignedCollectors, 1);
  assert.deepEqual(result.missingCollectorFor, ['@another_ref']);
  assert.deepEqual(result.missingConfiguration, ['PHANTOMBUSTER_AUDIENCE_SOURCES_JSON']);
  assert.equal(result.collectorTypeVerified, false);
  assert.equal(result.collectorResultsVerified, false);
  assert.equal(result.instagramActionsEnabled, false);
});

test('preflight identifies precisely which server variables are missing without values', () => {
  const flags = { ...configured, pollingEnabled: false, cronSecretConfigured: false,
    providerKeyConfigured: false };
  const readiness = evaluateAudienceReadiness('pilot_1', [refs[0]], sources, flags);
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
  assert.match(route, /PHANTOMBUSTER_AUDIENCE_SOURCES_JSON/);
  assert.match(route, /testedAgainstLivePhantomBuster: false/);
  assert.match(route, /instagramActionsExecuted: 0/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route,
    /api\.phantombuster\.com|fetch\(|agents\/launch|followAction\.|\.(create|update|delete|upsert)\(/);
});
