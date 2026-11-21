import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('registered references feed one-click preview collector without URLs typed into PhantomBuster',()=>{
  const panel=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  const main=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(main,/DynamicCollectorControl/);
  assert.match(main,/accountId=\{accountId\}/);
  assert.match(panel,/Iniciar coletas/);
  assert.match(panel,/Rever contêiner existente/);
  assert.match(panel,/Consultar resultado existente/);
  assert.match(panel,/collectionLimited/);
  assert.match(panel,/Repetir coleta de @/);
  assert.match(panel,/advance\('retry-failed'\)/);
  assert.match(panel,/setInterval\(.*20000\)/);
  assert.match(panel,/confirmDynamicCollection:true/);
  assert.doesNotMatch(panel,/sync-saved-history/);
  assert.match(route,/indexSavedAudienceCandidates\(tx,event\.accountId\)/);
  assert.match(panel,/queue\.currentState==='launched'/);
  assert.match(panel,/queue\.currentState==='finished-unverified'/);
  assert.match(route,/bonusArgument|launchExistingCollectorForReference/);
  assert.match(route,/instagramAccountId:accountId/);
  assert.match(route,/current\.plan\.next/);
  assert.doesNotMatch(panel,/sessionCookie|password|agents\/save|unfollowSingle/);
});
test('collector action remains unavailable for unauthorized or non-pilot accounts while errors are visible',()=>{
  const panel=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(panel,/value.accountId!==accountId/);
  assert.match(panel,/if\(!value.enabled\)/);
  assert.match(panel,/queue \? <>/);
  assert.match(panel,/\{diagnostic\}/);
  assert.doesNotMatch(panel,/if\(!queue\)return null/);
  assert.match(route,/user\?\.role!=='admin'/);
  assert.match(route,/process.env.VERCEL_ENV!=='preview'/);
  assert.match(route,/PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT/);
  assert.match(route,/PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes'/);
});

test('manual one-shot unverified recovery is operator-only and never a cron or bulk follow',()=>{
 const panel=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
 const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
 assert.match(panel,/canRetestUnverified/);
 assert.match(panel,/window\.confirm/);
 assert.match(panel,/retest-unverified-once/);
 assert.match(panel,/confirmLimitedAccessRisk:true/);
 assert.match(panel,/if\(info.oneShotRecovery\)setRunning\(false\)/);
 assert.match(route,/PREVIEW_ONE_SHOT_UNVERIFIED_RECOVERY_ENABLED==='yes'/);
 assert.match(route,/if\(retest\)/);
 assert.match(route,/if\(serverCron\|\|process\.env\.PREVIEW_ONE_SHOT_UNVERIFIED_RECOVERY_ENABLED/);
 assert.match(route,/inspectUnverifiedRecoveryPreflight/);
 assert.match(route,/planOneShotUnverifiedRecovery/);
 assert.match(route,/pg_try_advisory_xact_lock/);
 assert.match(route,/rows\[0\]\.details!==receipt\.details/);
 assert.match(route,/launchReservedCollector\(key!,agentId,claim\)/);
 assert.doesNotMatch(panel,/sessionCookie|user_follow|user_unfollow/);
});
