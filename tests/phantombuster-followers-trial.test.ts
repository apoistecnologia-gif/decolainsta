import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  FOLLOWERS_TRIAL_ACTION,makeTrialEvidence,parseTrialEvidence,
  FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION,
  FOLLOWERS_PRIVACY_OBSERVATION_ACTION,
  shouldStartUnfollowClock,observedRelationship,
} from '../lib/reference-followers-trial';
import {
  launchFollowersTrial,inspectTrialContainer,parseTrialContainer,
  parseAgentScopedContainer,
} from '../lib/providers/phantombuster-followers-trial';
import {
  parseSingleRunProfile,parseSingleRunProfileEvidence,
  parseReportedFollowSummary,fetchFollowersRunReport,fetchSavedRunPrivacy,
} from '../lib/providers/phantombuster-followers-result';
const agent='1838046655144130',container='1234567890123';
test('one-shot launch sends only one controlled launch and never returns follower identities',async()=>{
  let n=0;
  const result=await launchFollowersTrial('sensitive-api-key',agent,async(url,options)=>{
    n++;
    assert.equal(url,'https://api.phantombuster.com/api/v2/agents/launch');
    assert.equal(options?.method,'POST');
    assert.equal(options?.redirect,'error');
    assert.equal(options?.credentials,'omit');
    assert.deepEqual(JSON.parse(String(options?.body)),
      {id:agent,manualLaunch:true,maxInstanceCount:1});
    return new Response(JSON.stringify({data:{containerId:container,
      cookie:'PRIVATE'}}),{status:200});
  });
  assert.deepEqual(result,{status:'accepted',containerId:container});
  assert.equal(n,1);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|sensitive-api-key/);
});
test('ambiguous and rate-limited launch results cannot retry',async()=>{
  let n=0;
  const result=await launchFollowersTrial('key',agent,async()=>{
    n++;throw Error('SESSION_COOKIE_SHOULD_NOT_LEAK');
  });
  assert.equal(n,1);assert.deepEqual(result,{status:'uncertain'});
  const limited=await launchFollowersTrial('key',agent,
    async()=>new Response('hidden',{status:429}));
  assert.equal(limited.status,'rate-limited');
});
test('container completion never becomes proof of a follow',async()=>{
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:0,
  }},agent,container),'finished');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:1,
  }},agent,container),'failed');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:agent,exitCode:null,
  }},agent,container),'in-progress');
  assert.equal(parseTrialContainer({data:{
    id:container,agentId:'11111111111111',exitCode:0,
  }},agent,container),'mismatch');
  let n=0;
  const outcome=await inspectTrialContainer('key',agent,container,async(url,options)=>{
    n++;
    assert.ok(url.includes('containers/fetch?'));
    assert.equal(options?.method,'GET');
    return new Response(JSON.stringify({id:container,agentId:agent,exitCode:0,
      result:{sessionCookie:'DO_NOT_LEAK'}}),{status:200});
  });
  assert.equal(n,1);assert.equal(outcome,'finished');
});
test('missing agentId in container detail does not mean wrong agent',()=>{
  assert.equal(parseTrialContainer({data:{
    id:container,exitCode:0,
  }},agent,container),'membership-unverified');
  assert.equal(parseTrialContainer({data:{
    containerId:container,exitCode:0,
  }},agent,container),'membership-unverified');
  assert.equal(parseAgentScopedContainer({data:[
    {id:container,exitCode:0},
    {id:'9876543219876',exitCode:1},
  ]},agent,container,{data:{id:container,exitCode:0}}),'finished');
  assert.equal(parseAgentScopedContainer({data:[
    {id:'9876543219876',exitCode:0},
  ]},agent,container,{data:{id:container,exitCode:0}}),
  'membership-unverified');
  assert.equal(parseAgentScopedContainer({data:[
    {id:container,agentId:'9876543219876',exitCode:0},
  ]},agent,container,{data:{id:container,exitCode:0}}),'mismatch');
});

