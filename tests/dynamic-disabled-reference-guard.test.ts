import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {planDynamicReferenceQueue} from '../lib/reference-dynamic-collection';

const id='1111111111111111';
test('collection remains independent of the disabled social-action flag',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const create=readFileSync('app/api/instagram-accounts/[id]/targets/route.ts','utf8');
  assert.match(create,/enabled: false/);
  assert.match(route,/prisma\.targetAccount\.findMany\(\{where:\{instagramAccountId:accountId\}/);
  assert.doesNotMatch(route,/prisma\.targetAccount\.findMany\(\{where:\{instagramAccountId:accountId,enabled:true\}/);
  assert.match(route,/if\(current\.plan\.unresolved\|\|current\.plan\.attributionUnverified>0\)/);
  assert.match(route,/if\(!current\.plan\.next\)/);
});
test('reference collection planning does not initiate Instagram actions',()=>{
  const references=[{id:'ref001',username:'uber'}];
  const plan=planDynamicReferenceQueue(references,[],id);
  assert.equal(plan.next?.username,'uber');
  assert.equal(plan.total,1);
  assert.equal(plan.unresolved,false);
});

test('background reconciliation accepts only a secret-authenticated pre-existing launch',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/previewReconcileCronAuthorized\(request\)/);
  assert.match(route,/process\.env\.PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED==='yes'/);
  assert.match(route,/given\.length===expected\.length&&timingSafeEqual\(given,expected\)/);
  assert.match(route,/\(reconcileOnly&&!cronAuthorized\)/);
  assert.match(route,/current\.jobs\[0\]\?\.state!=='launched'/);
  assert.match(route,/if\(reconcileOnly\)return NextResponse\.json/);
  assert.match(route,/if\(current\.plan\.unresolved\|\|current\.plan\.attributionUnverified>0\)/);
  const guarded=route.indexOf('if(reconcileOnly)return NextResponse.json');
  const launcher=route.indexOf('return launchReservedCollector(key!,agentId,claim);',guarded);
  assert.ok(guarded>0 && launcher>guarded);
});

test('unverified collection blocks further launches but not review of existing receipt',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/data\.plan\.attributionUnverified===0/);
  assert.match(route,/data\.plan\.attributionUnverified>0/);
  assert.match(route,/current\.plan\.attributionUnverified>0/);
});

test('finished container without importable proof is quarantined after grace',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/withinDynamicResultGracePeriod\(last\.createdAt\)/);
  assert.match(route,/const blocked=makeDynamicJobEvent\(\{\.\.\.event,state:'finished-unverified'\}\)/);
  assert.match(route,/const quarantined=await prisma\.activityLog\.updateMany\(/);
  assert.match(route,/if\(quarantined\.count!==1\)return bad\('Revisão concorrente da coleta',409\)/);
  assert.match(route,/!collectionLimited&&activeProof\?\.reason!=='failed-run'/);
});

test('server-only collection requires independent opt-in and cannot impersonate browser',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/process\.env\.PREVIEW_DYNAMIC_COLLECTION_CRON_ENABLED==='yes'/);
  assert.match(route,/previewCronTokenAuthorized\(request\)/);
  assert.match(route,/const collectCronAuthorized=previewCollectCronAuthorized\(request\)/);
  assert.match(route,/\(collectNext&&!collectCronAuthorized\)/);
  assert.match(route,/\(!reconcileOnly&&!collectNext&&serverCron\)/);
  assert.match(route,/if\(!serverCron&&!isSameOriginDynamicCollectionRequest/);
  assert.match(route,/if\(current\.plan\.unresolved\|\|current\.plan\.attributionUnverified>0\)/);
});
