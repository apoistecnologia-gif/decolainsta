/**
 * Read-only official Meta messaging-context relationship verification.
 *
 * The existing app uses Facebook Business Integration tokens, which CANNOT
 * be silently reused with the Instagram Login User Profile API. This module
 * fails closed unless a separate authorized Instagram Login token and an
 * Instagram-scoped sender ID from a consenting messaging webhook are supplied.
 *
 * Does not access arbitrary Instagram users, send DMs, follow or unfollow.
 * Never logs tokens, returns raw API payloads, or writes a DB record.
 */
import {
  assessUnfollowEligibility, type UnfollowDecision,
} from '@/lib/reference-unfollow-eligibility';

type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;
export type MessagingRelationshipEvidence={
  status:'verified';
  source:'meta-instagram-login-messaging';
  instagramAccountId:string;
  igsid:string;
  // This is the live response at observation time; false is not proof
  // that a pending follow request does not exist.
  outgoing:'following'|'not-following-or-pending';
  incomingFollows:boolean;
  observedAt:string;
};
export type MessagingRelationshipResult=
  MessagingRelationshipEvidence |
  {status:'not-supported'|'no-consent'|'unavailable'|'no-permission'|
    'rate-limited'|'invalid-response'};
export type MessagingReceipt={
  source:'instagram-messaging-webhook';
  instagramAccountId:string;
  senderIgsid:string;
  consented:boolean;
};
export type MessagingRelationshipInput={
  token:string;
  tokenKind:'instagram-login'|'facebook-business';
  instagramAccountId:string;
  igsid:string;
  receipt:MessagingReceipt|null;
  observedAt?:Date;
};
const id=(v:unknown):v is string=>
  typeof v==='string'&&/^\d{1,30}$/.test(v);
const record=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
async function boundedJson(res:Response):Promise<unknown>{
  if(!res.body)return null;
  const length=res.headers.get('content-length');
  if(length!==null&&Number(length)>64000)return null;
  const reader=res.body.getReader();
  const decode=new TextDecoder();
  let bytes=0;
  let body='';
  try{
    for(;;){
      const block=await reader.read();
      if(block.done)break;
      bytes+=block.value.byteLength;
      if(bytes>64000){await reader.cancel();return null;}
      body+=decode.decode(block.value,{stream:true});
    }
    return JSON.parse(body+decode.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
/**
 * Only valid after Meta's documented messaging-consent webhook flow.
 * Caller must resolve receipt ownership from server-held webhook state;
 * never accept a receipt or token from a public request as proof of consent.
 */
export async function fetchMessagingRelationship(
  input:MessagingRelationshipInput,fetcher:Fetcher=fetch,
):Promise<MessagingRelationshipResult>{
  if(input.tokenKind!=='instagram-login')return {status:'not-supported'};
  if(!id(input.igsid)||!id(input.instagramAccountId)||
    !input.receipt||!input.receipt.consented||
    input.receipt.source!=='instagram-messaging-webhook'||
    input.receipt.instagramAccountId!==input.instagramAccountId||
    input.receipt.senderIgsid!==input.igsid)
    return {status:'no-consent'};
  if(!input.token||input.token.length>4096)return {status:'unavailable'};
  const date=input.observedAt??new Date();
  if(!Number.isFinite(date.getTime())||
    date.getTime()>Date.now()+60000)return {status:'invalid-response'};
  const url=new URL('https://graph.instagram.com/v27.0/'+input.igsid);
  url.searchParams.set('fields',
    'is_business_follow_user,is_user_follow_business');
  try{
    const res=await fetcher(url.toString(),{
      method:'GET',
      headers:{Authorization:'Bearer '+input.token},
      credentials:'omit',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401||res.status===403)
      return {status:'no-permission'};
    if(res.status===429)return {status:'rate-limited'};
    if(!res.ok)return {status:'unavailable'};
    const data=record(await boundedJson(res));
    if(!data||typeof data.is_business_follow_user!=='boolean'||
      typeof data.is_user_follow_business!=='boolean'||
      (data.id!==undefined&&data.id!==input.igsid))
      return {status:'invalid-response'};
    return {
      status:'verified',source:'meta-instagram-login-messaging',
      instagramAccountId:input.instagramAccountId,
      igsid:input.igsid,
      outgoing:data.is_business_follow_user
        ?'following':'not-following-or-pending',
      incomingFollows:data.is_user_follow_business,
      observedAt:date.toISOString(),
    };
  }catch{return {status:'unavailable'};}
}
/**
 * Passive decision only. A first confirmed *observation* starts the safe
 * minimum 48h clock; it cannot establish the actual follow start time.
 * No provider action is launched or scheduled.
 */
export function assessMessagingUnfollowReview(input:{
  evidence:MessagingRelationshipResult;
  firstVerifiedFollowingAt:Date|null;
  now:Date;
  whitelisted:boolean;
  protectedAccount:boolean;
  authorized:boolean;
}):UnfollowDecision{
  const evidence=input.evidence;
  return assessUnfollowEligibility({
    relationship:evidence.status==='verified'&&
      evidence.outgoing==='following'?'following':'unknown',
    confirmedFollowAt:input.firstVerifiedFollowingAt,
    confirmationSource:evidence.status==='verified'
      ?'independent-verified':'unknown',
    now:input.now,
    pendingRequest:evidence.status!=='verified'||
      evidence.outgoing!=='following',
    followsBack:evidence.status==='verified'
      ?evidence.incomingFollows:'unknown',
    protectedAccount:input.protectedAccount,
    inWhitelist:input.whitelisted,
    authorized:input.authorized,
  });
}
