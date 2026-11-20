import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  messagingOAuthConfig,messagingAuthorizationUrl,exchangeMessagingOAuth,
} from '../lib/instagram/messaging-oauth';

const config={clientId:'1734982044217816',clientSecret:'MOCK_SECRET_FOR_TEST',
  redirectUri:'https://preview.example.com/api/instagram/messaging/callback'};
test('explicit Instagram credentials, secure callback and scopes',()=>{
  assert.deepEqual(messagingOAuthConfig({
    INSTAGRAM_MESSAGING_APP_ID:config.clientId,
    INSTAGRAM_MESSAGING_APP_SECRET:config.clientSecret,
    INSTAGRAM_MESSAGING_REDIRECT_URI:config.redirectUri,
  }),config);
  assert.equal(messagingOAuthConfig({
    INSTAGRAM_MESSAGING_APP_ID:config.clientId,
    INSTAGRAM_MESSAGING_APP_SECRET:config.clientSecret,
    INSTAGRAM_MESSAGING_REDIRECT_URI:'http://preview.example.com/api/instagram/messaging/callback',
  }),null);
  const url=new URL(messagingAuthorizationUrl(config,
    'testAccountId_abcdef:1234567890abcdef1234567890abcdef1234567890abcdef'));
  assert.equal(url.origin,'https://www.instagram.com');
  assert.equal(url.searchParams.get('scope'),
    'instagram_business_basic,instagram_business_manage_messages');
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.equal(url.searchParams.get('client_id'),config.clientId);
});
test('exchange on Instagram hosts and verify authorized account identity',async()=>{
  const called:string[]=[];
  const result=await exchangeMessagingOAuth(config,'one-use-code',async(url,opts)=>{
    const u=new URL(url);called.push(u.origin+u.pathname);
    assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');
    if(u.host==='api.instagram.com'){
      assert.equal(opts.method,'POST');
      const p=new URLSearchParams(opts.body as string);
      assert.equal(p.get('grant_type'),'authorization_code');
      assert.equal(p.get('client_secret'),config.clientSecret);
      return Response.json({access_token:'MOCK_SHORT_TOKEN',
        user_id:'17840000000001'});
    }
    if(u.pathname==='/access_token'){
      assert.equal(u.searchParams.get('grant_type'),'ig_exchange_token');
      return Response.json({access_token:'MOCK_LONG_TOKEN',
        expires_in:5184000});
    }
    assert.equal((opts.headers as Record<string,string>).Authorization,
      'Bearer MOCK_LONG_TOKEN');
    return Response.json({user_id:'17840000000001',
      username:'contateste6699'});
  });
  assert.deepEqual(called,[
    'https://api.instagram.com/oauth/access_token',
    'https://graph.instagram.com/access_token',
    'https://graph.instagram.com/v27.0/me',
  ]);
  assert.deepEqual(result,{
    id:'17840000000001',username:'contateste6699',
    accessToken:'MOCK_LONG_TOKEN',expiresIn:5184000,
  });
});
test('different account, unapproved token or invalid code fails closed',async()=>{
  assert.equal(await exchangeMessagingOAuth(config,'bad code',
    async()=>{throw Error('No network');}),null);
  const r=await exchangeMessagingOAuth(config,'good',async(url)=>{
    if(url.includes('api.instagram.com'))return Response.json({
      access_token:'MOCK_SHORT_TOKEN',user_id:'17840000000001'});
    if(url.includes('/access_token'))return Response.json({
      access_token:'MOCK_LONG_TOKEN',expires_in:5184000});
    return Response.json({user_id:'99999',username:'other'});
  });
  assert.equal(r,null);
});
