import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  inspectFollowersAutoFollowDocument, inspectFollowersAutoFollowAgent,
} from '../lib/providers/phantombuster-followers-auto-follow';

const id='1838046655144130';
const ref='mameto_lueji';
const agent=(arg:Record<string,unknown>={})=>({
  id, script:'Instagram Followers Auto Follow.js', launchType:'manually',
  argument:JSON.stringify({
    profileUrl:'https://www.instagram.com/mameto_lueji/',
    numberOfProfilesToFollow:1, ...arg,
  }),
});

test('verifies saved followers auto-follow agent is manual and one profile only',()=>{
  assert.equal(inspectFollowersAutoFollowDocument(agent(),id,ref),'matched');
  assert.equal(inspectFollowersAutoFollowDocument(agent(),id,'wrong_reference'),'wrong-reference');
  assert.equal(inspectFollowersAutoFollowDocument({...agent(),launchType:'repeatedly'},id,ref),'wrong-frequency');
  assert.equal(inspectFollowersAutoFollowDocument({...agent(),script:'Instagram Auto Follow.js'},id,ref),'wrong-agent-type');
  assert.equal(inspectFollowersAutoFollowDocument(agent({numberOfProfilesToFollow:20}),id,ref),'limit-not-one');
  assert.equal(inspectFollowersAutoFollowDocument(agent({numberOfProfilesToFollow:undefined}),id,ref),'limit-not-one');
  assert.equal(inspectFollowersAutoFollowDocument(agent({urls:['https://www.instagram.com/other/']}),id,ref),'ambiguous-input');
  assert.equal(inspectFollowersAutoFollowDocument(agent({spreadsheetUrl:'https://attacker.invalid/list.csv'}),id,ref),'ambiguous-input');
});

test('reads exactly one agent without launching, leaks no raw session or inputs',async()=>{
  const calls:string[]=[];
  const result=await inspectFollowersAutoFollowAgent('secret-api-key',id,ref,
    async(url,options)=>{
      calls.push(url);
      assert.equal(options?.method,'GET');
      assert.equal(options?.redirect,'error');
      assert.equal(options?.credentials,'omit');
      assert.ok(!url.includes('launch'));
      return new Response(JSON.stringify({data:{...agent(),
        sessionCookie:'DO_NOT_RETURN',
      }}),{status:200});
    });
  assert.equal(result,'matched');
  assert.equal(calls.length,1);
  assert.doesNotMatch(result,/DO_NOT_RETURN|secret-api-key/);
});

test('falls back only to single-agent inventory after missing detail response',async()=>{
  const requests:string[]=[];
  const result=await inspectFollowersAutoFollowAgent('key',id,ref,async url=>{
    requests.push(url);
    if(url.includes('/agents/fetch?'))return new Response('',{status:404});
    assert.ok(url.includes('agentIds='+id));
    return new Response(JSON.stringify({data:[agent()]}),{status:200});
  });
  assert.equal(result,'matched');
  assert.equal(requests.length,2);
});

test('provider refusal cannot cause retry, launch or disclosure',async()=>{
  let calls=0;
  const result=await inspectFollowersAutoFollowAgent('key',id,ref,
    async()=>{calls++;return new Response('private secret',{status:429});});
  assert.equal(result,'rate-limited');
  assert.equal(calls,1);
});

test('preview-only admin diagnostic has no social-action endpoints',()=>{
  const s=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  assert.match(s,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(s,/operator\?\.role !== 'admin'/);
  assert.match(s,/userId/);
  assert.match(s,/where:\{ username:accountUsername, userId \}/);
  assert.match(s,/instagramAccountId:account.id, username:referenceUsername/);
  assert.match(s,/agentLaunchEnabled:false/);
  assert.match(s,/sessionAccountVerifiedByProvider:false/);
  assert.doesNotMatch(s,/agents\/launch|agents\/save|user_follow\(/);
  const h=readFileSync('lib/providers/phantombuster-followers-auto-follow.ts','utf8');
  assert.match(h,/api\/v2\/agents\/fetch/);
  assert.doesNotMatch(h,/agents\/launch|agents\/save/);
});

test('reads private exclusion by exact manifest schema, never by guessed key',async()=>{
  const {readSavedPrivateFilter,inspectSavedPrivateFilter}=
    await import('../lib/providers/phantombuster-private-filter');
  const config={...agent({privateSwitch:true}),manifest:{
    argumentSchema:{properties:{privateSwitch:{
      type:'boolean',title:'Exclude private profiles',
    }}},
  }};
  assert.equal(readSavedPrivateFilter({data:config},id,ref),'enabled');
  assert.equal(readSavedPrivateFilter({data:{...config,
    argument:agent({privateSwitch:false}).argument}},id,ref),'disabled');
  assert.equal(readSavedPrivateFilter(agent({privateSwitch:true}),id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,manifest:{
    argumentSchema:{properties:{privateSwitch:{
      type:'string',title:'Exclude private profiles',
    }}},
  }},id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,manifest:{
    argumentSchema:{properties:{
      privateSwitch:{type:'boolean',title:'Exclude private profiles'},
      otherSwitch:{type:'boolean',title:'Exclude private profiles'},
    }},
  }},id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,
    script:'Instagram Auto Follow.js'},id,ref),'agent-mismatch');
  let requests=0;
  const status=await inspectSavedPrivateFilter('SECRET_API_KEY',id,ref,
    async(url,opts)=>{
      requests++;
      assert.equal(new URL(url).pathname,'/api/v2/agents/fetch');
      assert.equal(new URL(url).searchParams.get('withManifest'),'true');
      assert.equal(new URL(url).searchParams.get('withCode'),'false');
      assert.equal(opts?.method,'GET');
      assert.equal(opts?.redirect,'error');
      assert.equal(opts?.credentials,'omit');
      return new Response(JSON.stringify({data:{...config,
        sessionCookie:'DO_NOT_EXPOSE'}}),{status:200});
    });
  assert.equal(status,'enabled');
  assert.equal(requests,1);
  assert.doesNotMatch(status,/SECRET|COOKIE/);
});
test('explicitly typed checkbox can map an argument; unknown types cannot',async()=>{
  const {readSavedPrivateFilter}=await import(
    '../lib/providers/phantombuster-private-filter');
  const entry={...agent({privateSwitch:true}),manifest:{
    argumentForm:{steps:[{fields:[{
      label:'Exclude private profiles (optional)',
      inputType:'checkbox',name:'privateSwitch',
    }]}]},
  }};
  assert.equal(readSavedPrivateFilter(entry,id,ref),'enabled');
  assert.equal(readSavedPrivateFilter({...entry,manifest:{
    argumentForm:{steps:[{fields:[{
      label:'Exclude private profiles',inputType:'text',name:'privateSwitch',
    }]}]},
  }},id,ref),'unverified');
});
test('admin readiness and any future launch block unverified exclusion',()=>{
  const readiness=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  const runner=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(readiness,/privateExclusionVerified:/);
  assert.match(readiness,/settings:\{select:\{skipPrivateProfiles:true\}\}/);
  assert.match(runner,/ctx.account.settings\?\.skipPrivateProfiles===false/);
  assert.match(runner,/privateExclusion!=='enabled'/);
  assert.match(runner,/inspectSavedPrivateFilter/);
  const src=readFileSync('lib/providers/phantombuster-private-filter.ts','utf8');
  assert.match(src,/withManifest','true'/);
  assert.doesNotMatch(src,/agents\/launch|agents\/save/);
});
