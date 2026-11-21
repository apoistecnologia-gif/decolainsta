/**
 * Read-only Messenger Platform / Instagram messaging profile API via the
 * ALREADY EXISTING Meta Facebook Login app. Does not use Instagram Login.
 * Caller must supply an actual Page access token and signed inbound-DM
 * consent context. Current Business Integration System User tokens are NOT
 * Page tokens; fail closed rather than attempt reuse.
 *
 * This module does not request permissions, store DMs, follow or unfollow.
 */
type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;
type PageReceipt={
  source:'meta-signed-facebook-instagram-message';
  accountId:string;
  pageId:string;
  senderIgsid:string;
  inbound:true;
};
export type FacebookMessagingProfileInput={
  token:string;
  tokenKind:'facebook-page'|'business-integration-system-user';
  accountId:string;pageId:string;igsid:string;
  receipt:PageReceipt|null;
  observedAt?:Date;
};
export type FacebookMessagingProfileResult=
  {status:'verified';source:'meta-facebook-login-messaging';
    outgoing:'following'|'not-following-or-pending';
    incomingFollows:boolean;observedAt:string}|
  {status:'no-page-token'|'no-consent'|'unavailable'|'no-permission'|
    'rate-limited'|'invalid-response'};
const numeric=(v:unknown):v is string=>
  typeof v==='string'&&/^\d{5,30}$/.test(v);
const localAccount=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
  ?v as Record<string,unknown>:null;
async function jsonWithinLimit(res:Response):Promise<unknown>{
  const declared=res.headers.get('content-length');
  if(!res.body||(declared!==null&&Number(declared)>64000))
    return null;
  const reader=res.body.getReader();const dec=new TextDecoder();
  let bytes=0,buffer='';
  try{
    for(;;){
      const v=await reader.read();if(v.done)break;
      bytes+=v.value.byteLength;
      if(bytes>64000){await reader.cancel();return null;}
      buffer+=dec.decode(v.value,{stream:true});
    }
    return JSON.parse(buffer+dec.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
/**
 * Requires Page token from a Page actually linked to the authorized
 * professional Instagram account and a signed inbound DM recipient.
 * A receipt constructed from untrusted request data is NOT proof.
 */
export async function fetchFacebookMessagingRelationship(
  input:FacebookMessagingProfileInput,fetcher:Fetcher=fetch,
):Promise<FacebookMessagingProfileResult>{
  if(input.tokenKind!=='facebook-page')return {status:'no-page-token'};
  if(!numeric(input.igsid)||!numeric(input.pageId)||
    !localAccount(input.accountId)||!input.receipt||
    input.receipt.source!=='meta-signed-facebook-instagram-message'||
    input.receipt.inbound!==true||
    input.receipt.accountId!==input.accountId||
    input.receipt.pageId!==input.pageId||
    input.receipt.senderIgsid!==input.igsid)
    return {status:'no-consent'};
  if(!input.token||input.token.length>4096)return {status:'no-page-token'};
  const observedAt=input.observedAt??new Date();
  if(!Number.isFinite(observedAt.getTime())||
    observedAt.getTime()>Date.now()+60000)
    return {status:'invalid-response'};
  const url=new URL('https://graph.facebook.com/v27.0/'+input.igsid);
  url.searchParams.set('fields',
    'is_business_follow_user,is_user_follow_business');
  try{
    const res=await fetcher(url.toString(),{
      method:'GET',credentials:'omit',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+input.token},
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401||res.status===403)return {status:'no-permission'};
    if(res.status===429)return {status:'rate-limited'};
    if(!res.ok)return {status:'unavailable'};
    const data=obj(await jsonWithinLimit(res));
    if(!data||typeof data.is_business_follow_user!=='boolean'||
      typeof data.is_user_follow_business!=='boolean'||
      (data.id!==undefined&&data.id!==input.igsid))
      return {status:'invalid-response'};
    return {
      status:'verified',source:'meta-facebook-login-messaging',
      outgoing:data.is_business_follow_user
        ?'following':'not-following-or-pending',
      incomingFollows:data.is_user_follow_business,
      observedAt:observedAt.toISOString(),
    };
  }catch{return {status:'unavailable'};}
}
