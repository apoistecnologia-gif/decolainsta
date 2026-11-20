/**
 * Read-only saved configuration check; no raw session, arguments, keys,
 * passwords or URLs leave this module. An uncertain manifest fails closed.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { inspectFollowersAutoFollowDocument } from './phantombuster-followers-auto-follow';
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type PrivateFilterStatus='enabled'|'disabled'|'unverified'|
  'agent-mismatch'|'unavailable'|'invalid-key'|'rate-limited';
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
const label=(v:unknown):boolean=>
  typeof v==='string'&&v.trim().replace(/\s*\(optional\)\s*$/i,'')
    .replace(/\s+/g,' ').toLowerCase()==='exclude private profiles';
const field=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v);
const checkbox=(o:Record<string,unknown>)=>
  [o.type,o.inputType,o.component].some(x=>typeof x==='string'&&
    ['boolean','checkbox','toggle','switch'].includes(x.toLowerCase()));
function argumentsOf(raw:unknown):Record<string,unknown>|null{
  if(typeof raw==='string'){
    if(raw.length>120000)return null;
    try{return obj(JSON.parse(raw) as unknown);}catch{return null;}
  }
  return obj(raw);
}

/** Require unambiguous mapping from exact visible label to boolean input. */
export function readSavedPrivateFilter(
  raw:unknown,agentId:string,reference:string,
):PrivateFilterStatus{
  if(inspectFollowersAutoFollowDocument(raw,agentId,reference)!=='matched')
    return 'agent-mismatch';
  const box=obj(raw);
  const agent=obj(box?.data)??box;
  const manifest=obj(agent?.manifest);
  const args=argumentsOf(agent?.argument);
  if(!manifest||!args)return 'unverified';
  const names=new Set<string>();
  const properties=obj(obj(manifest.argumentSchema)?.properties);
  if(properties&&Object.keys(properties).length<=200){
    for(const [name,def] of Object.entries(properties)){
      const d=obj(def);
      if(field(name)&&d&&label(d.title??d.label)&&d.type==='boolean')
        names.add(name);
    }
  }
  const queue:unknown[]=[manifest.argumentForm];
  let steps=0;
  while(queue.length&&steps<300){
    const part=queue.shift();
    steps++;
    if(Array.isArray(part)){
      if(part.length<=100)queue.push(...part);
      else return 'unverified';
      continue;
    }
    const d=obj(part);
    if(!d)continue;
    if(label(d.label??d.title)&&checkbox(d)){
      const name=d.name??d.key??d.field;
      if(field(name))names.add(name);
    }
    for(const key of ['steps','fields','inputs','sections','groups','children']){
      if(Object.prototype.hasOwnProperty.call(d,key))queue.push(d[key]);
    }
  }
  if(queue.length||names.size!==1)return 'unverified';
  const key=[...names][0];
  if(typeof args[key]!=='boolean')return 'unverified';
  return args[key]?'enabled':'disabled';
}

async function boundedJson(response:Response):Promise<unknown>{
  if(!response.body||Number(response.headers.get('content-length')??0)>250000)
    return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let raw='',bytes=0;
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>250000){await reader.cancel();return null;}
      raw+=decoder.decode(chunk.value,{stream:true});
    }
    return JSON.parse(raw+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}

/** GET /agents/fetch only; never launches, saves or schedules any Phantom. */
export async function inspectSavedPrivateFilter(
  apiKey:string,agentId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<PrivateFilterStatus>{
  if(!apiKey||apiKey.length>512||!/^\d{10,25}$/.test(agentId)||
    !/^[a-z0-9._]{1,30}$/.test(reference))return 'unavailable';
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch');
    url.searchParams.set('id',agentId);
    url.searchParams.set('withManifest','true');
    url.searchParams.set('withCode','false');
    const res=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      credentials:'omit',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),
    });
    if(res.status===401||res.status===403)return 'invalid-key';
    if(res.status===429)return 'rate-limited';
    if(!res.ok)return 'unavailable';
    const json=await boundedJson(res);
    return json===null?'unavailable':readSavedPrivateFilter(json,agentId,reference);
  }catch{return 'unavailable';}
}
