import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

test('self activation verifies signed-in account password inside serialized exclusive transaction', () => {
  const route = readFileSync('app/api/operator/activate-first-admin/route.ts','utf8');
  const probes = [
    "process.env.VERCEL_ENV !== 'preview'",
    'const session = await auth()',
    'const userId =',
    "request.headers.get('origin')",
    'FIRST_OPERATOR_CONFIRMATION',
    'pg_advisory_xact_lock',
    'eligibleFirstOperator(',
    'tx.user.count()',
    "tx.user.count({ where: { role: 'admin' } })",
    'bcrypt.compare(',
    'tx.user.updateMany(',
    "role: 'user'",
    "role: 'admin'",
    'Prisma.TransactionIsolationLevel.Serializable',
  ];
  for (const probe of probes) assert.ok(route.includes(probe),probe);
  for (const forbidden of ['user.create(', 'agents/save', 'sessionCookie', 'password: owner.password'])
    assert.ok(!route.includes(forbidden),forbidden);
});

test('activation controls are visible only to the first non-admin signed-in account',()=>{
  const page = readFileSync('app/(app)/references/diagnostics/page.tsx','utf8');
  assert.match(page,/operator\?\.role === 'user'/);
  assert.match(page,/await prisma\.user\.count\(\) === 1/);
  assert.match(page,/FirstOperatorActivationPanel/);
  const form = readFileSync(
    'app/(app)/references/_components/first-operator-activation-panel.tsx','utf8');
  assert.match(form,/type="password"/);
  assert.match(form,/autoComplete="current-password"/);
  assert.match(form,/FIRST_OPERATOR_CONFIRMATION/);
  assert.match(form,/approved/);
  assert.doesNotMatch(readFileSync('app/(app)/references/page.tsx','utf8'),
    /FirstOperatorActivationPanel/);
});
