import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  makePilotAction,parsePilotAction,mayReviewUnfollow,
  SOCIAL_PILOT_UNFOLLOW_AFTER_HOURS,
} from '../lib/reference-social-pilot';
import {
  inspectSocialAgentDocument,launchSingleSocialAgent,
} from '../lib/providers/phantombuster-social-pilot';

const agentId='123456789012345';
const configured=(extra:Record<string,unknown>={})=>({
  id:agentId,script:'Instagram Auto Follow.js',launchType:'manually',
  argument:JSON.stringify({
    profileUrl:'https://www.instagram.com/testcandidate/',
    numberOfProfilesToFollow:1,...extra,
  }),
});
test('provider follow agent must be a single explicitly saved recipient',()=>{
  assert.equal(inspectSocialAgentDocument(configured(),agentId,'testcandidate','follow'),'matched');
  assert.equal(inspectSocialAgentDocument(configured({numberOfProfilesToFollow:20}),agentId,'testcandidate','follow'),'mismatch');
  assert.equal(inspectSocialAgentDocument(configured({spreadsheetUrl:'https://evil.example/list.csv'}),agentId,'testcandidate','follow'),'mismatch');
  assert.equal(inspectSocialAgentDocument(configured(),agentId,'someoneelse','follow'),'mismatch');
  assert.equal(inspectSocialAgentDocument(configured(),agentId,'testcandidate','unfollow'),'mismatch');
  assert.equal(inspectSocialAgentDocument({...configured(),launchType:'repeatedly'},agentId,'testcandidate','follow'),'mismatch');
});
test('launch sends only agent id and does not claim action succeeded',async()=>{
  let calls=0;
  const result=await launchSingleSocialAgent('test-api-key',agentId,async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.phantombuster.com/api/v2/agents/launch');
    assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(String(init?.body)),{id:agentId});
    assert.equal(init?.redirect,'error');
    assert.equal(init?.credentials,'omit');
    return new Response(JSON.stringify({containerId:'987654321012345'}),{status:200});
  });
  assert.equal(calls,1);
  assert.deepEqual(result,{status:'accepted',containerId:'987654321012345'});
  assert.equal((await launchSingleSocialAgent('key',agentId,
    async()=>new Response('no',{status:429})).status,'rate-limited');
  assert.equal((await launchSingleSocialAgent('key',agentId,
    async()=>{throw Error('private-cookie');})).status,'uncertain');
});
test('only a real completed run can make an action confirmed',()=>{
  const record={version:1 as const,action:'follow' as const,referenceId:'ref01',
    agentId,stage:'requested' as const,proof:'provider_unverified' as const};
  const valid=makePilotAction(record);
  assert.ok(valid);
  assert.deepEqual(parsePilotAction(JSON.stringify(valid)),valid);
  assert.equal(makePilotAction({...record,stage:'confirmed'}),null);
  assert.equal(parsePilotAction('{malformed'),null);
});
test('48-hour unfollow evaluation is never authorized by time alone',()=>{
  const at=new Date('2026-11-20T10:00:00Z');
  const now=new Date('2026-11-22T10:00:00Z');
  assert.equal(SOCIAL_PILOT_UNFOLLOW_AFTER_HOURS,48);
  const props={followConfirmedAt:at,now,relationship:'unknown' as const,
    whitelisted:false};
  assert.equal(mayReviewUnfollow(props),false);
  assert.equal(mayReviewUnfollow({...props,relationship:'follows-back'}),false);
  assert.equal(mayReviewUnfollow({...props,relationship:'does-not-follow-back'}),true);
  assert.equal(mayReviewUnfollow({...props,relationship:'does-not-follow-back',whitelisted:true}),false);
  assert.equal(mayReviewUnfollow({...props,relationship:'does-not-follow-back',
    now:new Date(now.getTime()-1)}),false);
});
test('test endpoint remains preview-only, fully opt-in and one-shot',()=>{
  const source=readFileSync('app/api/operator/social-pilot/route.ts','utf8');
  for(const token of [
    "process.env.VERCEL_ENV!=='preview'",
    "PHANTOMBUSTER_SOCIAL_PILOT_ENABLED",
    'SOCIAL_PILOT_FOLLOW_CONFIRMATION',
    'tx.activityLog.count(',
    'Prisma.TransactionIsolationLevel.Serializable',
    'instagramUserId:{not:null}',
    'userId:operatorId',
    'parseCandidateEvidence',
    'prisma.whitelist.findUnique',
    "stage:'requested'",
    "followConfirmed:false",
    'mayRetryAutomatically:false',
  ])assert.ok(source.includes(token),token);
  assert.ok(!source.includes('user_follow('));
  assert.ok(!source.includes('user_unfollow('));
});
