import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
test('scheduled preview executor is simulation-only and shares the browser lock',()=>{
 const api=readFileSync('app/api/cron/preview-follow-simulation/route.ts','utf8');
 const src=readFileSync('lib/server/reference-follow-preview-cron.ts','utf8');
 const browser=readFileSync('app/api/operator/reference-follow-preview/route.ts','utf8');
 assert.match(api,/VERCEL_ENV!=='preview'/);
 assert.match(api,/CRON_SECRET/);
 assert.match(api,/timingSafeEqual/);
 assert.match(src,/PHANTOMBUSTER_READONLY_ENABLED/);
 assert.match(src,/resolvePreviewRun/);
 assert.match(src,/run\.state!=='simulating'/);
 assert.match(src,/planPreviewEligible/);
 assert.match(src,/parsePreviewDecision/);
 assert.match(src,/Prisma\.TransactionIsolationLevel\.Serializable/);
 assert.match(src,/slice\(0,FOLLOW_PREVIEW_BATCH_SIZE\)/);
 assert.match(src,/realFollowsEnabled:false,realUnfollowsEnabled:false/);
 assert.match(src,/FOLLOW_PREVIEW_DECISION_ACTION/);
 for(const source of [src,browser]){
  assert.match(source,/hashtext\('reference_follow_preview_control_v1'\)/);
  assert.match(source,/makePreviewDecision/);
  assert.match(source,/FOLLOW_PREVIEW_BATCH_MIN_MS/);
 }
 assert.doesNotMatch(src,/followAction\.create|agents\/launch|user_follow|user_unfollow|fetch\(/);
});