test('uses only read-only agent-scoped history if detail has no agentId',async()=>{
  const urls:string[]=[];
  const outcome=await inspectTrialContainer('key',agent,container,async(url,options)=>{
    urls.push(url);
    assert.equal(options?.method,'GET');
    assert.equal(options?.credentials,'omit');
    assert.equal(options?.redirect,'error');
    if(url.includes('/containers/fetch?'))
      return new Response(JSON.stringify({data:{id:container,exitCode:0,
        sessionCookie:'SECRET_NEVER_OUTPUT'}}),{status:200});
    const u=new URL(url);
    assert.equal(u.pathname,'/api/v2/containers/fetch-all');
    assert.equal(u.searchParams.get('agentId'),agent);
    assert.equal(u.searchParams.get('mode'),'all');
    return new Response(JSON.stringify({data:[{id:container}]}),{status:200});
  });
  assert.deepEqual(urls.length,2);
  assert.equal(outcome,'finished');
  assert.doesNotMatch(outcome,/SECRET_NEVER_OUTPUT/);
});
test('fails closed on wrong membership or unavailable history',async()=>{
  const cases=[
    {data:[{id:'9999999999999'}]}, {data:[{id:container,agentId:'9999999999999'}]},
    {data:[{id:container},{id:container}]}, {data:{unsupported:1}},
  ];
  for(const payload of cases){
    const r=await inspectTrialContainer('key',agent,container,async url=>
      new Response(JSON.stringify(url.includes('/fetch?')
        ? {data:{id:container,exitCode:0}} : payload),{status:200}));
    assert.ok(r==='membership-unverified'||r==='mismatch');
    assert.notEqual(r,'finished');
  }
  let n=0;
  const unavailable=await inspectTrialContainer('key',agent,container,async url=>{
    n++;
    return new Response(url.includes('/fetch?')
      ? JSON.stringify({id:container,exitCode:0}) : 'private provider error',
      {status:url.includes('/fetch?')?200:503});
  });
  assert.equal(unavailable,'membership-unverified');
  assert.equal(n,2);
});
test('only exact single run result matching reference is eligible',()=>{
  const row={profileUrl:'https://instagram.com/dellmyra_souza/',
    profileName:'dellmyra_souza',query:'https://www.instagram.com/mameto_lueji/',
    sessionCookie:'SENSITIVE_NO_RETURN'};
  assert.equal(parseSingleRunProfile({resultObject:[row]},'mameto_lueji'),
    'dellmyra_souza');
  assert.equal(parseSingleRunProfile({data:{resultObject:[row]}},'mameto_lueji'),
    'dellmyra_souza');
  assert.equal(parseSingleRunProfile({resultObject:[row,row]},'mameto_lueji'),null);
  assert.equal(parseSingleRunProfile({resultObject:[{...row,
    query:'https://www.instagram.com/other_reference/'}]},'mameto_lueji'),null);
  assert.equal(parseSingleRunProfile({resultObject:[{...row,
    profileName:'other'}]},'mameto_lueji'),null);
  assert.equal(parseSingleRunProfile({resultObject:[{...row,
    profileUrl:'https://instagram.com.evil.invalid/dellmyra_souza/'}]},
    'mameto_lueji'),null);
});
test('provider report requires matching single run result and explicit follow summary',async()=>{
  const urls:string[]=[];
  const row={profileUrl:'https://instagram.com/dellmyra_souza/',
    profileName:'dellmyra_souza',query:'https://www.instagram.com/mameto_lueji/'};
  const result=await fetchFollowersRunReport('secret',container,'mameto_lueji',
    async(url,opts)=>{
      urls.push(url);
      assert.equal(opts?.method,'GET');
      assert.equal(opts?.credentials,'omit');
      assert.equal(opts?.redirect,'error');
      if(url.includes('fetch-result-object'))
        return new Response(JSON.stringify({resultObject:[row]}),{status:200});
      return new Response(JSON.stringify({output:'Successful authentication\n1 profile followed'}),{status:200});
    });
  assert.equal(urls.length,2);
  assert.ok(urls.every(url=>new URL(url).searchParams.get('id')===container));
  assert.deepEqual(result,{status:'provider-reported',
    username:'dellmyra_souza',reportedCount:1});
  assert.doesNotMatch(JSON.stringify(result),/secret|Successful authentication/);
  assert.equal(parseReportedFollowSummary({output:'1 profile followed'}),true);
  assert.equal(parseReportedFollowSummary({output:'0 profiles followed'}),false);
  assert.equal(parseReportedFollowSummary({output:'5 profiles followed'}),false);
});
test('empty or unsubstantiated output never counts as a follow',async()=>{
  const row={profileUrl:'https://instagram.com/dellmyra_souza/',
    profileName:'dellmyra_souza',query:'https://www.instagram.com/mameto_lueji/'};
  const report=await fetchFollowersRunReport('secret',container,'mameto_lueji',
    async(url)=>new Response(JSON.stringify(url.includes('fetch-result-object')
      ? {resultObject:[row]} : {output:'No profiles followed'}),{status:200}));
  assert.deepEqual(report,{status:'result-only',
    username:'dellmyra_souza',reportedCount:1});
  const absent=await fetchFollowersRunReport('secret',container,'mameto_lueji',
    async()=>new Response(JSON.stringify({resultObject:[]}),{status:200}));
  assert.deepEqual(absent,{status:'none'});
});
test('audit record never fabricates target username or follow success',()=>{
  assert.equal(FOLLOWERS_TRIAL_ACTION,'reference_followers_trial_v1');
  const evidence=makeTrialEvidence({
    version:1,referenceId:'refA',agentId:agent,stage:'reserved',
    followConfirmed:false,sessionOwnerVerifiedByProvider:false,recipientKnown:false,
  });
  assert.ok(evidence);
  assert.deepEqual(parseTrialEvidence(JSON.stringify(evidence)),evidence);
  assert.equal(parseTrialEvidence(JSON.stringify({...evidence,followConfirmed:true})),null);
  assert.equal(parseTrialEvidence('sessioncookie'),null);
  const providerRecord=makeTrialEvidence({...evidence,
    stage:'provider-reported',containerId:container,
    providerReportedUsername:'dellmyra_souza',providerReportedCount:1});
  assert.equal(providerRecord?.followConfirmed,false);
  assert.equal(parseTrialEvidence(JSON.stringify(providerRecord))?.providerReportedUsername,
    'dellmyra_souza');
  assert.equal(parseTrialEvidence(JSON.stringify({...providerRecord!,
    followConfirmed:true})),null);
  assert.equal(makeTrialEvidence({...evidence,
    stage:'provider-reported',containerId:container}),null);
});
test('pending private-profile request never starts a follow or 48-hour timer',()=>{
  assert.equal(FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION,
    'reference_followers_relationship_observation_v1');
  assert.equal(observedRelationship('requested'),true);
  assert.equal(observedRelationship('following'),true);
  assert.equal(observedRelationship('none'),true);
  assert.equal(observedRelationship('unknown'),false);
  assert.equal(shouldStartUnfollowClock({
    relationship:'requested',verifiedFollowAt:new Date(),
  }),false);
  assert.equal(shouldStartUnfollowClock({
    relationship:'following',verifiedFollowAt:null,
  }),false);
  assert.equal(shouldStartUnfollowClock({
    relationship:'following',verifiedFollowAt:new Date('2026-11-20T16:00:00.000Z'),
  }),true);
  const base=makeTrialEvidence({
    version:1,referenceId:'refA',agentId:agent,
    containerId:container,stage:'provider-reported',
    providerReportedUsername:'dellmyra_souza',providerReportedCount:1,
    followConfirmed:false,sessionOwnerVerifiedByProvider:false,recipientKnown:false,
  });
  assert.ok(base);
  const pending=makeTrialEvidence({...base!,
    relationshipObservation:'requested',relationshipSource:'owner-visual-check',
    relationshipObservedAt:'2026-11-20T20:00:00.000Z'});
  assert.ok(pending);
  assert.equal(pending?.followConfirmed,false);
  assert.equal(parseTrialEvidence(JSON.stringify(pending))?.relationshipObservation,
    'requested');
  assert.equal(makeTrialEvidence({...base!,
    relationshipObservation:'requested'}),null);
  assert.equal(makeTrialEvidence({...base!,stage:'launch-accepted',
    providerReportedUsername:undefined,providerReportedCount:undefined,
    relationshipObservation:'requested',relationshipSource:'owner-visual-check',
    relationshipObservedAt:'2026-11-20T20:00:00.000Z'}),null);
  assert.equal(parseTrialEvidence(JSON.stringify({...pending,
    relationshipSource:'external-script'})),null);
});
test('operator manual relationship observation is bounded and auditable',()=>{
  const src=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(src,/operation==='record-relationship'/);
  assert.match(src,/observedRelationship\(input.observedStatus\)/);
  assert.match(src,/evidence.stage!=='provider-reported'/);
  assert.match(src,/tx.activityLog.updateMany/);
  assert.match(src,/FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION/);
  assert.match(src,/source:'owner-visual-check'/);
  assert.match(src,/unfollowEligibleAt:null/);
  assert.doesNotMatch(src,/unfollowedAt:|unfollowScheduledAt:/);
});
test('route is admin Preview only, idempotent and separate from read-only cron',()=>{
  const route=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  for(const token of [
    "process.env.VERCEL_ENV!=='preview'",
    "PHANTOMBUSTER_FOLLOWERS_ONE_SHOT_ENABLED",
    "FOLLOWERS_TRIAL_APPROVAL",
    "req.headers.get('origin')",
    "user?.role!=='admin'",
    "userId:uid",
    "instagramAccountId:account.id",
    "tx.activityLog.count(",
    "pg_advisory_xact_lock",
    "Prisma.TransactionIsolationLevel.Serializable",
    "stage:'reserved'",
    "followConfirmed:false",
    "unfollowScheduled:false",
  ])assert.ok(route.includes(token),token);
  assert.doesNotMatch(route,/user_unfollow|agents\/save|sessionCookie/);
  assert.match(route,/launchFollowersTrial/);
  assert.match(route,/inspectTrialContainer/);
});

