import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {planDynamicReferenceQueue} from '../lib/reference-dynamic-collection';

const id='1111111111111111';
test('dynamic collector selects only enabled references from the database',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(route,/prisma\.targetAccount\.findMany\(\{where:\{instagramAccountId:accountId,enabled:true\}/);
  assert.match(route,/if\(current\.plan\.unresolved\)/);
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
  assert.match(route,/if\(current\.plan\.unresolved\)/);
  const guarded=route.indexOf('if(cronAuthorized)return NextResponse.json');
  const launcher=route.indexOf('return launchReservedCollector(key!,agentId,claim);',guarded);
  assert.ok(guarded>0 && launcher>guarded);
});
