import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('painel cadastra contas de referência sem exigir nicho', () => {
  const ui = readFileSync('app/(app)/accounts/[id]/_components/account-detail.tsx', 'utf8');
  assert.match(ui, /Contas de referência/);
  assert.match(ui, /Adicionar conta de referência/);
  assert.match(ui, /Lista de seguidores não identificada/);
  assert.match(ui, /JSON\.stringify\(\{ username: newTarget \}\)/);
  assert.doesNotMatch(ui, /placeholder="Nicho \(ex: fitness\)"/);
  assert.doesNotMatch(ui, /perfis fictícios gerados/);
});

test('nova conta de referência não ativa a simulação', () => {
  const api = readFileSync('app/api/instagram-accounts/[id]/targets/route.ts', 'utf8');
  assert.match(api, /enabled: false/);
  assert.match(api, /findFirst\(\{ where: \{ id, userId \} \}\)/);
});

test('o aplicativo não afirma ter coletado seguidores da referência', () => {
  const docs = readFileSync('README.md', 'utf8');
  assert.match(docs, /Requisito de produto: público de contas de referência/);
  assert.match(docs, /não retorna a lista de seguidores de terceiros/);
});
