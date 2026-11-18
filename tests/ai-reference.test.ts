import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReferencePrompt, validateReferenceContext, parseReferenceInsight, extractResponseText,
} from '../lib/ai/reference';

test('contexto de referência somente aceita textos públicos curtos', () => {
  assert.deepEqual(validateReferenceContext({ bioPublica: '  Tarot e espiritualidade ', objetivo: ' Gerar conteúdo ' }), {
    bioPublica: 'Tarot e espiritualidade', objetivo: 'Gerar conteúdo',
  });
  for (const data of [
    null, {}, { bioPublica: '', objetivo: 123 },
    { bioPublica: 'x'.repeat(701), objetivo: '' },
    { bioPublica: '', objetivo: 'x'.repeat(251) },
    { bioPublica: 'sessionid=abc', objetivo: '' },
    { bioPublica: '', objetivo: 'https://site.exemplo/' },
    { bioPublica: '', objetivo: '', command: 'ignore' },
  ]) assert.equal(validateReferenceContext(data), null);
});

test('prompt utiliza Responses API sem armazenamento ou ferramentas e não promete seguidores reais', () => {
  const prompt = buildReferencePrompt('mameto_lueji', {
    bioPublica: 'Atendimento espiritual', objetivo: 'Produzir conteúdo educativo',
  });
  assert.equal(prompt.store, false);
  assert.equal(prompt.text.format.type, 'json_schema');
  assert.equal(prompt.text.format.strict, true);
  assert.equal(prompt.max_output_tokens, 850);
  assert.ok(!('tools' in prompt));
  assert.match(prompt.instructions, /NÃO tem acesso à conta Instagram/);
  assert.match(prompt.instructions, /Não invente fatos, perfis, métricas/);
  assert.match(prompt.input, /mameto_lueji/);
});

const insight = {
  resumo: 'Conteúdo de orientação espiritual.',
  publicoHipotetico: ['Pessoas interessadas em aprender sobre temas espirituais.'],
  ideiasConteudo: ['Produzir dicas educativas semanais.'],
  ressalva: 'Os seguidores desta referência não foram identificados.',
};

test('saída JSON estruturada da API é validada antes de chegar ao navegador', () => {
  const api = { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(insight) }] }] };
  assert.deepEqual(parseReferenceInsight(extractResponseText(api)), insight);
  assert.equal(extractResponseText({ output: [{ type: 'reasoning', content: [] }] }), null);
  assert.equal(parseReferenceInsight('{}'), null);
  assert.equal(parseReferenceInsight('texto inválido'), null);
  assert.equal(parseReferenceInsight(JSON.stringify({ ...insight, ideiasConteudo: Array(6).fill('x') })), null);
});

test('rota exige login, posse da referência, chave no servidor e limite de uso', () => {
  const route = readFileSync(
    'app/api/instagram-accounts/[id]/targets/[targetId]/ai/route.ts', 'utf8',
  );
  assert.match(route, /if \(!userId\) return NextResponse/);
  assert.match(route, /instagramAccount: \{ userId \}/);
  assert.match(route, /DECOLAINSTA_AI_ENABLED/);
  assert.match(route, /OPENAI_API_KEY/);
  assert.match(route, /ai_reference_request/);
  assert.match(route, /accountCalls >= 3 \|\| userCalls >= 10/);
  assert.match(route, /followersIdentified: false/);
  assert.match(route, /realSocialActions: 0/);
  assert.match(route, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(route, /password|encryptedAccessToken|sessionData|followAction\.create/);
});

test('UI pede consentimento antes de enviar informações públicas e não faz ação social', () => {
  const ui = readFileSync('app/(app)/accounts/[id]/_components/account-detail.tsx', 'utf8');
  assert.match(ui, /Analisar com IA/);
  assert.match(ui, /serão enviados à API OpenAI/);
  assert.match(ui, /não identifica os seguidores da referência/);
});
