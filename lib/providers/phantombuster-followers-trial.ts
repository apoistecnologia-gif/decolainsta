import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type TrialLaunch=
  |{status:'accepted';containerId:string}
  |{status:'invalid-key'|'rate-limited'|'uncertain'};
export type TrialContainer='in-progress'|'finished'|'failed'|
  'invalid-key'|'rate-limited'|'unavailable'|'not-found'|'mismatch';

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
  if(!data||numeric(data.id??data._id)!==containerId||
    numeric(data.agentId)!==agentId)return 'mismatch';
  const exitCode=data.exitCode;
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
    return raw===null?'unavailable':parseTrialContainer(raw,agentId,containerId);
  }catch{return 'unavailable';}
}
