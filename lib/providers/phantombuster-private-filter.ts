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
  'provider-rate-limited'|'manifest-access-denied'|'agent-not-found'|
  'agent-script-missing'|'manifest-request-rejected'|
  'provider-service-error'|'response-too-large'|'response-malformed'|
  'provider-timeout'|'provider-forbidden'|
  'listed-agent-manifest-unavailable'|'inventory-unavailable'|'inventory-mismatch';
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

async function boundedJson(response:Response):Promise<
  {ok:true;value:unknown}|{ok:false;reason:'response-too-large'|'response-malformed'}
>{
  const declared=response.headers.get('content-length');
  if(declared!==null&&Number.isFinite(Number(declared))&&
    Number(declared)>250000)
    return {ok:false,reason:'response-too-large'};
  if(!response.body)return {ok:false,reason:'response-malformed'};
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let raw='',bytes=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>250000){await reader.cancel();
        return {ok:false,reason:'response-too-large'};}
      raw+=decoder.decode(part.value,{stream:true});
    }
    return {ok:true,value:JSON.parse(raw+decoder.decode()) as unknown};
  }catch{return {ok:false,reason:'response-malformed'};}
  finally{reader.releaseLock();}
}
/** Validate the exact, single inventory entry if detail fetch returned 404.
 * Inventory is a legitimate fallback for agent identity, not evidence that
 * the private-profile filter is enabled. Require the SAME manifest proof.
 */
async function inspectInventoryFallback(
  agentId:string,reference:string,fetcher:Fetcher,opts:RequestInit,
):Promise<PrivateFilterDiagnosis>{
  const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
  url.searchParams.set('agentIds',agentId);
  url.searchParams.set('withArgument','true');
  try{
    const response=await fetcher(url.toString(),opts);
    if(!response.ok)return unverified('inventory-unavailable');
    const payload=await boundedJson(response);
    if(!payload.ok)return unverified('inventory-unavailable');
    const value=obj(payload.value);
    const rows=Array.isArray(payload.value)?payload.value:
      Array.isArray(value?.data)?value.data:
      Array.isArray(value?.agents)?value.agents:null;
    if(!rows||rows.length!==1)return unverified('inventory-unavailable');
    const candidate=obj(rows[0]);
    if(!candidate||String(candidate.id??candidate._id??'')!==agentId)
      return unverified('inventory-mismatch');
    if(inspectFollowersAutoFollowDocument(candidate,agentId,reference)!=='matched')
      return {status:'agent-mismatch',reason:'agent-mismatch'};
    const diagnosis=diagnoseSavedPrivateFilter(candidate,agentId,reference);
    // The documented inventory API does not promise manifest metadata.
    // A correct ID and arguments cannot establish exclusion by themselves.
    return diagnosis.reason==='manifest-absent'
      ? unverified('listed-agent-manifest-unavailable'):diagnosis;
  }catch{return unverified('inventory-unavailable');}
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
    const opts:RequestInit={
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      credentials:'omit',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),
    };
    const res=await fetcher(url.toString(),opts);
    // The official /agents/fetch documentation distinguishes a 401 for
    // inaccessible manifest from general authentication on plain /fetch.
    // This request includes withManifest=true, so do NOT claim the API key
    // is invalid when the agent is otherwise readable.
    if(res.status===401)
      return unverified('manifest-access-denied');
    if(res.status===403)return unverified('provider-forbidden');
    if(res.status===404)
      return inspectInventoryFallback(agentId,reference,fetcher,opts);
    if(res.status===412)return unverified('agent-script-missing');
    if(res.status===400)return unverified('manifest-request-rejected');
    if(res.status===429)
      return {status:'rate-limited',reason:'provider-rate-limited'};
    if(res.status>=500)return {status:'unavailable',reason:'provider-service-error'};
    if(!res.ok)return unavailable;
    const payload=await boundedJson(res);
    return payload.ok
      ? diagnoseSavedPrivateFilter(payload.value,agentId,reference)
      : unverified(payload.reason);
  }catch(error){
    if(error instanceof Error&&
      (error.name==='TimeoutError'||error.name==='AbortError'))
      return {status:'unavailable',reason:'provider-timeout'};
    return unavailable;
  }
}
export async function inspectSavedPrivateFilter(
  apiKey:string,agentId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<PrivateFilterStatus>{
  return (await inspectSavedPrivateFilterDetails(
    apiKey,agentId,reference,fetcher)).status;
}
