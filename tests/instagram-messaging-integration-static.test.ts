import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {messagingEnabled} from '../lib/instagram/messaging-oauth';

test('OAuth and webhook remain disabled until explicit Preview-only opt-in',()=>{
  assert.equal(messagingEnabled({
    VERCEL_ENV:'production',INSTAGRAM_MESSAGING_INTEGRATION_ENABLED:'yes',
  }),false);
  assert.equal(messagingEnabled({
    VERCEL_ENV:'preview',INSTAGRAM_MESSAGING_INTEGRATION_ENABLED:'no',
  }),false);
  assert.equal(messagingEnabled({
    VERCEL_ENV:'preview',INSTAGRAM_MESSAGING_INTEGRATION_ENABLED:'yes',
  }),true);
});
test('operator relation verification requires signed inbound contact and never unfollows',()=>{
  const s=readFileSync(
    'app/api/operator/instagram-messaging/relationship/route.ts','utf8');
  for(const pattern of [
    "messagingEnabled()", "user?.role!=='admin'",
    "instagramAccount:{userId}",
    'instagramMessagingContact.findFirst',
    "source:'instagram-messaging-webhook'",
    'fetchMessagingRelationship',
    'firstFollowConfirmedAt:firstVerifiedAt',
    'whitelisted:true,protectedAccount:true,authorized:false',
    'eligibleForUnfollow:false',
  ])assert.ok(s.includes(pattern),pattern);
  assert.doesNotMatch(s,/agents\/launch|instagram.*unfollow.*POST|\/messages.*POST/);
});
test('separate schema prevents overwriting existing business access token',()=>{
  const schema=readFileSync('prisma/schema.prisma','utf8');
  assert.match(schema,/model InstagramMessagingConnection/);
  assert.match(schema,/encryptedAccessToken String\s+@db\.Text/);
  assert.match(schema,/model InstagramMessagingContact/);
  const callback=readFileSync(
    'app/api/instagram/messaging/callback/route.ts','utf8');
  assert.match(callback,/instagramMessagingConnection.upsert/);
  assert.doesNotMatch(callback,/instagramAccount\.update|dryMode:false/);
  const migration=readFileSync(
    'prisma/migrations/20261120_instagram_messaging_prepared/migration.sql',
    'utf8');
  assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|ALTER TABLE "InstagramAccount"/);
});
