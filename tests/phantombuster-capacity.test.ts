import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  extractProviderSlotMetrics, inspectWorkspaceCapacity,
} from '../lib/providers/phantombuster-workspace-capacity';

test('reads official resources and counts agents without disclosing private fields', async () => {
  const calls: string[] = [];
  const result = await inspectWorkspaceCapacity('secret-provider-key',async (url, init) => {
    calls.push(url);
    assert.equal(init?.method,'GET');
    assert.equal(init?.credentials,'omit');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],
      'secret-provider-key');
    if (url.includes('fetch-resources')) return new Response(JSON.stringify({
      data:{agentSlots:{used:3,total:5}},
      sessionCookie:'SHOULD_STAY_PRIVATE',
    }),{status:200});
    assert.equal(new URL(url).searchParams.get('withArgument'),'false');
    return new Response(JSON.stringify({ data:[
      {id:'1111111111111111',argument:'PRIVATE_SESSION'},
      {id:'2222222222222222',argument:'PRIVATE_SESSION'},
    ]}),{status:200});
  });
  assert.equal(calls.length,2);
  assert.equal(result.status,'ok');
  assert.equal(result.resourcesRead,true);
  assert.equal(result.agents,2);
  assert.equal(result.exactFreeSlotsKnown,false);
  assert.deepEqual(result.slotMetrics,[
    {field:'data.agentSlots.used',value:3},
    {field:'data.agentSlots.total',value:5},
  ]);
  assert.doesNotMatch(JSON.stringify(result),/SHOULD_STAY_PRIVATE|PRIVATE_SESSION|secret-provider-key/);
});

test('lack of documented slot values never becomes a false available-slot claim', async () => {
  assert.deepEqual(extractProviderSlotMetrics({
    data:{other:{used:2,total:5}}, sessionCookie:'secret',
  }),[]);
  const result = await inspectWorkspaceCapacity('key',async url =>
    new Response(JSON.stringify(url.includes('fetch-resources')
      ? {data:{credits:33}} : []),{status:200}));
  assert.equal(result.status,'ok');
  assert.equal(result.agents,0);
  assert.equal(result.exactFreeSlotsKnown,false);
  assert.deepEqual(result.slotMetrics,[]);
});

test('provider errors are safe and do not retry or mutate anything',async () => {
  const scenarios = [
    [401,'invalid-key'],[429,'rate-limited'],[503,'unavailable'],
  ] as const;
  for (const [code,status] of scenarios) {
    let attempts = 0;
    const answer = await inspectWorkspaceCapacity('key',async () => {
      attempts++;
      return new Response('PROVIDER_SECRET',{status:code});
    });
    assert.equal(answer.status,status);
    assert.equal(attempts,1);
    assert.doesNotMatch(JSON.stringify(answer),/PROVIDER_SECRET/);
  }
});

test('capacity endpoint requires Preview and verified administrator, never launches',()=>{
  const code = readFileSync(
    'app/api/provider/phantombuster/workspace-capacity/route.ts','utf8');
  assert.match(code,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(code,/const session = await auth\(\)/);
  assert.match(code,/operator\?\.role !== 'admin'/);
  assert.match(code,/isConfiguredPhantomBusterKey/);
  assert.match(code,/inspectWorkspaceCapacity\(apiKey\)/);
  const helper = readFileSync(
    'lib/providers/phantombuster-workspace-capacity.ts','utf8');
  assert.match(helper,/orgs\/fetch-resources/);
  assert.match(helper,/agents\/fetch-all\?withArgument=false/);
  assert.doesNotMatch(helper+code,/agents\/launch|agents\/save|user_follow|user_unfollow/);
});

test('capacity panel labels the provider inventory as all agent types, never remaining collector slots', () => {
  const ui = readFileSync('app/(app)/references/_components/operator-collector-intake-panel.tsx', 'utf8');
  assert.match(ui, /Agentes na workspace \(todos os tipos, não apenas coletores\)/);
  assert.match(ui, /Não é possível afirmar quantas vagas restam/);
  assert.doesNotMatch(ui, /Coletores na workspace:/);
});

test('operator queue distinguishes new eligible references from already-created drafts', () => {
  const ui = readFileSync('app/(app)/references/_components/operator-collector-intake-panel.tsx', 'utf8');
  assert.match(ui, /Referências prontas para preparar: \{queue\.eligible\}/);
  assert.match(ui, /Rascunhos já criados aguardando configuração: \{queue\.pendingSetup\}/);
  assert.doesNotMatch(ui, /Aguardando configuração: \{queue\.pendingSetup\}/);
});
