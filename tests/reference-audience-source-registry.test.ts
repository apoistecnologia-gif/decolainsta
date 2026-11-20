import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, makeAudienceSourceBinding,
  parseAudienceSourceBinding, resolveActiveAudienceSources,
  resolveLatestAudienceBindings, disabledAudienceReferenceKeys,
  type AudienceSourceBindingRow,
} from '../lib/reference-audience-source-registry';

function row(account: string, ref: string, agent: string | null, enabled: boolean,
  created: string, id: string): AudienceSourceBindingRow {
  return {
    id, instagramAccountId: account, targetUsername: ref,
    createdAt: new Date(created),
    details: JSON.stringify(makeAudienceSourceBinding(ref, agent, enabled)),
  };
}

test('multi-tenant collector registry keeps owners and references isolated', () => {
  assert.equal(AUDIENCE_SOURCE_BINDING_ACTION, 'reference_audience_binding_v1');
  const entries = [
    row('account_a','ref_a','1111111111111111',true,'2026-11-19T10:00:00Z','one'),
    row('account_a','ref_b','2222222222222222',true,'2026-11-19T11:00:00Z','two'),
    row('account_b','ref_c','3333333333333333',true,'2026-11-19T12:00:00Z','three'),
  ];
  const resolved = resolveActiveAudienceSources(entries);
  assert.equal(resolved.length,3);
  assert.deepEqual(resolved.map(s=>s.accountId).sort(), ['account_a','account_a','account_b']);
  assert.deepEqual(resolved.filter(s=>s.accountId==='account_a').map(s=>s.referenceId).sort(),
    ['ref_a','ref_b']);
});

test('latest revocation suppresses source without erasing old audit events', () => {
  const entries = [
    row('account_a','ref_a','1111111111111111',true,'2026-11-19T10:00:00Z','old'),
    row('account_a','ref_a',null,false,'2026-11-19T11:00:00Z','new'),
    row('account_b','ref_b','2222222222222222',true,'2026-11-19T09:00:00Z','other'),
  ];
  assert.deepEqual(resolveActiveAudienceSources(entries), [
    {accountId:'account_b',referenceId:'ref_b',collectorAgentId:'2222222222222222'},
  ]);
});

test('same collector assigned to two clients is quarantined for both', () => {
  const entries = [
    row('account_a','ref_a','1111111111111111',true,'2026-11-19T10:00:00Z','one'),
    row('account_b','ref_b','1111111111111111',true,'2026-11-19T10:00:00Z','two'),
  ];
  assert.deepEqual(resolveActiveAudienceSources(entries), []);
  // Operator must still see and revoke both conflicting assignments.
  assert.equal(resolveLatestAudienceBindings(entries).length, 2);
  const revoked = row('account_a','ref_a',null,false,
    '2026-11-19T13:00:00Z','three');
  assert.deepEqual(resolveActiveAudienceSources([...entries,revoked]),[
    {accountId:'account_b',referenceId:'ref_b',collectorAgentId:'1111111111111111'},
  ]);
});

test('malformed latest binding fails closed and does not revive older event', () => {
  const original = row('account_a','ref_a','1111111111111111',
    true,'2026-11-19T10:00:00Z','old');
  const corrupted = { ...original, id:'new',
    createdAt:new Date('2026-11-19T11:00:00Z'),
    details:'{"version":1,"referenceId":"ref_a","enabled":true}' };
  assert.deepEqual(resolveActiveAudienceSources([original,corrupted]), []);
  assert.equal(parseAudienceSourceBinding(corrupted.details),null);
  assert.equal(makeAudienceSourceBinding('ref_a','999',true),null);
  assert.equal(makeAudienceSourceBinding('ref_a',null,false)?.enabled,false);
});

