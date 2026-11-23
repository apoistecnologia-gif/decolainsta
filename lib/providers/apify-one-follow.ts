/** Controlled ONE-follow Apify integration. No cookie is ever persisted in Neon,
 * returned to browser, logged, or included in error responses.
 */
export const APIFY_ONE_FOLLOW_ACTOR='dead00~instagram-follow-unfollow-bot';
export const APIFY_ONE_FOLLOW_ACTION='apify_one_follow_attempt_v1';
export const APIFY_ONE_FOLLOW_MAX_USD=0.25;
export const APIFY_ONE_FOLLOW_LIMIT=1;

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Json=Record<string,unknown>;
const obj=(v:unknown):Json|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Json:null;
const validTarget=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
const validRunId=(v:unknown):v is string=>
  typeof v==='string'&&/^[A-Za-z0-9]{17,24}$/.test(v);
const validToken=(v:unknown):v is string=>
  typeof v==='string'&&v.length>=12&&v.length<=512&&!/[\r\n]/.test(v);
/** Stable identity, never just a mutable username. Older usernames remain
 * protected aliases of the SAME Instagram account.
 */
export type InstagramExecutorIdentity=Readonly<{
  instagramUserId:string;username:string;
  previousUsernames:readonly string[];
  targetInstagramUserId?:string|null;
}>;
const HISTORICAL_PILOT_SELF_ALIASES=['apoistecnologia','contateste6699'] as const;
const normalizeUsername=(value:string)=>value.trim().replace(/^@/,'').toLowerCase();
const validIdentity=(identity:InstagramExecutorIdentity|undefined):identity is InstagramExecutorIdentity=>
  !!identity&&typeof identity.instagramUserId==='string'&&
  /^\d{4,30}$/.test(identity.instagramUserId)&&
  typeof identity.username==='string'&&
  validTarget(normalizeUsername(identity.username))&&
  Array.isArray(identity.previousUsernames)&&
  identity.previousUsernames.every(name=>
    typeof name==='string'&&validTarget(normalizeUsername(name)))&&
  (identity.targetInstagramUserId==null||
    /^\d{4,30}$/.test(identity.targetInstagramUserId));
export function isSelfFollowTarget(
  target:string,identity:InstagramExecutorIdentity,
):boolean{
  const normalized=normalizeUsername(target);
  return HISTORICAL_PILOT_SELF_ALIASES.includes(
      normalized as typeof HISTORICAL_PILOT_SELF_ALIASES[number])||
    [identity.username,...identity.previousUsernames]
      .some(alias=>normalizeUsername(alias)===normalized)||
    (identity.targetInstagramUserId!=null&&
      identity.targetInstagramUserId===identity.instagramUserId);
}
type Cookie={name:'sessionid'|'csrftoken';value:string};
/** Extract only two strictly named Instagram cookies from Vercel secret.
 * Even if user supplies an entire browser export, no other cookies are
 * forwarded to the third-party Actor.
 */
export function parseMinimalInstagramCookies(secret:unknown):Cookie[]|null{
  if(typeof secret!=='string'||secret.length>9000||secret.length<60)return null;
  let parsed:unknown;
  try{parsed=JSON.parse(secret);}catch{return null;}
  if(!Array.isArray(parsed)||parsed.length<2||parsed.length>25)return null;
  const values=new Map<string,string>();
  for(const raw of parsed){
    const item=obj(raw);
    if(!item||typeof item.name!=='string')return null;
    if(item.name!=='sessionid'&&item.name!=='csrftoken')continue;
    if(values.has(item.name)||typeof item.value!=='string'||!item.value||
       item.value.length>1000||/[\r\n]/.test(item.value)||
       (item.domain!==undefined&&
         !['instagram.com','.instagram.com','www.instagram.com'].includes(
           String(item.domain))))return null;
    values.set(item.name,item.value);
  }
  const sessionid=values.get('sessionid');
  const csrftoken=values.get('csrftoken');
  if(!sessionid||!csrftoken||sessionid.length<18||csrftoken.length<8)
    return null;
  return [
    {name:'sessionid',value:sessionid},
    {name:'csrftoken',value:csrftoken},
  ];
}
async function boundedJson(response:Response):Promise<unknown>{
  const reported=Number(response.headers.get('content-length')||0);
  if(reported>32_000||!response.body)return null;
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let text='',bytes=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>32_000){await reader.cancel();return null;}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
const headers=(token:string)=>({Authorization:'Bearer '+token,
  Accept:'application/json'});
export type SingleFollowStart=
 |{status:'queued';runId:string}
 |{status:'refused'|'unconfirmed';runId:null};
/** A SINGLE POST after a durable database claim. Timeout/5xx are uncertain,
 * never reason to retry. maxTotalChargeUsd is a provider-level cost ceiling.
 */
