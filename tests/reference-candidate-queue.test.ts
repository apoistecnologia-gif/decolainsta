import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AUDIENCE_CANDIDATE_ACTION, MAX_CANDIDATES_PER_ACCOUNT,
  makeCandidateEvidence, parseCandidateEvidence, planCandidateIndex,
} from '../lib/reference-candidate-queue';
import { makeAudienceSnapshot } from '../lib/reference-audience-history';

function snapshot(id: string, referenceId: string, referenceUsername: string,
  usernames: string[], time = '2026-11-19T10:00:00.000Z') {
  return {
    id, targetUsername: referenceUsername, createdAt: new Date(time),
    details: JSON.stringify(makeAudienceSnapshot(referenceId, referenceUsername,
      '6396548176148717', usernames, 'completed_run')),
  };
}

test('candidate evidence only permits allowlisted, unverified, inert status and provenance', () => {
  const entry = makeCandidateEvidence('refA', 'mameto_lueji', 'snapshot1', '6396548176148717');
  assert.ok(entry);
  assert.equal(AUDIENCE_CANDIDATE_ACTION, 'reference_audience_candidate_v1');
  assert.equal(MAX_CANDIDATES_PER_ACCOUNT, 2000);
  assert.equal(entry.status, 'identified_unverified');
  assert.equal(entry.referenceUsername, 'mameto_lueji');
  assert.equal(entry.verifiedByMeta, false);
  assert.equal(entry.followbackVerified, false);
  assert.equal(entry.actionsEnabled, false);
  assert.deepEqual(parseCandidateEvidence(JSON.stringify(entry)), entry);
  assert.equal(makeCandidateEvidence('../bad', 'mameto_lueji', 's', '6396548176148717'), null);
  assert.equal(parseCandidateEvidence(JSON.stringify({ ...entry, status: 'followed' })), null);
  assert.equal(parseCandidateEvidence(JSON.stringify({ ...entry, actionsEnabled: true })), null);
  assert.equal(parseCandidateEvidence(JSON.stringify({ ...entry, token: 'private' })), null);
});

test('candidate index synchronizes all saved snapshots without individual selection', () => {
  const data = [
    snapshot('h1','r1','ref_a',['user1','shared','protected','owner','ref_b']),
    snapshot('h2','r2','ref_b',['user2','shared','user3']),
    snapshot('h3','r1','ref_a',['user4','user2']),
    snapshot('h4','wrong','ref_a',['invented']),
  ];
  const original = JSON.stringify(data);
  const result = planCandidateIndex([
    { id:'r1', username:'ref_a' }, { id:'r2', username:'ref_b' },
  ], data, ['already'], ['owner','protected'], 500);
  assert.equal(result.available, 5);
  assert.equal(result.referencesRepresented, 2);
  assert.equal(result.insert.length, 5);
  assert.deepEqual(new Set(result.insert.map(x=>x.username)),
    new Set(['user1','user2','user3','user4','shared']));
  assert.equal(result.insert.filter(x=>x.username==='shared').length, 1);
  assert.equal(result.insert.filter(x=>x.username==='user2').length, 1);
  assert.equal(JSON.stringify(data), original);
  const again = planCandidateIndex([
    { id:'r1',username:'ref_a' },{ id:'r2',username:'ref_b' },
  ],data,result.insert.map(x=>x.username),['owner','protected'],500);
  assert.equal(again.insert.length, 0);
});

test('queue remains bounded to 2,000 unique candidates, no mutation on empty/excluded sources', () => {
  const sources = Array.from({ length: 220 }, (_, i) => snapshot(
    'h'+i, 'r', 'reference', Array.from({length:10}, (_, j) => 'person'+(i*10+j)),
    new Date(Date.UTC(2026,10,19,0,i)).toISOString(),
  ));
  const plan = planCandidateIndex([{id:'r',username:'reference'}],sources,[],[],4000);
  assert.equal(plan.available,2200);
  assert.equal(plan.insert.length,2000);
  const empty = planCandidateIndex([{id:'r',username:'reference'}],[],[],[],500);
  assert.equal(empty.insert.length,0);
  assert.equal(planCandidateIndex([{id:'r',username:'reference'}],sources,[],[],0).insert.length,0);
});

