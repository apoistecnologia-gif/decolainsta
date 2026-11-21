import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolveMessagingWebhookAppSecret} from
  '../lib/instagram/messaging-webhook-app-secret';

const common={
  VERCEL_ENV:'preview',
  INSTAGRAM_APP_ID:'1734982044217816',
  INSTAGRAM_APP_SECRET:'TEST_META_SECRET_EXISTING_APP_XX',
};
test('default remains off, and production cannot reuse business secret',()=>{
  assert.equal(resolveMessagingWebhookAppSecret(common),'');
  assert.equal(resolveMessagingWebhookAppSecret({
    ...common,VERCEL_ENV:'production',
    INSTAGRAM_MESSAGING_REUSE_EXISTING_META_APP:'yes',
  }),'');
});
test('explicit same-app Preview integration can reuse stored secret securely',()=>{
  assert.equal(resolveMessagingWebhookAppSecret({
    ...common,INSTAGRAM_MESSAGING_REUSE_EXISTING_META_APP:'yes',
  }),common.INSTAGRAM_APP_SECRET);
});
test('different app ID cannot reuse existing business secret',()=>{
  assert.equal(resolveMessagingWebhookAppSecret({
    ...common,INSTAGRAM_MESSAGING_REUSE_EXISTING_META_APP:'yes',
    INSTAGRAM_MESSAGING_APP_ID:'1734982044217817',
  }),'');
  assert.equal(resolveMessagingWebhookAppSecret({
    ...common,INSTAGRAM_MESSAGING_REUSE_EXISTING_META_APP:'yes',
    INSTAGRAM_APP_SECRET:'short',
  }),'');
});
test('dedicated secret remains available for a separate Meta application',()=>{
  assert.equal(resolveMessagingWebhookAppSecret({
    ...common,INSTAGRAM_MESSAGING_APP_ID:'1734982044217817',
    INSTAGRAM_MESSAGING_WEBHOOK_APP_SECRET:'SEPARATE_INSTAGRAM_APP_SECRET',
  }),'SEPARATE_INSTAGRAM_APP_SECRET');
});
test('webhook accepts only signed POST; readiness does not emit secrets',()=>{
  const webhook=readFileSync('app/api/instagram/messaging/webhook/route.ts','utf8');
  const readiness=readFileSync('app/api/operator/instagram-messaging/readiness/route.ts','utf8');
  assert.match(webhook,/verifyMetaWebhookSignature/);
  assert.match(webhook,/resolveMessagingWebhookAppSecret/);
  assert.match(webhook,/messagingEnabled\(\)/);
  assert.match(readiness,/resolveMessagingWebhookAppSecret/);
  assert.doesNotMatch(readiness,/INSTAGRAM_APP_SECRET.*return|encryptedAccessToken:.*JSON/);
});