export async function startOneFollow(
  token:string|undefined,secret:string|undefined,target:string,
  identity:InstagramExecutorIdentity|undefined,fetcher:Fetcher=fetch,
):Promise<SingleFollowStart>{
  const cookies=parseMinimalInstagramCookies(secret);
  if(!validToken(token)||!cookies||!validTarget(target)||
    !validIdentity(identity)||isSelfFollowTarget(target,identity))
    return {status:'refused',runId:null};
  const url=new URL('https://api.apify.com/v2/acts/'+APIFY_ONE_FOLLOW_ACTOR+'/runs');
  url.searchParams.set('maxTotalChargeUsd',String(APIFY_ONE_FOLLOW_MAX_USD));
  url.searchParams.set('maxItems','1');
  url.searchParams.set('timeout','180');
  try{
    const response=await fetcher(url.toString(),{
      method:'POST',
      headers:{...headers(token),'Content-Type':'application/json'},
      body:JSON.stringify({
        cookies,action:'follow',usernames:[target],maxActionsPerRun:1,
      }),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(12000),
    });
    if([400,401,402,403,404,422,429].includes(response.status))
      return {status:'refused',runId:null};
    if(!response.ok)return {status:'unconfirmed',runId:null};
    const data=obj(obj(await boundedJson(response))?.data);
    return validRunId(data?.id)?{status:'queued',runId:data.id}
      :{status:'unconfirmed',runId:null};
  }catch{
    return {status:'unconfirmed',runId:null};
  }
}
export type SingleFollowResult=
 |{status:'running'|'unavailable'|'failed'|'ambiguous';costUsd:number|null;
   providerReportedFollow:false}
 |{status:'provider-reported'|'provider-rejected'|'provider-blocked';
   costUsd:number|null;providerReportedFollow:boolean};

/** Only the exact run and a one-item dataset can be inspected. Do not expose
 * provider logs, input, full dataset or any authentication material.
 */
export async function inspectOneFollow(
  token:string|undefined,runId:string,target:string,fetcher:Fetcher=fetch,
):Promise<SingleFollowResult>{
  const unavailable:SingleFollowResult={status:'unavailable',costUsd:null,
    providerReportedFollow:false};
  if(!validToken(token)||!validRunId(runId)||!validTarget(target))
    return unavailable;
  try{
    const status=await fetcher('https://api.apify.com/v2/actor-runs/'+runId,{
      method:'GET',headers:headers(token),cache:'no-store',
      credentials:'omit',redirect:'error',signal:AbortSignal.timeout(9000),
    });
    if(!status.ok)return unavailable;
    const data=obj(obj(await boundedJson(status))?.data);
    if(!data||data.id!==runId)return unavailable;
    const price=data.usageTotalUsd;
    const cost=typeof price==='number'&&Number.isFinite(price)&&
      price>=0&&price<=100?price:null;
    const running:SingleFollowResult={status:'running',costUsd:cost,
      providerReportedFollow:false};
    if(['READY','RUNNING'].includes(String(data.status)))return running;
    if(['FAILED','TIMED-OUT','ABORTED'].includes(String(data.status)))
      return {status:'failed',costUsd:cost,providerReportedFollow:false};
    if(data.status!=='SUCCEEDED'||!validRunId(data.defaultDatasetId))
      return {status:'ambiguous',costUsd:cost,providerReportedFollow:false};
    const url=new URL('https://api.apify.com/v2/datasets/'+data.defaultDatasetId+'/items');
    url.searchParams.set('format','json');
    url.searchParams.set('limit','2');
    // A finished run can expose a billable amount even when its dataset is
    // unavailable. Preserve that provider cost without claiming a follow.
    let response:Response;
    try{
      response=await fetcher(url.toString(),{
        method:'GET',headers:headers(token),cache:'no-store',
        credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),
      });
    }catch{return {...unavailable,costUsd:cost};}
    if(!response.ok)return {...unavailable,costUsd:cost};
    const items=await boundedJson(response);
    if(!Array.isArray(items)||items.length!==1)
      return {status:'ambiguous',costUsd:cost,providerReportedFollow:false};
    const item=obj(items[0]);
    if(!item||item.username!==target||item.action!=='follow')
      return {status:'ambiguous',costUsd:cost,providerReportedFollow:false};
    if(item.status==='success')
      return {status:'provider-reported',costUsd:cost,providerReportedFollow:true};
    if(['blocked','rate_limited','auth_error'].includes(String(item.status)))
      return {status:'provider-blocked',costUsd:cost,providerReportedFollow:false};
    if(item.status==='failed')
      return {status:'provider-rejected',costUsd:cost,providerReportedFollow:false};
    return {status:'ambiguous',costUsd:cost,providerReportedFollow:false};
  }catch{return unavailable;}
}