test('provider privacy field is evidence, missing field is unknown, not public',async()=>{
  const row={profileUrl:'https://instagram.com/public_example/',
    profileName:'public_example',query:'https://instagram.com/mameto_lueji/',
    isPrivate:false};
  assert.deepEqual(parseSingleRunProfileEvidence({resultObject:[row]},
    'mameto_lueji'),{username:'public_example',isPrivate:false});
  assert.deepEqual(parseSingleRunProfileEvidence({resultObject:[{
    ...row,isPrivate:true}]},'mameto_lueji'),
    {username:'public_example',isPrivate:true});
  assert.deepEqual(parseSingleRunProfileEvidence({resultObject:[{
    ...row,isPrivate:'false'}]},'mameto_lueji'),
    {username:'public_example'});
  const report=await fetchFollowersRunReport('key',container,'mameto_lueji',
    async url=>new Response(JSON.stringify(url.includes('fetch-result-object')
      ? {resultObject:[row]} : {output:'1 profile followed'}),{status:200}));
  assert.deepEqual(report,{status:'provider-reported',
    username:'public_example',reportedCount:1,isPrivate:false});
  const legacy=makeTrialEvidence({version:1,referenceId:'refA',
    agentId:agent,containerId:container,stage:'provider-reported',
    providerReportedUsername:'public_example',providerReportedCount:1,
    followConfirmed:false,recipientKnown:false,
    sessionOwnerVerifiedByProvider:false});
  assert.ok(legacy);
  assert.ok(parseTrialEvidence(JSON.stringify(legacy)));
  const priv=makeTrialEvidence({...legacy!,providerReportedPrivate:false,
    providerPrivacyReadAt:'2026-11-20T21:00:00.000Z'});
  assert.ok(priv);
  assert.equal(parseTrialEvidence(JSON.stringify(priv))?.providerReportedPrivate,false);
  assert.equal(makeTrialEvidence({...legacy!,
    providerReportedPrivate:false}),null);
  assert.equal(parseTrialEvidence(JSON.stringify({...legacy!,
    providerReportedPrivate:'false',
    providerPrivacyReadAt:'2026-11-20T21:00:00.000Z'})),null);
  const route=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(route,/providerReportedPrivate:report.isPrivate/);
  assert.match(route,/providerPrivacyReadAt:new Date\(\).toISOString\(\)/);
  assert.match(route,/followConfirmed:false/);
});


