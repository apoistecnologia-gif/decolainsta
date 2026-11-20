import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type TrialLaunch=
  |{status:'accepted';containerId:string}
  |{status:'invalid-key'|'rate-limited'|'uncertain'};
export type TrialContainer='in-progress'|'finished'|'failed'|
  'invalid-key'|'rate-limited'|'unavailable'|'not-found'|'mismatch'|
  'membership-unverified';

const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
const numeric=(v:unknown):string|null=>{
  const s=String(v??'');
  return /^\d{10,25}$/.test(s)?s:null;
};
async function readBounded(res:Response,max:number):Promise<unknown>{
  if(!res.body||Number(res.headers.get('content-length')??0)>max)return null;
  let size=0,raw='';
  const reader=res.body.getReader(),dec=new TextDecoder();
  try{
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>max){await reader.cancel();return null;}
      raw+=dec.decode(chunk.value,{stream:true});
    }
    return JSON.parse(raw+dec.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}

/** Once-only caller must reserve an attempt BEFORE calling this function.
 * No retries, no request arguments, no session cookies or redirects.
 */
export async function launchFollowersTrial(
  apiKey:string,agentId:string,fetcher:Fetcher=fetch,
):Promise<TrialLaunch>{
  if(!apiKey||apiKey.length>512||!numeric(agentId))
    return {status:'uncertain'};
  try{
    const res=await fetcher('https://api.phantombuster.com/api/v2/agents/launch',{
      method:'POST',headers:{
        ...phantomBusterRequestHeaders(apiKey),
        'Content-Type':'application/json',
      },
      body:JSON.stringify({id:agentId,manualLaunch:true,maxInstanceCount:1}),
      cache:'no-store',redirect:'error',credentials:'omit',
      signal:AbortSignal.timeout(9000),
    });
    if(res.status===401||res.status===403)return {status:'invalid-key'};
    if(res.status===429)return {status:'rate-limited'};
    if(!res.ok)return {status:'uncertain'};
    const data=obj(await readBounded(res,8000));
    const value=obj(data?.data)??data;
    const containerId=numeric(value?.containerId);
    return containerId?{status:'accepted',containerId}:{status:'uncertain'};
  }catch{return {status:'uncertain'};}
}
/** Parse only exact ID/membership and terminal code; never infer Instagram
 * follow success from an exit code, even zero.
 */
export function parseTrialContainer(raw:unknown,agentId:string,containerId:string):
  TrialContainer {
  const outer=obj(raw);
  const data=obj(outer?.data)??outer;
  if(!data || numeric(data.id??data.containerId??data._id)!==containerId)
    return 'mismatch';
  // The API's container detail does not consistently include an agentId.
  // A missing agent field is not a mismatch; membership needs a second
  // read-only verification via /containers/fetch-all?agentId=....
  const linkedAgent=data.agentId??data.phantomId??
    (typeof data.agent==='object'?obj(data.agent)?.id:data.agent);
  if(linkedAgent===undefined||linkedAgent===null)
    return 'membership-unverified';
  if(numeric(linkedAgent)!==agentId)return 'mismatch';
  const exitCode=data.exitCode;
  if(typeof exitCode==='number'&&Number.isInteger(exitCode))
    return exitCode===0?'finished':'failed';
  return 'in-progress';
}

/**
 * Called only after the exact run ID was returned by a recorded launch.
 * The official fetch-all API scopes history by agentId; this is the
 * membership proof when /containers/fetch omits the agent field.
 * We never infer an Instagram follow from a successful container exit.
 */
export function parseAgentScopedContainer(
  raw:unknown,agentId:string,containerId:string,detail:unknown,
):TrialContainer {
  const outer=obj(raw);
  const entries=Array.isArray(raw)?raw:
    Array.isArray(outer?.data)?outer.data:
    Array.isArray(outer?.containers)?outer.containers:null;
  if(!entries || entries.length>50)return 'membership-unverified';
  const matching=entries.filter(item=>{
    const row=obj(item);
    return row && numeric(row.id??row.containerId??row._id)===containerId;
  });
  if(matching.length!==1)return 'membership-unverified';
  const match=obj(matching[0]);
  if(!match)return 'membership-unverified';
  const claimedAgent=match.agentId??match.phantomId;
  if(claimedAgent!==undefined&&claimedAgent!==null&&
     numeric(claimedAgent)!==agentId)return 'mismatch';
  const response=obj(detail);
  const payload=obj(response?.data)??response;
  if(!payload || numeric(payload.id??payload.containerId??payload._id)!==containerId)
    return 'mismatch';
  const exitCode=payload.exitCode;
  if(typeof exitCode==='number'&&Number.isInteger(exitCode))
    return exitCode===0?'finished':'failed';
  return 'in-progress';
}
export async function inspectTrialContainer(
  apiKey:string,agentId:string,containerId:string,fetcher:Fetcher=fetch,
):Promise<TrialContainer>{
  if(!apiKey||apiKey.length>512||!numeric(agentId)||!numeric(containerId))
    return 'unavailable';
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch');
    url.searchParams.set('id',containerId);
    const res=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',redirect:'error',credentials:'omit',
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401||res.status===403)return 'invalid-key';
    if(res.status===429)return 'rate-limited';
    if(res.status===404)return 'not-found';
    if(!res.ok)return 'unavailable';
    const raw=await readBounded(res,60000);
    if(raw===null)return 'unavailable';
    const direct=parseTrialContainer(raw,agentId,containerId);
    if(direct!=='membership-unverified')return direct;

    // Official API: GET /containers/fetch-all uses an AGENT ID and returns
    // that Phantom's run history. Only use it to prove membership of the
    // already saved container ID; never fetch another run's result.
    const history=new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    history.searchParams.set('agentId',agentId);
    history.searchParams.set('mode','all');
    history.searchParams.set('limit','50');
    const scoped=await fetcher(history.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',redirect:'error',credentials:'omit',
      signal:AbortSignal.timeout(8000),
    });
    if(scoped.status===401||scoped.status===403)return 'invalid-key';
    if(scoped.status===429)return 'rate-limited';
    if(!scoped.ok)return 'membership-unverified';
    const historyPayload=await readBounded(scoped,250000);
    if(historyPayload===null)return 'membership-unverified';
    return parseAgentScopedContainer(historyPayload,agentId,containerId,raw);
  }catch{return 'unavailable';}
}
