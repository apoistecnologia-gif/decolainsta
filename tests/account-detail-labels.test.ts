import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('connected profiles show real references without labeling the whole account a lab', () => {
  const source = readFileSync('app/(app)/accounts/[id]/_components/account-detail.tsx', 'utf8');
  assert.match(source, /account\.connected\s*\? 'Conta Instagram conectada · Contas de referência'/);
  assert.match(source, /: 'Conta demonstrativa · Recursos de teste'/);
  assert.doesNotMatch(source, /Perfil oficial e laboratório de simulação/);
});

test('real account labels do not enable the simulated follow engine or launch provider actions', () => {
  const source = readFileSync('app/(app)/accounts/[id]/_components/account-detail.tsx', 'utf8');
  assert.match(source, /const dryMode = true/);
  assert.match(source, /<Switch checked=\{true\} disabled \/>/);
  assert.match(source, /<TabsTrigger value="targets">/);
  assert.match(source, /<TabsTrigger value="settings">/);
  assert.doesNotMatch(source, /api\/operator\/followers-auto-follow-run/);
});
