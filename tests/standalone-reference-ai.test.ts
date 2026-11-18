import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canUsePreviewAI, countPreviewAIRequest } from '../lib/ai/preview-limit';

test('IA independente existe sem obrigar login Meta ou criar conta Instagram', () => {
  const api = readFileSync('app/api/ai/reference/route.ts', 'utf8');
  assert.match(api, /from '@\/auth'/);
  assert.match(api, /VERCEL_ENV !== 'preview'/);
  assert.match(api, /DECOLAINSTA_AI_ENABLED/);
  assert.match(api, /OPENAI_API_KEY/);
  assert.match(api, /cleanUsername\(referenceUsername\)/);
  assert.match(api, /consent !== true/);
  assert.match(api, /new URL\(origin\)/);
  assert.match(api, /countPreviewAIRequest\(userId\)/);
  assert.match(api, /followersIdentified: false/);
  assert.match(api, /realSocialActions: 0/);
  assert.match(api, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(api, /connectedAccount|instagramAccount\.findFirst|sessionData|encryptedPassword/);
});

test('tela independente exige consentimento antes de uma chamada paga', () => {
  const page = readFileSync('app/(app)/reference-ai/_components/reference-ai-form.tsx', 'utf8');
  assert.match(page, /'\/api\/ai\/reference'/);
  assert.match(page, /setConsent/);
  assert.match(page, /if \(!consent\)/);
  assert.match(page, /!consent\}/);
  assert.match(page, /não descobre/);
  assert.match(page, /followersIdentified !== false/);
});

test('acesso IA fica visível no menu e em Contas sem depender de Meta', () => {
  const sidebar = readFileSync('app/(app)/_components/app-sidebar.tsx', 'utf8');
  const accounts = readFileSync('app/(app)/accounts/_components/accounts-list.tsx', 'utf8');
  assert.match(sidebar, /href: '\/reference-ai'/);
  assert.match(sidebar, /DecolaInsta/);
  assert.match(accounts, /href="\/reference-ai"/);
  assert.match(accounts, /não exige conectar sua conta Instagram à Meta/);
  assert.match(accounts, /Nenhuma conta Meta conectada/);
});

test('limitador local do Preview bloqueia três requisições dentro de um dia', () => {
  const user = 'test-user-preview-limit-1';
  const base = Date.UTC(2026, 10, 18);
  assert.equal(canUsePreviewAI(user, base), true);
  assert.equal(countPreviewAIRequest(user, base), true);
  assert.equal(countPreviewAIRequest(user, base + 50), true);
  assert.equal(countPreviewAIRequest(user, base + 100), false);
  assert.equal(canUsePreviewAI(user, base + 24 * 60 * 60 * 1000 + 101), true);
});
