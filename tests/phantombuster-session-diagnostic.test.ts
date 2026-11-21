import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  classifyPreviousPhantomOutput,
  inspectPreviousPhantomSessionErrors,
} from '../lib/providers/phantombuster-session-diagnostic';

test('session failures and challenges are only indications from previous execution logs',()=>{
  assert.equal(classifyPreviousPhantomOutput({data:{output:'Expired session cookie'}}),
    'session-error-observed');
  assert.equal(classifyPreviousPhantomOutput({data:{output:'Disconnected by Instagram, exiting...'}}),
    'session-error-observed');
  assert.equal(classifyPreviousPhantomOutput({output:'exit code: 87'}),
    'session-error-observed');
  assert.equal(classifyPreviousPhantomOutput({output:'Two-factor authentication required'}),
    'verification-required-observed');
  assert.equal(classifyPreviousPhantomOutput({output:'Instagram challenge required'}),
    'verification-required-observed');
  assert.equal(classifyPreviousPhantomOutput({data:{output:'Processed 2 profiles successfully'}}),
    'no-session-error-observed');
  assert.equal(classifyPreviousPhantomOutput({}), 'no-output');
  assert.equal(classifyPreviousPhantomOutput({resultObject:{
    username:'someone',log:'Expired session cookie'}}),'no-output');
});

test('one GET to saved agent output never exposes secrets or claims session currently valid',async()=>{
  let calls=0;
  const result=await inspectPreviousPhantomSessionErrors('SECRET_WORKSPACE_KEY',
    '1234567890123456',async(url,init)=>{
      calls++;
      assert.equal(new URL(url).pathname,'/api/v2/agents/fetch-output');
      assert.equal(new URL(url).searchParams.get('id'),'1234567890123456');
      assert.equal(init?.method,'GET');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.cache,'no-store');
      assert.equal(init?.credentials,'omit');
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],
        'SECRET_WORKSPACE_KEY');
      return Response.json({data:{output:
        'Error: Expired session cookie, sessionid=SECRET_COOKIE_VALUE'}});
    });
  assert.equal(calls,1);
  assert.deepEqual(result,{
    status:'session-error-observed',
    evidence:'previous_agent_output_only',
    instagramSessionVerifiedNow:false,
    passwordChangeImpactConfirmed:false,
    providerActionsExecuted:0,
  });
  assert.doesNotMatch(JSON.stringify(result),/SECRET|sessionid|agentId|username/);
});

test('provider and missing history are treated as unknown, no agent launch',async()=>{
  for(const [http,expected] of [
    [401,'invalid-key'],[403,'invalid-key'],[429,'rate-limited'],
    [404,'no-output'],[500,'unavailable'],
  ] as const) {
    const result=await inspectPreviousPhantomSessionErrors('key',
      '1234567890123456',async()=>new Response('{"output":"PASSWORD_SECRET"}',
        {status:http}));
    assert.equal(result.status,expected);
    assert.equal(result.instagramSessionVerifiedNow,false);
    assert.equal(result.providerActionsExecuted,0);
  }
  assert.equal((await inspectPreviousPhantomSessionErrors('key','bad_id',
    async()=>{throw Error('must not call');})).status,'invalid-agent');
  assert.equal((await inspectPreviousPhantomSessionErrors('key','1234567890123456',
    async()=>new Response('malformed-json',{status:200}))).status,'unavailable');
});

test('operator-only route is preview gated, protected, and contains no writes or user credentials',()=>{
  const route=readFileSync('app/api/operator/phantombuster-session-diagnostic/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV!=='preview'/);
  assert.match(route,/operator\?\.role!=='admin'/);
  assert.match(route,/PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID/);
  assert.match(route,/inspectPreviousPhantomSessionErrors/);
  assert.match(route,/passwordChangeImpactConfirmed:false/);
  assert.match(route,/providerActionsExecuted:0/);
  assert.doesNotMatch(route,/\.create\(|\.update\(|\.delete\(|launchSingleSocialAgent|agents\/launch|password:|sessionCookie:/);
  const page=readFileSync('app/(app)/references/_components/operator-collector-intake-panel.tsx','utf8');
  assert.match(page,/Verificar erros da sessão \(somente leitura\)/);
  assert.match(page,/\/api\/operator\/phantombuster-session-diagnostic/);
  assert.match(page,/Sessão atual: não verificada/);
});
