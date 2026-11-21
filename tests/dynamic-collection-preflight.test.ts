import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {isSameOriginDynamicCollectionRequest} from
  '../lib/server/dynamic-collection-csrf';

const stable='decolainsta-git-experime-c65b12-mariajuvelina403-7231s-projects.vercel.app';
const internal='decolainsta-deploy-preview-7c4b.vercel.app';
test('CSRF allows the actual stable Vercel Host when internal request.url uses deployment alias',()=>{
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable,
    'https://'+internal+'/api/operator/phantombuster/dynamic-references',stable),true);
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable,
    'https://'+stable+'/api/operator/phantombuster/dynamic-references',stable),true);
});
test('CSRF always rejects foreign origins, forged forwarded header, invalid scheme and missing Origin',()=>{
  const target='https://'+internal+'/api/operator/phantombuster/dynamic-references';
  assert.equal(isSameOriginDynamicCollectionRequest(null,target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://foreign.example',target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://other.vercel.app',target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('http://'+stable,target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable+'/extra',target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable+'@attacker.test',target,stable),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable,target,null),false);
  assert.equal(isSameOriginDynamicCollectionRequest('https://'+stable,target,'attacker.test'),false);
});
test('GET performs read-only provider readiness check before enabling POST and does not launch',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/const progress=enabled&&!ownLaunched/);
  assert.match(route,/inspectPinnedCollectorProgress\(key!,agentId\)/);
  assert.match(route,/canAdvance,canRetryFailed/);
  assert.match(route,/blocker,providerStatus:progress/);
  assert.match(route,/retryReference:canRetryFailed/);
  assert.match(route,/isSameOriginDynamicCollectionRequest/);
  assert.match(route,/progressBlocker\(provider\)/);
  assert.match(ui,/disabled=\{running\|\|!queue.canAdvance\}/);
  assert.match(ui,/queue.blocker/);
  assert.match(ui,/response.status/);
  assert.match(ui,/setMessage\(reason\+' \(HTTP '/);
  assert.match(ui,/const current=await read\(\)/);
  assert.doesNotMatch(ui,/if\(!response.ok\)throw new Error\('Execução não autorizada'\)/);
});
