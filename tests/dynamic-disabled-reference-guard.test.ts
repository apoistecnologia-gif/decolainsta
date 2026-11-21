import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {planDynamicReferenceQueue} from '../lib/reference-dynamic-collection';

const id='1111111111111111';
test('dynamic collector selects only enabled references from the database',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/prisma\.targetAccount\.findMany\(\{where:\{instagramAccountId:accountId,enabled:true\}/);
  assert.match(route,/if\(current\.plan\.unresolved\|\|current\.plan\.attributionUnverified>0\)/);
  assert.match(route,/if\(!current\.plan\.next\)/);
});
test('dynamic queue does not produce work when disabled references are filtered out',()=>{
  const plan=planDynamicReferenceQueue([],[],id);
  assert.equal(plan.next,null);
  assert.equal(plan.total,0);
  assert.equal(plan.unresolved,false);
});

test('background reconciliation accepts only a secret-authenticated pre-existing launch',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/previewReconcileCronAuthorized\(request\)/);
  assert.match(route,/process\.env\.PREVIEW_DYNAMIC_RECONCILIATION_CRON_ENABLED!=='yes'/);
  assert.match(route,/given\.length===expected\.length&&timingSafeEqual\(given,expected\)/);
  assert.match(route,/cronAuthorized!==\(body\.operation==='reconcile-only'\)/);
  assert.match(route,/current\.jobs\[0\]\?\.state!=='launched'/);
  assert.match(route,/if\(cronAuthorized\)return NextResponse\.json/);
  assert.match(route,/if\(current\.plan\.unresolved\|\|current\.plan\.attributionUnverified>0\)/);
  const guarded=route.indexOf('if(cronAuthorized)return NextResponse.json');
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