test('protected names, owner and invalid provenance are never added to persistent index', () => {
  const malformed = snapshot('h5','ref','reference',['valid1']);
  malformed.targetUsername = 'another_reference';
  const plan = planCandidateIndex([{id:'ref',username:'reference'}],
    [malformed,snapshot('h6','ref','reference',['reference','valid2','valid3'])],
    ['valid3'],['valid2'],500);
  assert.equal(plan.insert.length,0);
});

test('queue endpoint uses account scoped serializable transaction, no actions/credentials', () => {
  const code = readFileSync('app/api/reference-candidate-queue/route.ts','utf8');
  const ui = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx','utf8');
  assert.match(code,/const session = await auth\(\)/);
  assert.match(code,/where: \{ id: accountId, userId \}/);
  assert.match(code,/PHANTOMBUSTER_READONLY_ENABLED/);
  assert.match(code,/origin !== new URL\(req.url\).origin/);
  assert.match(code,/Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(code,/AUDIENCE_HISTORY_ACTION/);
  assert.match(code,/AUDIENCE_CANDIDATE_ACTION/);
  assert.match(code,/tx.activityLog.createMany\(/);
  assert.match(code,/planCandidateIndex\(/);
  assert.doesNotMatch(code,/followAction\.(create|update|delete)|agents\/launch|user_follow|user_unfollow|api\.instagram|sessionid/);
  assert.match(ui,/sync-saved-history/);
  assert.match(ui,/Índice persistente de candidatos/);
  assert.doesNotMatch(ui,/sessionStorage|localStorage|agents\/launch/);
});


test('deleting saved snapshot prunes candidates linked to that source in a serializable transaction', () => {
  const code = readFileSync('app/api/provider/phantombuster/audience-history/route.ts', 'utf8');
  assert.match(code, /parseCandidateEvidence\(row.details\)\?\.snapshotId === p.historyId/);
  assert.match(code, /AUDIENCE_CANDIDATE_ACTION/);
  assert.match(code, /tx.activityLog.deleteMany\(/);
  assert.match(code, /Prisma.TransactionIsolationLevel.Serializable/);
});


test('index provides database-backed per-reference totals, no Instagram actions', () => {
  const route = readFileSync('app/api/reference-candidate-queue/route.ts', 'utf8');
  const ui = readFileSync('app/(app)/references/_components/automatic-audience-plan-panel.tsx', 'utf8');
  assert.match(route, /const byReference = new Map/);
  assert.match(route, /seen\.add\(candidate\.username\.toLowerCase\(\)\)/);
  assert.match(route, /referencesRepresented: counts\.length/);
  assert.match(route, /lastIndexedAt, duplicateRecords/);
  assert.match(route, /status: 'identified_unverified'/);
  assert.match(ui, /Confirmado no banco:/);
  assert.match(ui, /Distribuição por referência/);
  assert.match(ui, /fetchIndex\(accountId/);
  assert.match(ui, /Nenhum follow ou unfollow executado/);
  assert.doesNotMatch(route, /user_follow|user_unfollow|agents\/launch|followAction\.(create|update|delete)/);
});

test('legacy index of 500 expands idempotently after per-account capacity increase', () => {
  const sources = Array.from({length:93},(_,i)=>snapshot(
    'batch'+i,'r1','reference', Array.from({length:10},(_,j)=>'follower'+(i*10+j)),
    new Date(Date.UTC(2026,10,19,0,Math.floor(i/60),i%60)).toISOString(),
  ));
  const existing = Array.from({length:500},(_,i)=>'follower'+i);
  const plan = planCandidateIndex(
    [{id:'r1',username:'reference'}],sources,existing,[],1500);
  assert.equal(plan.available,930);
  assert.equal(plan.insert.length,430);
  assert.equal(new Set(plan.insert.map(x=>x.username)).size,430);
  assert.equal(plan.insert.some(x=>existing.includes(x.username)),false);
  const repeat = planCandidateIndex(
    [{id:'r1',username:'reference'}],sources,
    [...existing,...plan.insert.map(x=>x.username)],[],1500);
  assert.equal(repeat.insert.length,0);
});
