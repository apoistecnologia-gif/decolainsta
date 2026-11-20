import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyMetaWebhookSignature,extractInboundMessagingReceipts} from
  '../lib/instagram/messaging-webhook';

const secret='MOCK_INSTAGRAM_APP_SECRET';
test('valid Meta HMAC uses raw body with a timing-safe check',()=>{
  const raw=Buffer.from('{"object":"instagram","entry":[]}');
  const signature='sha256='+crypto.createHmac('sha256',secret)
    .update(raw).digest('hex');
  assert.equal(verifyMetaWebhookSignature(raw,signature,secret),true);
  assert.equal(verifyMetaWebhookSignature(raw,'sha256='+('0'.repeat(64)),secret),
    false);
  assert.equal(verifyMetaWebhookSignature(raw,'not-a-signature',secret),false);
});
test('only incoming signed-message shape yields minimal receipts',()=>{
  const raw={object:'instagram',entry:[{
    id:'17840000000001',messaging:[{
      sender:{id:'17840000000002'},recipient:{id:'17840000000001'},
      message:{mid:'mid.1',text:'PRIVATE_BODY_SHOULD_NOT_LEAK'},
    },{
      sender:{id:'17840000000002'},recipient:{id:'17840000000001'},
      message:{mid:'mid.2'},
    },{
      sender:{id:'17840000000003'},recipient:{id:'17840000000001'},
      message:{mid:'mid.3',is_echo:true},
    },{
      sender:{id:'17840000000004'},recipient:{id:'17840000000001'},
      read:{watermark:42},
    }]},
  ]};
  const receipts=extractInboundMessagingReceipts(raw);
  assert.deepEqual(receipts,[{
    instagramUserId:'17840000000001',
    senderIgsid:'17840000000002',
    source:'meta-signed-inbound-message',
  }]);
  assert.doesNotMatch(JSON.stringify(receipts),/PRIVATE_BODY|mid/);
  assert.deepEqual(extractInboundMessagingReceipts({
    ...raw,object:'page',
  }),[]);
});
test('webhook and callback are off by default and never send messages',()=>{
  const webhook=readFileSync('app/api/instagram/messaging/webhook/route.ts','utf8');
  const connect=readFileSync('app/api/instagram/messaging/connect/route.ts','utf8');
  const callback=readFileSync('app/api/instagram/messaging/callback/route.ts','utf8');
  assert.match(webhook,/verifyMetaWebhookSignature/);
  assert.match(webhook,/messagingEnabled\(\)/);
  assert.match(webhook,/instagramMessagingContact\.upsert/);
  assert.match(callback,/equalSecret\(supplied,expected\)/);
  assert.match(callback,/token.username.toLowerCase\(\)/);
  assert.match(callback,/encrypt\(token.accessToken\)/);
  assert.match(connect,/instagramAccount\.findFirst/);
  assert.doesNotMatch(webhook+connect+callback,/agents\/launch|media_publish|\/messages['"]/);
});
