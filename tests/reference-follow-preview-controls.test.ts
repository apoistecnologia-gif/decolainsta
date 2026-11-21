import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  FOLLOW_PREVIEW_CONTROL_ACTION,makeFollowPreviewEvent,
  parseFollowPreviewEvent,transitionFollowPreview,countPreviewEligible,
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
  assert.match(s,/parseCandidateEvidence/);
  assert.match(s,/realFollowsEnabled:false,realUnfollowsEnabled:false/);
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
  assert.match(c,/disabled/);
  assert.match(panel,/FollowPreviewControls/);
  assert.doesNotMatch(c,/agents\/launch|user_follow|user_unfollow/);
});
