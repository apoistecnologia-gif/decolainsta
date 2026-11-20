import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  fetchMessagingRelationship,assessMessagingUnfollowReview,
  type MessagingRelationshipInput,
} from '../lib/instagram/messaging-relationship-verification';

const input:MessagingRelationshipInput={
  token:'NEVER_PRINT_ME',tokenKind:'instagram-login',
  instagramAccountId:'1784000000001',igsid:'1784000000002',
  receipt:{source:'instagram-messaging-webhook',
    instagramAccountId:'1784000000001',senderIgsid:'1784000000002',
    consented:true},
  observedAt:new Date('2026-11-20T20:00:00.000Z'),
};
test('reject current Facebook business login without a Meta call',async()=>{
  let called=0;
  const response=await fetchMessagingRelationship({...input,
    tokenKind:'facebook-business'},async()=>{called++;throw Error('bad');});
  assert.deepEqual(response,{status:'not-supported'});
  assert.equal(called,0);
});
test('reject arbitrary username, unconsented and cross-account IGSIDs',async()=>{
  let called=0;
  for(const different of [
    {...input,igsid:'random_handle'},
    {...input,receipt:null},
    {...input,receipt:{...input.receipt!,senderIgsid:'99'}},
    {...input,receipt:{...input.receipt!,instagramAccountId:'999'}},
    {...input,receipt:{...input.receipt!,consented:false}},
  ]){
    const result=await fetchMessagingRelationship(different,
      async()=>{called++;throw Error('must not fetch');});
    assert.deepEqual(result,{status:'no-consent'});
  }
  assert.equal(called,0);
});
test('official boolean response confirms two directions but not pending status',async()=>{
  const result=await fetchMessagingRelationship(input,async(url,opts)=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://graph.instagram.com');
    assert.equal(parsed.pathname,'/v27.0/1784000000002');
    assert.equal(parsed.searchParams.get('fields'),
      'is_business_follow_user,is_user_follow_business');
    assert.equal(parsed.searchParams.has('access_token'),false);
    assert.equal(opts.method,'GET');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.cache,'no-store');
    assert.equal((opts.headers as Record<string,string>).Authorization,
      'Bearer NEVER_PRINT_ME');
    return new Response(JSON.stringify({
      id:'1784000000002',is_business_follow_user:true,
      is_user_follow_business:false,access_token:'NOT_FOR_CLIENT',
    }),{status:200});
  });
  assert.deepEqual(result,{
    status:'verified',source:'meta-instagram-login-messaging',
    instagramAccountId:'1784000000001',igsid:'1784000000002',
    outgoing:'following',incomingFollows:false,
    observedAt:'2026-11-20T20:00:00.000Z',
  });
  assert.doesNotMatch(JSON.stringify(result),/NEVER_PRINT_ME|NOT_FOR_CLIENT/);
  const noFollow=await fetchMessagingRelationship(input,
    async()=>new Response(JSON.stringify({
      is_business_follow_user:false,is_user_follow_business:true,
    }),{status:200}));
  assert.equal(noFollow.status,'verified');
  if(noFollow.status==='verified'){
    assert.equal(noFollow.outgoing,'not-following-or-pending');
    assert.equal(noFollow.incomingFollows,true);
  }
});
test('API omission or string values cannot masquerade as confirmation',async()=>{
  for(const body of [
    {is_business_follow_user:true},
    {is_business_follow_user:'true',is_user_follow_business:false},
    {is_business_follow_user:true,is_user_follow_business:false,id:'wrong'},
  ]){
    const r=await fetchMessagingRelationship(input,
      async()=>new Response(JSON.stringify(body),{status:200}));
    assert.deepEqual(r,{status:'invalid-response'});
  }
});
test('provider failures are sanitized and fail closed',async()=>{
  for(const [status,wanted] of [
    [401,'no-permission'],[403,'no-permission'],
    [429,'rate-limited'],[500,'unavailable'],
  ] as const){
    const r=await fetchMessagingRelationship(input,
      async()=>new Response('SECRET_BODY',{status}));
    assert.deepEqual(r,{status:wanted});
    assert.doesNotMatch(JSON.stringify(r),/SECRET|NEVER_PRINT_ME/);
  }
  const r=await fetchMessagingRelationship(input,async()=>{throw Error('TOKEN_LEAK');});
  assert.deepEqual(r,{status:'unavailable'});
});
test('48h review gates cannot treat unverified or pending as actionable',async()=>{
  const verified=await fetchMessagingRelationship(input,async()=>
    new Response(JSON.stringify({
      is_business_follow_user:true,is_user_follow_business:false,
    }),{status:200}));
  const base={evidence:verified,
    firstVerifiedFollowingAt:new Date('2026-11-18T20:00:00.000Z'),
    now:new Date('2026-11-20T20:00:00.000Z'),
    whitelisted:false,protectedAccount:false,authorized:true};
  assert.equal(assessMessagingUnfollowReview(base).eligible,true);
  assert.equal(assessMessagingUnfollowReview({...base,
    now:new Date('2026-11-20T19:59:59.999Z')}).eligible,false);
  assert.equal(assessMessagingUnfollowReview({...base,
    evidence:{status:'unavailable'}}).eligible,false);
  assert.equal(assessMessagingUnfollowReview({...base,
    firstVerifiedFollowingAt:null}).eligible,false);
  assert.equal(assessMessagingUnfollowReview({...base,
    whitelisted:true}).eligible,false);
  assert.equal(assessMessagingUnfollowReview({...base,
    authorized:false}).eligible,false);
  const maybePending=await fetchMessagingRelationship(input,async()=>
    new Response(JSON.stringify({
      is_business_follow_user:false,is_user_follow_business:false,
    }),{status:200}));
  assert.equal(assessMessagingUnfollowReview({...base,
    evidence:maybePending}).eligible,false);
  const reciprocated=await fetchMessagingRelationship(input,async()=>
    new Response(JSON.stringify({
      is_business_follow_user:true,is_user_follow_business:true,
    }),{status:200}));
  assert.equal(assessMessagingUnfollowReview({...base,
    evidence:reciprocated}).eligible,false);
});
