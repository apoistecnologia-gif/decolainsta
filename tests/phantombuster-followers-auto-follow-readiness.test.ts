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
