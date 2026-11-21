import {phantomBusterRequestHeaders} from './phantombuster-request-headers';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Dict=Record<string,unknown>;
const obj=(v:unknown):Dict|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Dict:null;
const idOk=(v:string)=>/^\d{10,25}$/.test(v);
async function limitedJson(res:Response):Promise<unknown>{
  if(!res.body||Number(res.headers.get('content-length')||0)>160_000)return null;
  const reader=res.body.getReader(),dec=new TextDecoder();
  let total=0,s='';
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      total+=chunk.value.byteLength;
      if(total>160_000){await reader.cancel();return null;}
      s+=dec.decode(chunk.value,{stream:true});
    }
    return JSON.parse(s+dec.decode()) as unknown;
  }catch{return null;}
  finally{reader.releaseLock();}
}
export type FailedRetryPreflight='ready'|'other-run'|'active'|'unavailable';

/** The operator may retry only when the exact *failed* receipt is the
 * provider's latest container for this agent and there is no active launch.
 * No provider writes; never use mutable agent-wide result files.
 */
export async function inspectFailedRetryPreflight(
  apiKey:string,agentId:string,oldContainerId:string,fetcher:Fetcher=fetch,
):Promise<FailedRetryPreflight>{
  if(!apiKey||apiKey.length>512||!idOk(agentId)||!idOk(oldContainerId))
    return 'unavailable';
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    url.searchParams.set('agentId',agentId);
    url.searchParams.set('mode','all');
    url.searchParams.set('limit','5');
    url.searchParams.set('withRuntimeEvents','false');
    const result=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(8000),
    });
    if(!result.ok)return 'unavailable';
    const raw=await limitedJson(result);
    const root=obj(raw);
    if((!root&&!Array.isArray(raw))||root?.status==='error')
      return 'unavailable';
    const nested=obj(root?.data);
    const items=Array.isArray(raw)?raw:
      Array.isArray(root?.data)?root.data:
      Array.isArray(root?.containers)?root.containers:
      nested&&Array.isArray(nested.containers)?nested.containers:null;
    if(!items||!items.length||items.length>5)return 'unavailable';
    const rows=items.map(obj);
    if(rows.some(r=>!r||!idOk(String(r.id??''))||
       (r.agentId!==undefined&&String(r.agentId)!==agentId)))
      return 'unavailable';
    if(rows.some(r=>['running','queued','pending','launching','started',
      'in_progress','in-progress','executing'].includes(
        String(r?.status??'').toLowerCase())))return 'active';
    // A different most-recent run means someone changed PhantomBuster after
    // the failed receipt: manual reconciliation is needed, not duplication.
    const latest=rows[0]!;
    if(String(latest?.id)!==oldContainerId)return 'other-run';
    return ['failed','error','aborted','cancelled','canceled'].includes(
      String(latest?.status??'').toLowerCase())?'ready':'unavailable';
  }catch{return 'unavailable';}
}
