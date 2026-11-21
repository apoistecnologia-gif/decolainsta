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
  assert.match(panel,/setInterval\(.*20000\)/);
  assert.match(panel,/confirmDynamicCollection:true/);
  assert.doesNotMatch(panel,/sync-saved-history/);
  assert.match(route,/indexSavedAudienceCandidates\(tx,event\.accountId\)/);
  assert.match(panel,/queue\.currentState==='launched'&&queue\.canAdvance/);
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
