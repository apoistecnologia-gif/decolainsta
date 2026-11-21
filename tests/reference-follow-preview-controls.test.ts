import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  FOLLOW_PREVIEW_CONTROL_ACTION,makeFollowPreviewEvent,
  parseFollowPreviewEvent,transitionFollowPreview,countPreviewEligible,
  planPreviewEligible,makePreviewDecision,parsePreviewDecision,
  resolvePreviewRun,FOLLOW_PREVIEW_DECISION_ACTION,FOLLOW_PREVIEW_BATCH_SIZE,
} from '../lib/reference-follow-preview-control';
import {makeCandidateEvidence} from '../lib/reference-candidate-queue';

test('follow controls persist only inert dry-run state transitions',()=>{
  assert.equal(FOLLOW_PREVIEW_CONTROL_ACTION,'reference_follow_preview_control_v1');
  const cases=[
    ['idle','start','simulating'],
    ['simulating','pause','paused'],
    ['paused','resume','simulating'],
    ['simulating','stop','stopped'],
    ['paused','stop','stopped'],
    ['stopped','start','simulating'],
  ] as const;
  for(const [before,operation,after] of cases)
    assert.equal(transitionFollowPreview(before,operation),after);
  assert.equal(transitionFollowPreview('idle','pause'),null);
  assert.equal(transitionFollowPreview('simulating','start'),null);
  assert.equal(transitionFollowPreview('paused','start'),null);
  assert.equal(transitionFollowPreview('stopped','resume'),null);
  const event=makeFollowPreviewEvent('paused',2,200,'2026-11-21T16:00:00.000Z');
  assert.ok(event);
  assert.deepEqual(parseFollowPreviewEvent(JSON.stringify(event)),event);
  assert.equal(parseFollowPreviewEvent(JSON.stringify({...event,realActionsExecuted:1})),null);
  assert.equal(parseFollowPreviewEvent(JSON.stringify({...event,apiKey:'secret'})),null);
});
test('eligible count ignores orphaned candidates, whitelist and previous follows',()=>{
  const refs=[{id:'ref1',username:'ammplamob'},{id:'ref2',username:'prefeituradepetrolina'}];
  const make=(id:string,refName:string,name:string)=>({
    targetUsername:name,
    details:JSON.stringify(makeCandidateEvidence(id,refName,'snap1','6405192514345545')),
  });
  const result=countPreviewEligible([
    make('ref1','ammplamob','alice'),make('ref1','ammplamob','alice'),
    make('ref1','ammplamob','whitelisted'),
    make('ref2','prefeituradepetrolina','previouslyfollowed'),
    make('ref1','ammplamob','apoistecnologia'),
    make('ref1','ammplamob','ammplamob'),
    make('deleted','old','orphaned'),
    {targetUsername:'tampered',details:JSON.stringify({status:'followed'})},
  ],refs,'apoistecnologia',['whitelisted'],['previouslyfollowed']);
  assert.deepEqual(result,{eligible:1,excluded:4,indexed:5});
});
test('server controls are account scoped, preview only, serializable and never call Instagram',()=>{
  const s=readFileSync('app/api/operator/reference-follow-preview/route.ts','utf8');
  assert.match(s,/process\.env\.VERCEL_ENV==='preview'/);
  assert.match(s,/await auth\(\)/);
  assert.match(s,/where:\{id:accountId,userId\}/);
  assert.match(s,/origin'\)!==new URL\(request\.url\)\.origin/);
  assert.match(s,/FOLLOW_PREVIEW_CONTROL_ACTION/);
  assert.match(s,/pg_try_advisory_xact_lock/);
  assert.match(s,/Prisma.TransactionIsolationLevel.Serializable/);
  const helper=readFileSync('lib/reference-follow-preview-control.ts','utf8');
  assert.match(helper,/parseCandidateEvidence/);
  assert.match(s,/realFollowsEnabled:false,realUnfollowsEnabled:false/);
  assert.match(s,/where:\{instagramAccountId:account\.id\}/);
  assert.doesNotMatch(s,/where:\{instagramAccountId:account\.id,enabled:true\}/);
  assert.doesNotMatch(s,/agents\/launch|user_follow|user_unfollow|followAction\.create|followAction\.update|fetch\('https:\/\//);
});
test('preview UI distinguishes simulated start and disabled real follow',()=>{
  const c=readFileSync('app/(app)/references/_components/follow-preview-controls.tsx','utf8');
  const panel=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  assert.match(c,/Iniciar teste de seguir/);
  assert.match(c,/Pausar teste/);
  assert.match(c,/Retomar teste/);
  assert.match(c,/Parar teste/);
  assert.match(c,/Começar a seguir de verdade/);
  assert.match(c,/Elegíveis apenas para simulação/);
  assert.match(c,/disabled/);
  assert.match(panel,/FollowPreviewControls/);
  assert.doesNotMatch(c,/agents\/launch|user_follow|user_unfollow/);
});

test('simulation candidate count does not depend on flags that guard real actions',()=>{
  // The registration endpoint intentionally sets enabled:false for all
  // references; read-only candidate source matching must still work.
  const refs=[{id:'r1',username:'ammplamob',enabled:false}];
  const rows=[{targetUsername:'candidate_from_reference',
    details:JSON.stringify(makeCandidateEvidence('r1','ammplamob',
      'snapshot1','6405192514345545'))}];
  assert.deepEqual(countPreviewEligible(rows,refs,'apoistecnologia',[],[]),
    {eligible:1,excluded:0,indexed:1});
  const registration=readFileSync('app/api/instagram-accounts/[id]/targets/route.ts','utf8');
  assert.match(registration,/enabled: false/);
});

test('batch planner selects indexed candidates deterministically across references',()=>{
  const refs=[{id:'ref1',username:'ammplamob'},
    {id:'ref2',username:'prefeituradepetrolina'}];
  const row=(id:string,name:string,refName:string)=>({
    targetUsername:name,
    details:JSON.stringify(makeCandidateEvidence(id,refName,
      'snapshot_valid','6405192514345545')),
  });
  const data=[
    row('ref2','zoe','prefeituradepetrolina'),
    row('ref1','carol','ammplamob'),
    row('ref1','alice','ammplamob'),
    row('ref2','bob','prefeituradepetrolina'),
    row('ref1','alice','ammplamob'),
    row('removed','orphan','old'),
    row('ref1','protected','ammplamob'),
    row('ref1','apoistecnologia','ammplamob'),
    row('ref2','previous','prefeituradepetrolina'),
  ];
  const options=planPreviewEligible(data,refs,'apoistecnologia',
    ['protected'],['previous']);
  assert.deepEqual(options.candidates.map(x=>x.username),
    ['alice','bob','carol','zoe']);
  assert.equal(options.indexed,7);
  assert.equal(options.excluded,3);
  const reverse=planPreviewEligible([...data].reverse(),refs,'apoistecnologia',
    ['protected'],['previous']);
  assert.deepEqual(reverse.candidates,options.candidates);
});
test('strict simulation decision receipt rejects real-action or extra data',()=>{
  assert.equal(FOLLOW_PREVIEW_DECISION_ACTION,'reference_follow_preview_decision_v1');
  assert.equal(FOLLOW_PREVIEW_BATCH_SIZE,5);
  const event=makePreviewDecision('run1','ref1','ammplamob');
  assert.ok(event);
  assert.equal(event.realActionsExecuted,0);
  assert.deepEqual(parsePreviewDecision(JSON.stringify(event)),event);
  assert.equal(parsePreviewDecision(JSON.stringify({...event,realActionsExecuted:1})),null);
  assert.equal(parsePreviewDecision(JSON.stringify({...event,mode:'live'})),null);
  assert.equal(parsePreviewDecision(JSON.stringify({...event,token:'secret'})),null);
});
test('pause/resume share run ID, stop/start create a new run',()=>{
  const state=(st:'simulating'|'paused'|'stopped',revision:number)=>
    JSON.stringify(makeFollowPreviewEvent(st,revision,5,
      '2026-11-21T20:00:00Z'));
  const steps=[
    {id:'run1',details:state('simulating',1)},
    {id:'pause1',details:state('paused',2)},
    {id:'resume1',details:state('simulating',3)},
  ];
  assert.deepEqual(resolvePreviewRun(steps),{
    state:'simulating',runId:'run1',revision:3});
  assert.deepEqual(resolvePreviewRun([...steps,
    {id:'stop1',details:state('stopped',4)}]),{
    state:'stopped',runId:'run1',revision:4});
  assert.deepEqual(resolvePreviewRun([...steps,
    {id:'stop1',details:state('stopped',4)},
    {id:'run2',details:state('simulating',5)}]),{
    state:'simulating',runId:'run2',revision:5});
  assert.equal(resolvePreviewRun([...steps,
    {id:'unknown',details:state('simulating',7)}]),null);
  assert.equal(resolvePreviewRun([{id:'bad',details:'{"fake":true}'}]),null);
});
test('batch operation is account-scoped, deduplicated and does not contact Instagram',()=>{
  const api=readFileSync('app/api/operator/reference-follow-preview/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/follow-preview-controls.tsx','utf8');
  assert.match(api,/operation==='tick'/);
  assert.match(api,/if\(run\.state!=='simulating'\|\|!run\.runId\)/);
  assert.match(api,/const pending=counts\.candidates\.filter/);
  assert.match(api,/!summary\.used\.has\(x\.username\)/);
  assert.match(api,/slice\(0,FOLLOW_PREVIEW_BATCH_SIZE\)/);
  assert.match(api,/FOLLOW_PREVIEW_BATCH_MIN_MS/);
  assert.match(api,/action:FOLLOW_PREVIEW_DECISION_ACTION/);
  assert.match(api,/readRunDecisions\(tx,account\.id,run\.runId\)/);
  assert.match(api,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(ui,/operation:'tick'/);
  assert.match(ui,/document\.visibilityState!=='visible'/);
  assert.match(ui,/window\.clearInterval\(interval\)/);
  assert.match(ui,/Processados na simulação/);
  assert.match(ui,/aria-valuenow=\{view\.simulatedCount\}/);
  assert.doesNotMatch(api,/agents\/launch|user_follow|user_unfollow|fetch\('https:\/\//);
  assert.doesNotMatch(ui,/agents\/launch|user_follow|user_unfollow/);
});

test('real follow readiness lists explicit blockers without activating the executor',()=>{
  const api=readFileSync('app/api/operator/reference-follow-preview/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/follow-preview-controls.tsx','utf8');
  for(const id of ['instagram-restriction','session-identity','recipient-control',
    'privacy-verification','validated-executor'])
    assert.ok(api.includes("id:'"+id+"'"));
  assert.match(api,/realActivation:\{/);
  assert.match(api,/available:false/);
  assert.match(api,/liveFollowAvailable:false,instagramActionsExecuted:0/);
  assert.match(ui,/O que falta para habilitar o seguir real\?/);
  assert.match(ui,/view\.realActivation\.checks\.map/);
  assert.match(ui,/Começar a seguir de verdade/);
  assert.match(ui,/variant="outline" disabled/);
  assert.doesNotMatch(api,/launchFollowersTrial\(|user_follow|followAction\.create/);
});
