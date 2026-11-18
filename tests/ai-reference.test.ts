import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReferencePrompt, validateReferenceContext, parseReferenceInsight, extractResponseText,
  labelReferenceInsight,
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

test('sem biografia, o resumo não atribui características não verificadas à referência', () => {
  const invented = {
    resumo: 'O perfil mameto_lueji é focado em tarô.',
    publicoHipotetico: ['Pessoas interessadas em tarot'],
    ideiasConteudo: ['Vídeos explicativos'],
    ressalva: 'Hipóteses',
  };
  const result = labelReferenceInsight(invented, {
    bioPublica: '', objetivo: 'Criar conteúdos educativos sobre espiritualidade',
  });
  assert.doesNotMatch(result.resumo, /O perfil mameto_lueji é focado/);
  assert.match(result.resumo, /baseadas apenas no objetivo informado/);
  assert.match(result.ressalva, /Não verificamos a conta de referência/);
  assert.deepEqual(result.ideiasConteudo, invented.ideiasConteudo);
  const prompt = buildReferencePrompt('mameto_lueji', {
    bioPublica: '', objetivo: 'Criar conteúdos educativos',
  });
  assert.match(prompt.instructions, /O objetivoDoCriador refere-se ao usuário/);
  assert.match(prompt.instructions, /NÃO declare que o perfil de referência é focado/);
});

test('com descrição fornecida, o resumo deixa clara a ausência de verificação', () => {
  const result = labelReferenceInsight({
    resumo: 'Conteúdo educativo.',
    publicoHipotetico: [], ideiasConteudo: [], ressalva: '',
  }, { bioPublica: 'Publica leituras de cartas', objetivo: 'Atrair clientes' });
  assert.match(result.resumo, /descrição informada por você \(não verificada\)/);
});

test('ambas rotas de GPT aplicam aviso de não verificação à resposta', () => {
  for (const path of [
    'app/api/ai/reference/route.ts',
    'app/api/instagram-accounts/[id]/targets/[targetId]/ai/route.ts',
  ]) {
    const code = readFileSync(path, 'utf8');
    assert.match(code, /labelReferenceInsight\(/);
  }
});