test('registry reader pulls database bindings, never hardcodes pilot account', () => {
  const store = readFileSync('lib/server/reference-audience-source-store.ts','utf8');
  const runner = readFileSync('lib/server/reference-audience-refresh-runner.ts','utf8');
  const manual = readFileSync('app/api/provider/phantombuster/refresh-now/route.ts','utf8');
  const route = readFileSync('app/api/provider/phantombuster/collector-bindings/route.ts','utf8');
  const target = readFileSync('app/api/instagram-accounts/[id]/targets/route.ts','utf8');
  assert.match(store,/resolveActiveAudienceSources/);
  assert.match(store,/action: AUDIENCE_SOURCE_BINDING_ACTION/);
  assert.match(store,/if \(rows\.length > MAX_SOURCE_BINDING_LOGS\)/);
  assert.match(runner,/loadActiveAudienceSources\(onlyAccountId\)/);
  assert.match(runner,/process\.env\.PHANTOMBUSTER_MULTI_ACCOUNT_PRODUCTION_ENABLED !== 'yes'/);
  assert.match(manual,/where: \{ id: input\.accountId, userId \}/);
  assert.match(route,/admin\?\.role !== 'admin'/);
  assert.match(route,/where: \{ id: referenceId, instagramAccountId: accountId \}/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/verifyConfiguredFollowerCollector/);
  assert.match(route,/confirmReadOnlyCollector/);
  assert.match(route,/operation === 'unbind'/);
  assert.match(route,/reservedCollectorDraftAgents\(drafts\)\.has\(agentId!\)/);
  assert.match(route,/outcome === 'agent-reserved'/);
  assert.match(route,/operation === 'bind'\s*\? tx\.activityLog\.findMany/);
  assert.match(target,/enabled: false/);
  assert.doesNotMatch(runner+manual,/PHANTOMBUSTER_PILOT_USERNAME|PHANTOMBUSTER_AUDIENCE_SOURCES_JSON/);
  assert.doesNotMatch(route+runner,/agents\/launch|user_follow|user_unfollow|api\.instagram\.com/);
});

test('existing collectors are matched automatically only by administrator and saved account', () => {
  const route = readFileSync('app/api/provider/phantombuster/match-collectors/route.ts','utf8');
  const sourceStore = readFileSync('lib/server/reference-audience-source-store.ts','utf8');
  assert.match(route,/user\?\.role !== 'admin'/);
  assert.match(route,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(route,/request\.headers\.get\('origin'\)/);
  assert.match(route,/discoverFollowerCollectors/);
  assert.match(route,/planExactReadOnlyCollectorBindings/);
  assert.match(route,/instagramAccountId: account\.id/);
  assert.match(route,/MAX_SOURCE_BINDING_LOGS/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/instagramActionsExecuted: 0/);
  assert.match(sourceStore,/const globallyUnambiguous = resolveActiveAudienceSources\(rows\)/);
  assert.match(sourceStore,/accountId \? globallyUnambiguous\.filter/);
  assert.doesNotMatch(route,/agents\/launch|agents\/save|user_follow|user_unfollow/);
});

test('explicit opt-out survives automated discovery until operator deliberately rebinds', () => {
  const entries = [
    row('account_a','ref_a','1111111111111111',true,'2026-11-19T10:00:00Z','one'),
    row('account_a','ref_a',null,false,'2026-11-19T11:00:00Z','two'),
    row('account_b','ref_b','2222222222222222',true,'2026-11-19T12:00:00Z','three'),
  ];
  assert.deepEqual([...disabledAudienceReferenceKeys(entries)], ['account_a:ref_a']);
  const restored = row('account_a','ref_a','1111111111111111',true,
    '2026-11-19T13:00:00Z','four');
  assert.equal(disabledAudienceReferenceKeys([...entries,restored]).size,0);
  assert.match(readFileSync(
    'app/api/provider/phantombuster/match-collectors/route.ts','utf8'),
    /disabledAudienceReferenceKeys\(rows\)/);
  assert.match(readFileSync(
    'app/api/instagram-accounts/[id]/targets/[targetId]/route.ts','utf8'),
    /if \(enabled === false\)/);
});
