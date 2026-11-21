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