test('saved-run privacy looks up only its container and never launches',async()=>{
  let calls=0;
  const result=await fetchSavedRunPrivacy('secret',container,'mameto_lueji',
    async(url,opts)=>{
      calls++;
      assert.equal(new URL(url).pathname,
        '/api/v2/containers/fetch-result-object');
      assert.equal(new URL(url).searchParams.get('id'),container);
      assert.equal(opts?.method,'GET');
      assert.equal(opts?.redirect,'error');
      assert.equal(opts?.credentials,'omit');
      return new Response(JSON.stringify({resultObject:[{
        profileUrl:'https://instagram.com/dellmyra_souza/',
        profileName:'dellmyra_souza',
        query:'https://instagram.com/mameto_lueji/',
        isPrivate:true,sessionCookie:'SECRET_SHOULD_NOT_LEAK',
      }]}),{status:200});
    });
  assert.equal(calls,1);
  assert.deepEqual(result,{status:'reported',
    username:'dellmyra_souza',isPrivate:true});
  assert.doesNotMatch(JSON.stringify(result),/SECRET_SHOULD_NOT_LEAK|secret/);
});
test('missing/ambiguous/invalid provider privacy never means public',async()=>{
  const row={profileUrl:'https://instagram.com/dellmyra_souza/',
    profileName:'dellmyra_souza',query:'https://instagram.com/mameto_lueji/'};
  for(const [body,wanted] of [
    [{resultObject:[row]},'missing'],
    [{resultObject:[{...row,isPrivate:'false'}]},'missing'],
    [{resultObject:[{...row,isPrivate:true},{...row,isPrivate:false}]},'ambiguous'],
    [{resultObject:[{...row,profileName:'other',isPrivate:false}]},'ambiguous'],
  ] as const){
    const r=await fetchSavedRunPrivacy('key',container,'mameto_lueji',
      async()=>new Response(JSON.stringify(body),{status:200}));
    assert.equal(r.status,wanted);
  }
  const limited=await fetchSavedRunPrivacy('key',container,'mameto_lueji',
    async()=>new Response('rate limited',{status:429}));
  assert.deepEqual(limited,{status:'rate-limited'});
});
test('privacy backfill is an admin-only CAS update with a separate audit entry',()=>{
  assert.equal(FOLLOWERS_PRIVACY_OBSERVATION_ACTION,
    'reference_followers_privacy_observation_v1');
  const src=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(src,/operation==='check-profile-privacy'/);
  assert.match(src,/evidence.stage!=='provider-reported'/);
  assert.match(src,/reported.username!==evidence.providerReportedUsername/);
  assert.match(src,/tx.activityLog.updateMany/);
  assert.match(src,/FOLLOWERS_PRIVACY_OBSERVATION_ACTION/);
  assert.match(src,/source:'phantombuster-saved-run'/);
  assert.match(src,/followConfirmed:false,unfollowScheduled:false/);
  assert.doesNotMatch(src,/agents\/save|unfollowScheduledAt:|unfollowedAt:/);
});

