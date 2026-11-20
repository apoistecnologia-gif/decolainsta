/**
 * Fail-closed inspection of a PRE-EXISTING PhantomBuster Auto Unfollow agent.
 * NEVER creates, modifies, schedules or launches an agent.
 * The provider's private configuration is never returned.
 */
import {phantomBusterRequestHeaders} from './phantombuster-request-headers';
type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export type AutoUnfollowReadiness=
  'unconfigured'|'unavailable'|'invalid-key'|'rate-limited'|
  'wrong-agent'|'scheduled'|'unverified-manifest'|
  'unverified-filter'|'unsafe-limit'|'ready-for-review';
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const parse=(v:unknown):Record<string,unknown>|null=>{
  if(typeof v==='string'){
    if(v.length>120000)return null;
    try{return obj(JSON.parse(v) as unknown);}catch{return null;}
  }
  return obj(v);
};
const normalized=(v:unknown):string=>
  typeof v==='string'?v.toLowerCase().replace(/[’‘]/g,"'")
    .replace(/\s+/g,' ').trim():'';
const optionName=(v:unknown)=>
  normalized(v)==="unfollow only if they don't follow you"||
  normalized(v)==="unfollow only if they don't follow you back";
const inputName=(v:unknown)=>
  normalized(v)==='unfollow action'||normalized(v)==='action';
const countKeys=[
  'numberOfProfilesToProcess','numberProfilesPerLaunch',
  'numberOfProfilesPerLaunch','numberOfProfiles',
  'numberOfUnfollows','numberOfProfilesToUnfollow',
];

/** Only manifest-declared enum mapping proves protective selection. */
export function inspectAutoUnfollowDocument(raw:unknown,agentId:string):
  AutoUnfollowReadiness{
  const envelope=obj(raw);
  const agent=obj(envelope?.data)??envelope;
  if(!agent||String(agent.id??agent._id??'')!==agentId)
    return 'wrong-agent';
  if(agent.script!=='Instagram Auto Unfollow.js')
    return 'wrong-agent';
  if(agent.launchType!=='manually')return 'scheduled';
  const args=parse(agent.argument),manifest=parse(agent.manifest);
  if(!args||!manifest)return 'unverified-manifest';
  const declared=countKeys.filter(key=>args[key]!==undefined);
  if(!declared.length||!declared.every(key=>args[key]===1))
    return 'unsafe-limit';
  const matches=new Set<string>();
  const queue:unknown[]=[manifest.argumentForm];
  let inspected=0;
  while(queue.length&&inspected<300){
    const value=queue.shift();inspected++;
    if(Array.isArray(value)){
      if(value.length>100)return 'unverified-manifest';
      queue.push(...value);continue;
    }
    const node=obj(value);if(!node)continue;
    const fields=obj(node.fields);
    if(fields){
      if(Object.keys(fields).length>100)return 'unverified-manifest';
      for(const [key,def] of Object.entries(fields)){
        if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key))continue;
        const field=obj(def);
        if(!field||!inputName(field.label??field.title))continue;
        const options=Array.isArray(field.options)?field.options:null;
        if(!options||options.length>50)continue;
        for(const item of options){
          const opt=obj(item);
          if(opt&&optionName(opt.label??opt.name)&&
            typeof opt.value==='string'&&
            args[key]===opt.value)
            matches.add(key);
        }
      }
    }
    for(const child of ['steps','sections','children']){
      if(Object.prototype.hasOwnProperty.call(node,child))
        queue.push(node[child]);
    }
  }
  if(queue.length)return 'unverified-manifest';
  return matches.size===1?'ready-for-review':'unverified-filter';
}
async function boundedJson(res:Response):Promise<unknown>{
  if(!res.body||Number(res.headers.get('content-length')??0)>200000)return null;
  const reader=res.body.getReader(),decoder=new TextDecoder();
  let bytes=0,raw='';
  try{
    for(;;){
      const item=await reader.read();if(item.done)break;
      bytes+=item.value.byteLength;
      if(bytes>200000){await reader.cancel();return null;}
      raw+=decoder.decode(item.value,{stream:true});
    }
    return JSON.parse(raw+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
export async function inspectExistingAutoUnfollowAgent(
  apiKey:string,agentId:string,fetcher:Fetcher=fetch,
):Promise<AutoUnfollowReadiness>{
  if(!apiKey||apiKey.length>512||!/^\d{10,25}$/.test(agentId))
    return 'unconfigured';
  const opts:RequestInit={
    method:'GET',headers:phantomBusterRequestHeaders(apiKey),
    credentials:'omit',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(8000),
  };
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch');
    url.searchParams.set('id',agentId);
    url.searchParams.set('withManifest','true');
    url.searchParams.set('withCode','false');
    const res=await fetcher(url.toString(),opts);
    if(res.status===401||res.status===403)return 'invalid-key';
    if(res.status===429)return 'rate-limited';
    if(res.ok)return inspectAutoUnfollowDocument(await boundedJson(res),agentId);
    if(res.status!==404)return 'unavailable';
    const fallback=new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
    fallback.searchParams.set('agentIds',agentId);
    fallback.searchParams.set('withArgument','true');
    const inv=await fetcher(fallback.toString(),opts);
    if(!inv.ok)return 'unavailable';
    const payload=await boundedJson(inv);
    const wrapped=obj(payload);
    const list=Array.isArray(payload)?payload:
      Array.isArray(wrapped?.data)?wrapped.data:
      Array.isArray(wrapped?.agents)?wrapped.agents:null;
    if(!list||list.length!==1)return 'unavailable';
    return inspectAutoUnfollowDocument(list[0],agentId);
  }catch{return 'unavailable';}
}
