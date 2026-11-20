/**
 * Read-only, fail-closed privacy filter diagnosis for one saved Phantom.
 * The saved agent and reference must match before inspecting its manifest.
 * No agent writes, launches, scheduling, raw arguments or credentials leave
 * this adapter. Provider field names are never guessed.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { inspectFollowersAutoFollowDocument } from './phantombuster-followers-auto-follow';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type PrivateFilterStatus='enabled'|'disabled'|'unverified'|
  'agent-mismatch'|'unavailable'|'invalid-key'|'rate-limited';
export type PrivateFilterReason=
  'verified'|'agent-mismatch'|'manifest-absent'|'manifest-invalid'|
  'filter-not-described'|'filter-ambiguous'|'saved-argument-missing'|
  'saved-value-invalid'|'provider-unavailable'|'provider-auth-failed'|
  'provider-rate-limited';
export type PrivateFilterDiagnosis={
  status:PrivateFilterStatus;reason:PrivateFilterReason;
};
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
const named=(v:unknown):boolean=>
  typeof v==='string'&&v.trim().replace(/\s*\(optional\)\s*$/i,'')
    .replace(/\s+/g,' ').toLowerCase()==='exclude private profiles';
const fieldName=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(v);
const booleanField=(v:Record<string,unknown>):boolean=>
  [v.type,v.inputType,v.component].some(x=>
    typeof x==='string'&&['boolean','checkbox','toggle','switch'].includes(x.toLowerCase()));
const unverified=(reason:PrivateFilterReason):PrivateFilterDiagnosis=>({
  status:'unverified',reason,
});
function parseObject(input:unknown,limit:number):Record<string,unknown>|null{
  if(typeof input==='string'){
    if(input.length>limit)return null;
    try{return obj(JSON.parse(input) as unknown);}catch{return null;}
  }
  return obj(input);
}
/** Only an explicit, unique boolean manifest field can prove the flag. */
export function diagnoseSavedPrivateFilter(
  raw:unknown,agentId:string,reference:string,
):PrivateFilterDiagnosis{
  if(inspectFollowersAutoFollowDocument(raw,agentId,reference)!=='matched')
    return {status:'agent-mismatch',reason:'agent-mismatch'};
  const wrapper=obj(raw);
  const agent=obj(wrapper?.data)??wrapper;
  const argument=parseObject(agent?.argument,120000);
  const rawManifest=agent?.manifest;
  if(rawManifest===null||rawManifest===undefined)
    return unverified('manifest-absent');
  const manifest=parseObject(rawManifest,120000);
  if(!manifest)return unverified('manifest-invalid');
  const keys=new Set<string>();
  const schema=obj(manifest.argumentSchema);
  const props=obj(schema?.properties);
  if(props){
    if(Object.keys(props).length>200)return unverified('manifest-invalid');
    for(const [key,value] of Object.entries(props)){
      const definition=obj(value);
      if(fieldName(key)&&definition&&named(definition.title??definition.label)&&
        definition.type==='boolean')keys.add(key);
    }
  }
  // Only the manifest's known UI metadata is traversed. Never scan raw
  // arguments, cookies, descriptions, provider logs, or arbitrary fields.
  const queue:unknown[]=[manifest.argumentForm];
  let steps=0;
  while(queue.length&&steps<300){
    const part=queue.shift();steps++;
    if(Array.isArray(part)){
      if(part.length>100)return unverified('manifest-invalid');
      queue.push(...part);
      continue;
    }
    const node=obj(part);
    if(!node)continue;
    if(named(node.label??node.title)&&booleanField(node)){
      const key=node.name??node.key??node.field;
      if(fieldName(key))keys.add(key);
    }
    for(const child of ['steps','fields','inputs','sections','groups','children']){
      if(Object.prototype.hasOwnProperty.call(node,child))
        queue.push(node[child]);
    }
  }
  if(queue.length)return unverified('manifest-invalid');
  if(!keys.size)return unverified('filter-not-described');
  if(keys.size!==1)return unverified('filter-ambiguous');
  const key=[...keys][0];
  if(!argument||!Object.prototype.hasOwnProperty.call(argument,key))
    return unverified('saved-argument-missing');
  if(typeof argument[key]!=='boolean')
    return unverified('saved-value-invalid');
  return {status:argument[key]?'enabled':'disabled',reason:'verified'};
}
export const readSavedPrivateFilter=(
  raw:unknown,agentId:string,reference:string,
):PrivateFilterStatus=>diagnoseSavedPrivateFilter(raw,agentId,reference).status;

async function boundedJson(response:Response):Promise<unknown>{
  if(!response.body||Number(response.headers.get('content-length')??0)>250000)
    return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let raw='',bytes=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>250000){await reader.cancel();return null;}
      raw+=decoder.decode(part.value,{stream:true});
    }
    return JSON.parse(raw+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
export async function inspectSavedPrivateFilterDetails(
  apiKey:string,agentId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<PrivateFilterDiagnosis>{
  const unavailable:PrivateFilterDiagnosis={
    status:'unavailable',reason:'provider-unavailable',
  };
  if(!apiKey||apiKey.length>512||!/^\d{10,25}$/.test(agentId)||
    !/^[a-z0-9._]{1,30}$/.test(reference))return unavailable;
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
    if(res.status===401||res.status===403)
      return {status:'invalid-key',reason:'provider-auth-failed'};
    if(res.status===429)
      return {status:'rate-limited',reason:'provider-rate-limited'};
    if(!res.ok)return unavailable;
    const payload=await boundedJson(res);
    return payload===null?unavailable:
      diagnoseSavedPrivateFilter(payload,agentId,reference);
  }catch{return unavailable;}
}
export async function inspectSavedPrivateFilter(
  apiKey:string,agentId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<PrivateFilterStatus>{
  return (await inspectSavedPrivateFilterDetails(
    apiKey,agentId,reference,fetcher)).status;
}