test('follow-back observation requires a currently observed following relation',()=>{
  const current=makeTrialEvidence({version:1,referenceId:'refA',
    agentId:agent,containerId:container,stage:'provider-reported',
    providerReportedUsername:'dellmyra_souza',providerReportedCount:1,
    followConfirmed:false,recipientKnown:false,
    sessionOwnerVerifiedByProvider:false,
    relationshipObservation:'following',relationshipSource:'owner-visual-check',
    relationshipObservedAt:'2026-11-20T20:52:59.170Z',
    followBackObservation:'yes',followBackSource:'owner-visual-check',
    followBackObservedAt:'2026-11-20T21:52:59.170Z'});
  assert.ok(current);
  assert.deepEqual(parseTrialEvidence(JSON.stringify(current)),current);
  assert.equal(makeTrialEvidence({...current!,relationshipObservation:'requested'}),null);
  assert.equal(makeTrialEvidence({...current!,relationshipObservation:'none'}),null);
  assert.equal(makeTrialEvidence({...current!,followBackSource:undefined}),null);
  assert.equal(makeTrialEvidence({...current!,followBackObservedAt:'invalid'}),null);
});
test('follow-back input is account scoped, audited and never triggers Instagram',()=>{
  const src=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  for(const token of [
    "operation==='record-followback'",'observedFollowBack(input.followBackStatus)',
    'FOLLOWERS_FOLLOWBACK_OBSERVATION_ACTION',
    "evidence.relationshipObservation!=='following'",
    'followBackObservation:undefined',
    'followConfirmed:false,unfollowEligibleAt:null',
    'tx.activityLog.updateMany',
  ])assert.ok(src.includes(token),token);
  assert.match(src,/assessUnfollowEligibility/);
  assert.doesNotMatch(src,/user_unfollow|unfollowScheduledAt:|unfollowedAt:/);
});
