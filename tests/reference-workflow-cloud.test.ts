import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOLLOW_BACK_REVIEW_HOURS,
  MANUAL_SOURCE_PREFIX,
  REFERENCE_ACTIONS,
  referenceFromSource,
  referenceSource,
  reviewIsDue,
  reviewTime,
} from '../lib/reference-workflow';

test('reference manual source is namespaced and reversible', () => {
  assert.equal(referenceSource('conta_referencia'), `${MANUAL_SOURCE_PREFIX}conta_referencia`);
  assert.equal(referenceFromSource(referenceSource('conta_referencia')), 'conta_referencia');
  assert.equal(referenceFromSource('simulated_reference'), null);
  assert.equal(referenceFromSource(null), null);
  assert.deepEqual(REFERENCE_ACTIONS, [
    'reference_candidate', 'reference_followed', 'reference_kept', 'reference_unfollowed',
  ]);
});

test('fixed 48h deadline starts from confirmed follow, not collection or follow-back', () => {
  const followed = new Date('2026-11-18T12:00:00.000Z');
  assert.equal(FOLLOW_BACK_REVIEW_HOURS, 48);
  assert.equal(reviewTime(followed, 48)?.toISOString(), '2026-11-20T12:00:00.000Z');
  for (const value of [0, 12, 24, 72, '48', undefined, null]) {
    assert.equal(reviewTime(followed, value), null);
  }
  assert.equal(reviewTime(new Date('invalid'), 48), null);
});

test('48h rule requires a confirmed follow-back; no follow-back means no unfollow review', () => {
  const deadline = new Date('2026-11-20T12:00:00.000Z');
  assert.equal(reviewIsDue('reference_followed', true, deadline, new Date('2026-11-20T11:59:59Z')), false);
  assert.equal(reviewIsDue('reference_followed', true, deadline, new Date('2026-11-20T12:00:00Z')), true);
  assert.equal(reviewIsDue('reference_followed', false, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_candidate', true, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_kept', true, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_unfollowed', true, deadline, new Date('2026-11-25T12:00:00Z')), false);
  assert.equal(reviewIsDue('reference_followed', true, null, new Date('2026-11-25T12:00:00Z')), false);
});

test('cloud workflow requires auth, scopes reference and lead by owned account and isolates demo', () => {
  const code = readFileSync('app/api/reference-workflow/route.ts', 'utf8');
  assert.match(code, /const userId = \(session\?\.user as \{ id\?: string \} \| undefined\)\?\.id/);
  assert.match(code, /where: \{ id: accountId, userId \}/);
  assert.match(code, /id: input\.referenceId, instagramAccountId: ctx\.accountId/);
  assert.match(code, /instagramAccountId: ctx\.accountId/);
  assert.match(code, /isDryRun: false/);
  assert.match(code, /sourceTarget: \{ startsWith: MANUAL_SOURCE_PREFIX \}/);
  assert.match(code, /followedBack: true/);
  assert.match(code, /followedAt: \{ lte: cutoff \}/);
  assert.match(code, /FOLLOW_BACK_REVIEW_HOURS/);
  assert.match(code, /data: \{ followedBack: true \}/);
  assert.doesNotMatch(code, /followedBack: false, unfollowScheduledAt: \{ lte: now \}/);
  assert.match(code, /prisma\.whitelist\.findUnique/);
  assert.doesNotMatch(code, /simulateFollow|simulateUnfollow|collectFollowers|publishPhoto|getProfile\(/);
  assert.match(code, /source: 'user_reported_not_meta_verified'/);
});

test('references main screen is simple and manual diagnostics remain separately accessible', () => {
  const page = readFileSync('app/(app)/references/page.tsx', 'utf8');
  const simple = readFileSync('app/(app)/references/_components/simple-references-panel.tsx', 'utf8');
  const diagnostics = readFileSync('app/(app)/references/diagnostics/page.tsx', 'utf8');
  const panel = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  const sidebar = readFileSync('app/(app)/_components/app-sidebar.tsx', 'utf8');
  const authLayout = readFileSync('app/(app)/layout.tsx', 'utf8');
  assert.match(page, /SimpleReferencesPanel/);
  assert.doesNotMatch(page, /ReferenceWorkflowPanel|ReferenceAudiencePanel|AutomaticAudiencePlanPanel/);
  assert.match(simple, /Contas de referência/);
  assert.match(simple, /Candidatos identificados/);
  assert.match(simple, /\/references\/diagnostics/);
  assert.match(simple, /Adicionar referência/);
  assert.doesNotMatch(simple, /agents\/launch|user_follow|user_unfollow|audience-bulk-import|confirm-follow|confirm-unfollow|sessionid/);
  assert.match(diagnostics, /ReferenceWorkflowPanel/);
  assert.match(diagnostics, /ReferenceHistoryPanel/);
  assert.match(authLayout, /redirect\('\/login'\)/);
  assert.match(panel, /Confirmei que segui/);
  assert.match(panel, /Confirmei que deixei de seguir/);
  assert.match(panel, /não executa unfollow automaticamente/);
  assert.ok(sidebar.indexOf("href: '/references'") < sidebar.indexOf("href: '/scheduled-posts'"));
});

test('follow-back tracking keeps 48h review semantics without automating Instagram', () => {
  const route = readFileSync('app/api/reference-workflow/route.ts', 'utf8');
  const panel = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  const preview = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx', 'utf8');
  assert.match(route, /reviewTime\(now, FOLLOW_BACK_REVIEW_HOURS\)/);
  assert.match(route, /followedAt: \{ lte: cutoff \}/);
  assert.match(route, /data: \{ followedBack: true \}/);
  assert.doesNotMatch(route, /data: \{ followedBack: true, unfollowScheduledAt: null \}/);
  assert.match(panel, /Regra do piloto: 48 horas após o follow/);
  assert.match(panel, /lead\.due && !lead\.protected && lead\.followedBack/);
  assert.match(preview, /quem não seguiu de volta não entra nessa regra/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => void (?:follow|unfollow)\(/);
});


test('simple refresh synchronizes saved reference history explicitly and only after user clicks', () => {
  const ui = readFileSync('app/(app)/references/_components/simple-references-panel.tsx', 'utf8');
  assert.match(ui, /async function refresh\(\)/);
  assert.match(ui, /method: 'POST'/);
  assert.match(ui, /operation: 'sync-saved-history'/);
  assert.match(ui, /if \(index !== null\)/);
  assert.match(ui, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.match(ui, /Os históricos salvos já estão sincronizados/);
  assert.match(ui, /Não inicia uma nova coleta no Instagram/);
  assert.doesNotMatch(ui, /apiKey|sessionid|agents\/launch|user_follow|user_unfollow|followAction\.create/);
});


test('refresh feedback appears beside Update Data, not at the account selector', () => {
  const ui = readFileSync('app/(app)/references/_components/simple-references-panel.tsx', 'utf8');
  assert.match(ui, /const \[refreshMessage, setRefreshMessage\] = useState/);
  assert.match(ui, /const \[refreshError, setRefreshError\] = useState/);
  assert.match(ui, /setRefreshMessage\('Os históricos salvos já estão sincronizados/);
  assert.match(ui, /setRefreshError\(err instanceof Error/);
  const button = ui.indexOf('Atualizar dados');
  const status = ui.indexOf('{refreshMessage && <p role="status"');
  const alert = ui.indexOf('{refreshError && <p role="alert"');
  assert.ok(button > 0 && status > button && alert > status);
  assert.match(ui, /aria-live="polite"/);
  assert.doesNotMatch(ui, /agents\/launch|user_follow|user_unfollow/);
});
