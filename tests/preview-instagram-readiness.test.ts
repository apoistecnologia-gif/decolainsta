import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('preview readiness is cron-secret protected and never releases a collection',()=>{
  const route=readFileSync('app/api/cron/preview-instagram-readiness/route.ts','utf8');
  assert.match(route,/process\.env\.VERCEL_ENV!=='preview'/);
  assert.match(route,/process\.env\.PREVIEW_INSTAGRAM_READINESS_PROBE_ENABLED!=='yes'/);
  assert.match(route,/given\.length===expected\.length&&timingSafeEqual\(given,expected\)/);
  assert.match(route,/await connectedAccount\(account\.id,account\.userId\)/);
  assert.match(route,/await getProfile\(active\.token,account\.instagramUserId\)/);
  assert.match(route,/profile\.id===account\.instagramUserId/);
  assert.match(route,/profile\.username\.toLowerCase\(\)===alias/);
  assert.match(route,/metaIdentity,/);
  assert.match(route,/inspectDynamicFailureOutput\(/);
  assert.match(route,/instagramRestrictionCleared:null/);
  assert.match(route,/providerLaunchesExecuted:0/);
  assert.match(route,/instagramActionsExecuted:0/);
  assert.match(route,/dataMutations:0/);
  assert.doesNotMatch(route,/launchExistingCollectorForReference|agents\/launch|followAction\.(create|update)|targetAccount\.(create|update)|instagramAccount\.update/);
});
test('readiness always scopes previous receipt to one pilot account',()=>{
  const route=readFileSync('app/api/cron/preview-instagram-readiness/route.ts','utf8');
  assert.match(route,/accounts\.length!==1/);
  assert.match(route,/instagramAccountId:account\.id,action:DYNAMIC_COLLECTION_ACTION/);
  assert.match(route,/receipt\?\.accountId===account\.id/);
  assert.match(route,/receipt\.agentId===row\?\.targetUsername/);
  assert.match(route,/previousContainerOnly:true/);
  assert.match(route,/currentPhantomSessionVerified:false/);
});
