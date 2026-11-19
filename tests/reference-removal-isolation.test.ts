import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('reference deletion requires owner and same-origin and revokes active collector first', () => {
  const route = readFileSync(
    'app/api/instagram-accounts/[id]/targets/[targetId]/route.ts','utf8');
  const deletion = route.slice(route.indexOf('export async function DELETE'));
  assert.match(deletion,/req\.headers\.get\('origin'\) !== new URL\(req\.url\)\.origin/);
  assert.match(deletion,/await verify\(id, targetId\)/);
  assert.match(deletion,/prisma\.\$transaction\(async tx =>/);
  assert.match(deletion,/action: AUDIENCE_SOURCE_BINDING_ACTION/);
  assert.match(deletion,/makeAudienceSourceBinding\(targetId, null, false\)/);
  assert.match(deletion,/await tx\.activityLog\.create/);
  assert.match(deletion,/await tx\.targetAccount\.delete/);
  assert.match(deletion,/instagramAccountId: id/);
  assert.doesNotMatch(deletion,/activityLog\.delete|deleteMany\(\{/);
});

test('an account only counts candidates from references still registered on that account', () => {
  const route = readFileSync('app/api/reference-candidate-queue/route.ts','utf8');
  assert.match(route,/const activeRefs = new Map\(references\.map/);
  assert.match(route,/activeRefs\.get\(evidence\.referenceId\) === evidence\.referenceUsername/);
  assert.match(route,/const registered = new Map\(refs\.map/);
  assert.match(route,/registered\.get\(evidence\.referenceId\) === evidence\.referenceUsername/);
  assert.match(route,/where: \{ instagramAccountId: ctx\.account\.id \}/);
  assert.doesNotMatch(route,/activityLog\.delete/);
});

test('main customer page has deliberate two-stage removal and labels legacy counts honestly', () => {
  const ui = readFileSync(
    'app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(ui,/confirmRemovalId === reference\.id/);
  assert.match(ui,/setConfirmRemovalId\(reference\.id\)/);
  assert.match(ui,/void removeReference\(reference\)/);
  assert.match(ui,/method: 'DELETE'/);
  assert.match(ui,/Confirmar/);
  assert.match(ui,/Cancelar/);
  assert.match(ui,/Nomes salvos \(não verificados\)/);
  assert.match(ui,/Seus históricos antigos foram preservados/);
  assert.doesNotMatch(ui,/valid\.find\(a => a\.username.*contateste6699/);
});
