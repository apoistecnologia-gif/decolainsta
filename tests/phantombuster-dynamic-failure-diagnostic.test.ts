import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  classifyDynamicFailureOutput,inspectDynamicFailureOutput,
} from '../lib/providers/phantombuster-failure-diagnostic';

const container='3146485563440779';
test('recognize common failures without exposing provider text',()=>{
  const examples=[
    ['Session cookie has expired','session-invalid'],
    ['Instagram: challenge_required','login-challenge'],
    ['Invalid input URL','invalid-input'],
    ['This account is private','private-target'],
    ['Instagram feedback_required','platform-limited'],
    ['Workspace quota exceeded','workspace-limit'],
    ['Maximum execution time reached','execution-timeout'],
    ['TypeError: cannot read properties','runtime-error'],
    ['Operation ended without a reason','unknown'],
    ['','empty-output'],
  ] as const;
  for(const [log,expected] of examples)
    assert.equal(classifyDynamicFailureOutput(log),expected);
});
test('fetch-output reads exact container once, no launch and no secret disclosure',async()=>{
  const key='SUPER_PRIVATE_PROVIDER_KEY';
  let count=0;
  const result=await inspectDynamicFailureOutput(key,container,async(url,init)=>{
    count++;
    assert.equal(url,'https://api.phantombuster.com/api/v2/containers/fetch-output?id='+container+'&mode=raw');
    assert.equal(init?.method,'GET');
    assert.equal(init?.redirect,'error');
    assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],key);
    return new Response('Session cookie has expired: private_value=SHOULD_NOT_LEAK');
  });
  assert.equal(result,'session-invalid');
  assert.equal(count,1);
  assert.doesNotMatch(result,/private_value|SHOULD_NOT_LEAK|SUPER_PRIVATE/);
});
test('unknown, empty, unavailable and oversized logs fail closed',async()=>{
  const statuses=[
    [204,'empty-output'],
    [401,'provider-unavailable'],
    [403,'provider-unavailable'],
    [429,'provider-unavailable'],
    [500,'provider-unavailable'],
  ] as const;
  for(const [code,expected] of statuses)
    assert.equal(await inspectDynamicFailureOutput('key',container,async()=>new Response(null,{status:code})),expected);
  assert.equal(await inspectDynamicFailureOutput('key',container,async()=>new Response('a'.repeat(100000))),'output-too-large');
  let invoked=false;
  assert.equal(await inspectDynamicFailureOutput('key','invalid',async()=>{
    invoked=true;return new Response('');
  }),'provider-unavailable');
  assert.equal(invoked,false);
});
test('diagnostics available only on preview operator route for saved failed container',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/process.env.VERCEL_ENV!=='preview'/);
  assert.match(route,/user\?\.role!=='admin'/);
  assert.match(route,/activeProof\?\.reason==='failed-run'/);
  assert.match(route,/failureDiagnostic,canAdvance/);
  assert.match(route,/inspectDynamicFailureOutput\(key!,event.containerId\)/);
  assert.match(ui,/Indício no log da execução:/);
});
