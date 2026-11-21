import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fetchFacebookMessagingRelationship} from
  '../lib/instagram/facebook-messaging-relationship';
const original={
  token:'MOCK_SECRET_PAGE_TOKEN',tokenKind:'facebook-page' as const,
  accountId:'cuidAccountTest1',pageId:'17840000000111',
  igsid:'17840000000222',
  receipt:{
    source:'meta-signed-facebook-instagram-message' as const,
    accountId:'cuidAccountTest1',pageId:'17840000000111',
    senderIgsid:'17840000000222',inbound:true as const,
  },observedAt:new Date('2026-11-20T20:00:00.000Z'),
};
test('existing Meta Business Integration System User token is never reused',async()=>{
  let requests=0;
  const result=await fetchFacebookMessagingRelationship({
    ...original,tokenKind:'business-integration-system-user',
  },async()=>{requests++;throw Error('must not call');});
  assert.deepEqual(result,{status:'no-page-token'});
  assert.equal(requests,0);
});
test('no signed DM or cross-account/page sender cannot get profile data',async()=>{
  let requests=0;
  const candidates=[
    {...original,receipt:null},
    {...original,igsid:'random_name'},
    {...original,receipt:{...original.receipt,senderIgsid:'17840000000999'}},
    {...original,receipt:{...original.receipt,accountId:'otherAccount'}},
    {...original,receipt:{...original.receipt,pageId:'17840000000999'}},
    {...original,receipt:{...original.receipt,inbound:false as true}},
  ];
  for(const candidate of candidates){
    const result=await fetchFacebookMessagingRelationship(candidate,
      async()=>{requests++;throw Error('must not call');});
    assert.deepEqual(result,{status:'no-consent'});
  }
  assert.equal(requests,0);
});
test('Page API uses the right Graph endpoint and exposes only boolean evidence',async()=>{
  const result=await fetchFacebookMessagingRelationship(original,async(url,opts)=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://graph.facebook.com');
    assert.equal(parsed.pathname,'/v27.0/17840000000222');
    assert.equal(parsed.searchParams.get('fields'),
      'is_business_follow_user,is_user_follow_business');
    assert.equal(parsed.searchParams.has('access_token'),false);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');
    assert.equal((opts.headers as Record<string,string>).Authorization,
      'Bearer MOCK_SECRET_PAGE_TOKEN');
    return Response.json({
      id:'17840000000222',
      is_business_follow_user:true,is_user_follow_business:false,
      username:'PRIVATE_USER',otherPrivateData:'NEVER_SHOW',
    });
  });
  assert.deepEqual(result,{
    status:'verified',source:'meta-facebook-login-messaging',
    outgoing:'following',incomingFollows:false,
    observedAt:'2026-11-20T20:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_USER|NEVER_SHOW|MOCK_SECRET/);
});
test('false outgoing follow may still be a pending request; never claim none',async()=>{
  const result=await fetchFacebookMessagingRelationship(original,async()=>Response.json({
    is_business_follow_user:false,is_user_follow_business:true,
  }));
  assert.equal(result.status,'verified');
  if(result.status==='verified'){
    assert.equal(result.outgoing,'not-following-or-pending');
    assert.equal(result.incomingFollows,true);
  }
});
test('malformed responses and API failures cannot become proof',async()=>{
  const invalid=await fetchFacebookMessagingRelationship(original,
    async()=>Response.json({is_business_follow_user:'true',
      is_user_follow_business:false}));
  assert.deepEqual(invalid,{status:'invalid-response'});
  const denied=await fetchFacebookMessagingRelationship(original,
    async()=>new Response('SECRET',{status:403}));
  assert.deepEqual(denied,{status:'no-permission'});
  const limited=await fetchFacebookMessagingRelationship(original,
    async()=>new Response('SECRET',{status:429}));
  assert.deepEqual(limited,{status:'rate-limited'});
  const unavailable=await fetchFacebookMessagingRelationship(original,
    async()=>{throw Error('SENSITIVE_FAIL');});
  assert.deepEqual(unavailable,{status:'unavailable'});
});
