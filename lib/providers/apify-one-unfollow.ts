/** One UNFOLLOW Actor action for a previously observed Instagram follow
 * request. Never batch, retry, log credentials, or claim that a pending
 * request was cancelled from provider output alone.
 */
import {
 APIFY_ONE_FOLLOW_ACTOR,APIFY_ONE_FOLLOW_MAX_USD,
 isSelfFollowTarget,parseMinimalInstagramCookies,
 type InstagramExecutorIdentity,
} from './apify-one-follow';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj|null=>
 v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:null;
const validUsername=(v:unknown):v is string=>
 typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
const validRunId=(v:unknown):v is string=>
 typeof v==='string'&&/^[A-Za-z0-9]{17,24}$/.test(v);
const validToken=(v:unknown):v is string=>
 typeof v==='string'&&v.length>=12&&v.length<=512&&!/[\r\n]/.test(v);
const headers=(token:string)=>({Authorization:'Bearer '+token,Accept:'application/json'});

async function boundedJson(response:Response):Promise<unknown>{
 const contentLength=Number(response.headers.get('content-length')||0);
 if(contentLength>32000||!response.body)return null;
 let total=0;
 const decoder=new TextDecoder();
 let text='';
 const reader=response.body.getReader();
 try{
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   total+=value.byteLength;
   if(total>32000){await reader.cancel();return null;}
   text+=decoder.decode(value,{stream:true});
  }
  return JSON.parse(text+decoder.decode()) as unknown;
 }catch{return null;}finally{reader.releaseLock();}
}
export type SingleUnfollowStart=
 |{status:'queued';runId:string}
 |{status:'refused'|'unconfirmed';runId:null};
/** Run at most one unfollow, only after the caller durably reserves the
 * exact existing pending-request target. A timeout is NOT retryable.
 */
export async function startOneUnfollow(
 token:string|undefined,cookieSecret:string|undefined,target:string,
 identity:InstagramExecutorIdentity|undefined,
 fetcher:Fetcher=fetch,
):Promise<SingleUnfollowStart>{
 const cookies=parseMinimalInstagramCookies(cookieSecret);
 if(!validToken(token)||!cookies||!validUsername(target)||
   !identity||!/^[0-9]{4,30}$/.test(identity.instagramUserId)||
   !validUsername(identity.username)||
   !Array.isArray(identity.previousUsernames)||
   !identity.previousUsernames.every(validUsername)||
   isSelfFollowTarget(target,identity))
  return {status:'refused',runId:null};
 const url=new URL('https://api.apify.com/v2/acts/'+APIFY_ONE_FOLLOW_ACTOR+'/runs');
 url.searchParams.set('maxTotalChargeUsd',String(APIFY_ONE_FOLLOW_MAX_USD));
 url.searchParams.set('maxItems','1');
 url.searchParams.set('timeout','180');
 try{
  const response=await fetcher(url.toString(),{
   method:'POST',headers:{...headers(token),'Content-Type':'application/json'},
   body:JSON.stringify({cookies,action:'unfollow',usernames:[target],
    maxActionsPerRun:1}),
   cache:'no-store',credentials:'omit',redirect:'error',
   signal:AbortSignal.timeout(12000),
  });
  if([400,401,402,403,404,422,429].includes(response.status))
   return {status:'refused',runId:null};
  if(!response.ok)return {status:'unconfirmed',runId:null};
  const data=obj(obj(await boundedJson(response))?.data);
  return validRunId(data?.id)?{status:'queued',runId:data.id}
   :{status:'unconfirmed',runId:null};
 }catch{return {status:'unconfirmed',runId:null};}
}
export type SingleUnfollowResult={
 status:'running'|'unavailable'|'failed'|'ambiguous'|'provider-reported'|
  'provider-rejected'|'provider-blocked';
 costUsd:number|null;
 providerReportedUnfollow:boolean;
};
export async function inspectOneUnfollow(
 token:string|undefined,runId:string,target:string,fetcher:Fetcher=fetch,
):Promise<SingleUnfollowResult>{
 const unavailable:SingleUnfollowResult={
  status:'unavailable',costUsd:null,providerReportedUnfollow:false,
 };
 if(!validToken(token)||!validRunId(runId)||!validUsername(target))
  return unavailable;
 try{
  const response=await fetcher('https://api.apify.com/v2/actor-runs/'+runId,{
   method:'GET',headers:headers(token),cache:'no-store',
   credentials:'omit',redirect:'error',signal:AbortSignal.timeout(9000),
  });
  if(!response.ok)return unavailable;
  const data=obj(obj(await boundedJson(response))?.data);
  if(!data||data.id!==runId)return unavailable;
  const charge=data.usageTotalUsd;
  const cost=typeof charge==='number'&&Number.isFinite(charge)&&
    charge>=0&&charge<=100?charge:null;
  if(['READY','RUNNING'].includes(String(data.status)))
   return {status:'running',costUsd:cost,providerReportedUnfollow:false};
  if(['FAILED','TIMED-OUT','ABORTED'].includes(String(data.status)))
   return {status:'failed',costUsd:cost,providerReportedUnfollow:false};
  if(data.status!=='SUCCEEDED'||!validRunId(data.defaultDatasetId))
   return {status:'ambiguous',costUsd:cost,providerReportedUnfollow:false};
  const url=new URL('https://api.apify.com/v2/datasets/'+data.defaultDatasetId+'/items');
  url.searchParams.set('format','json');
  url.searchParams.set('limit','2');
  const dataset=await fetcher(url.toString(),{
   method:'GET',headers:headers(token),cache:'no-store',
   credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),
  });
  if(!dataset.ok)return {...unavailable,costUsd:cost};
  const rows=await boundedJson(dataset);
  if(!Array.isArray(rows)||rows.length!==1)
   return {status:'ambiguous',costUsd:cost,providerReportedUnfollow:false};
  const item=obj(rows[0]);
  if(!item||item.username!==target||item.action!=='unfollow')
   return {status:'ambiguous',costUsd:cost,providerReportedUnfollow:false};
  if(item.status==='success')
   return {status:'provider-reported',costUsd:cost,providerReportedUnfollow:true};
  if(['blocked','rate_limited','auth_error'].includes(String(item.status)))
   return {status:'provider-blocked',costUsd:cost,providerReportedUnfollow:false};
  if(item.status==='failed')
   return {status:'provider-rejected',costUsd:cost,providerReportedUnfollow:false};
  return {status:'ambiguous',costUsd:cost,providerReportedUnfollow:false};
 }catch{return unavailable;}
}
