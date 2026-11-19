import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLLECTOR_SOURCE_PREFIX, MANUAL_SOURCE_PREFIX, referenceCollectorSource,
  referenceFromSource, referenceProvenance, referenceSource,
} from '../lib/reference-workflow';

test('collector origin remains distinct from manual origin, with reversible reference', () => {
  const collector = referenceCollectorSource('mameto_lueji');
  const manual = referenceSource('mameto_lueji');
  assert.equal(collector, COLLECTOR_SOURCE_PREFIX + 'mameto_lueji');
  assert.equal(manual, MANUAL_SOURCE_PREFIX + 'mameto_lueji');
  assert.equal(referenceFromSource(collector), 'mameto_lueji');
  assert.equal(referenceFromSource(manual), 'mameto_lueji');
  assert.equal(referenceProvenance(collector), 'operator_assigned_collector_result');
  assert.equal(referenceProvenance(manual), 'user_reported_not_meta_verified');
});

test('candidate endpoint enforces login ownership, same origin, pilot gate, and explicit one-name consent', () => {
  const route = readFileSync('app/api/provider/phantombuster/audience-candidate/route.ts', 'utf8');
  assert.match(route, /const session = await auth\(\)/);
  assert.match(route, /where: \{ id: input.accountId, userId \}/);
  assert.match(route, /id: input.referenceId, instagramAccountId: account.id/);
  assert.match(route, /origin !== new URL\(req.url\).origin/);
  assert.match(route, /input.confirmAdd !== true/);
  assert.match(route, /PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(route, /input.historyId/);
  assert.match(route, /snapshot.usernames.includes\(username\)/);
  assert.match(route, /snapshot.referenceId !== reference.id/);
  assert.match(route, /Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(route, /tx.whitelist.findUnique/);
  assert.match(route, /existing\) return \{ type: 'duplicate'/);
  assert.match(route, /count >= 500/);
  assert.match(route, /referenceCollectorSource\(reference.username\)/);
  assert.match(route, /action: 'reference_candidate'/);
  assert.doesNotMatch(route, /agents\/launch|user_follow|user_unfollow|phantombuster-audience|https:\/\/api\.instagram/);
});

test('reference workflow includes both manual and collector candidates without merging provenance', () => {
  const api = readFileSync('app/api/reference-workflow/route.ts', 'utf8');
  const parent = readFileSync('app/(app)/references/_components/reference-workflow-panel.tsx', 'utf8');
  assert.match(api, /COLLECTOR_SOURCE_PREFIX/);
  assert.match(api, /referenceProvenance\(lead.sourceTarget\)/);
  assert.match(api, /sourceTarget: \{ startsWith: MANUAL_SOURCE_PREFIX \}/);
  assert.match(api, /sourceTarget: \{ startsWith: COLLECTOR_SOURCE_PREFIX \}/);
  assert.match(parent, /onCandidateAdded=\{\(\) => refresh\(selectedAccount\)\}/);
  assert.match(parent, /Candidato escolhido do histórico PhantomBuster/);
});

test('candidate UI requires confirmation and never interacts with Instagram', () => {
  const ui = readFileSync('app/(app)/references/_components/reference-audience-panel.tsx', 'utf8');
  assert.match(ui, /Registrar @\$\{username\} como candidato/);
  assert.match(ui, /confirmAdd: true/);
  assert.match(ui, /audience-candidate/);
  assert.match(ui, /onCandidateAdded\(\)/);
  assert.match(ui, /Acompanhar/);
  assert.doesNotMatch(ui, /sessionStorage|localStorage|user_follow|user_unfollow|agents\/launch/);
});
