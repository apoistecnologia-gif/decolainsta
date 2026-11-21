import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('Meta OAuth starts on stable callback host to preserve host-bound CSRF cookie',()=>{
  const s=readFileSync('app/api/instagram/connect/route.ts','utf8');
  assert.match(s,/instagramConfig\(\)/);
  assert.match(s,/callback\.pathname !== '\/api\/instagram\/connect\/callback'/);
  assert.match(s,/request\.nextUrl\.origin !== canonicalOrigin/);
  assert.match(s,/new URL\('\/api\/instagram\/connect', canonicalOrigin\)/);
  assert.match(s,/response\.cookies\.set\('instagram_oauth_state'/);
  assert.match(s,/instagramAuthorizationUrl\(state\)/);
});
