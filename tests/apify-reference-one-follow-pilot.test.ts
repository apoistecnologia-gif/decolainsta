import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const path='app/api/operator/apify/reference-one-follow-pilot/route.ts';
const read=()=>readFileSync(path,'utf8');
test('one-action pilot requires admin, Preview, same origin and explicit click',()=>{
 const s=read();
 assert.match(s,/user\?\.role!=='admin'/);
 assert.match(s,/process\.env\.VERCEL_ENV!=='preview'/);
 assert.match(s,/req\.headers\.get\('origin'\)!==new URL\(req\.url\)\.origin/);
 assert.match(s,/confirmRealInstagramAction!==true/);
 assert.match(s,/data\.operation==='inspect'/);
 assert.match(s,/startOneFollow\(/);
 assert.match(s,/account\.status==='active'/);
 assert.match(s,/PREVIEW_APIFY_ONE_FOLLOW_ENABLED==='yes'/);
 assert.match(s,/ACCOUNT_ID='17841411544892772'/);
});
test('one transaction reserves before an external POST; never auto-retries',()=>{
 const s=read();
 const tx=s.indexOf('await prisma.$transaction');
 const launch=s.indexOf('const result=await startOneFollow');
 assert.ok(tx>0&&launch>tx);
 assert.match(s,/Prisma\.TransactionIsolationLevel\.Serializable/);
 assert.match(s,/if\(await tx\.activityLog\.findFirst/);
 assert.match(s,/return await tx\.activityLog\.create/);
 assert.match(s,/action:ACTION,details:saved,success:false/);
 assert.match(s,/mayRetryAutomatically:false/);
 assert.match(s,/maxActionsPerRun:1,maxTotalChargeUsd:APIFY_ONE_FOLLOW_MAX_USD/);
 assert.doesNotMatch(s,/setTimeout\(|setInterval\(|setImmediate\(/);
});
test('never treats actor report as Instagram confirmation or auto-unfollow',()=>{
 const s=read();
 assert.match(s,/independentlyVerified:false/);
 assert.match(s,/automatedUnfollowEnabled:false/);
 assert.match(s,/instagramActionsConfirmed:0/);
 assert.match(s,/currentSessionOwnerVerifiedByProvider|accountReady/);
 assert.doesNotMatch(s,/followAction\.create|instagramAccount\.update\(/);
 assert.doesNotMatch(s,/process\.env\.APIFY_INSTAGRAM_COOKIES_JSON\s*\|\|/);
});
test('panel shows gated pilot without changing blocked legacy route',()=>{
 const panel=readFileSync(
  'app/(app)/references/_components/simple-references-panel.tsx','utf8');
 const ui=readFileSync(
  'app/(app)/references/_components/apify-reference-one-follow-pilot.tsx','utf8');
 const legacy=readFileSync(
  'app/api/operator/apify/one-follow/route.ts','utf8');
 assert.match(panel,/ApifyReferenceOneFollowPilot/);
 assert.match(ui,/Teste real isolado/);
 assert.match(ui,/disabled=\{!data\?\.canLaunch\|\|busy\}/);
 assert.match(ui,/confirmRealInstagramAction:true/);
 assert.match(legacy,/if\(value\.operation==='launch-one'\)/);
 assert.doesNotMatch(legacy,/startOneFollow\(/);
});
