import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { configuredFollowerCollectorReference } from './phantombuster-collector-discovery';
import { inspectDynamicCollectorTemplate } from './phantombuster-dynamic-reference';

type Fetcher = (url:string,init?:RequestInit)=>Promise<Response>;
type RecordValue=Record<string,unknown>;
const obj=(v:unknown):RecordValue|null =>
  v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:null;
const agentId=(v:unknown):v is string =>
  typeof v==='string'&&/^\d{10,25}$/.test(v);
const MAX_AGENTS=200;
const MAX_RESPONSE=1_500_000;

async function boundedJson(response:Response):Promise<unknown>{
  if(!response.body||Number(response.headers.get('content-length')||0)>MAX_RESPONSE)
    return null;
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let size=0,text='';
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>MAX_RESPONSE){await reader.cancel();return null;}
      text+=decoder.decode(chunk.value,{stream:true});
    }
    return JSON.parse(text+decoder.decode()) as unknown;
  }catch{return null;}
  finally{reader.releaseLock();}
}

export type PilotCollectorResolution = Readonly<{
  status:'ready'|'not-configured'|'invalid-key'|'rate-limited'|
    'workspace-mismatch'|'ambiguous-match'|'invalid-inventory'|
    'collector-not-found'|'missing-cookie'|'mismatch'|'unavailable';
  agentId:string|null;
}>;

export function pickPilotCollectorFromInventory(
  payload:unknown, templateReference:string,displayName:string,
):{status:'matched'|'not-found'|'ambiguous'|'invalid';id:string|null}{
  const root=obj(payload);
  const agents=Array.isArray(payload)?payload:
    Array.isArray(root?.data)?root.data:
    Array.isArray(root?.agents)?root.agents:null;
  if(!agents||agents.length>MAX_AGENTS)return {status:'invalid',id:null};
  const rows: {id:string; named:boolean; reference:boolean}[]=[];
  for(const item of agents){
    const agent=obj(item);
    if(!agent)continue;
    const id=String(agent.id??agent._id??'');
    if(!agentId(id))continue;
    const named=agent.name===displayName;
    // Never assign a follower collector by name if the API explicitly
    // shows it uses a different script (e.g. a Follow agent).
    const scriptCompatible=agent.script===undefined||
      agent.script==='Instagram Follower Collector.js';
    if(!scriptCompatible)continue;
    const source=agent.argument===undefined||agent.argument===null
      ?null:configuredFollowerCollectorReference(agent.argument);
    const reference=source===templateReference;
    if((named&&(source===null||reference))||
      (agent.script==='Instagram Follower Collector.js'&&reference))
      rows.push({id,named,reference});
  }
  const exactName=rows.filter(x=>x.named);
  const choices=exactName.length?exactName:rows.filter(x=>x.reference);
  if(!choices.length)return {status:'not-found',id:null};
  const distinct=[...new Set(choices.map(x=>x.id))];
  return distinct.length===1?
    {status:'matched',id:distinct[0]}:
    {status:'ambiguous',id:null};
}

/**
 * Auto-discovers an EXISTING collector from this API key's workspace.
 * A number copied from a prior screen is never accepted without proving
 * it exists in the key's workspace. Exact agent name is preferred; an
 * unambiguous Follower Collector with the existing reference is fallback.
 * Nothing is created or launched here.
 */
export async function resolvePilotCollectorInWorkspace(
  apiKey:string,templateReference:string,
  displayName='Untitled Instagram Follower Collector (2)',
  fetcher:Fetcher=fetch,
):Promise<PilotCollectorResolution>{
  const answer=(status:PilotCollectorResolution['status'],id:string|null=null):
    PilotCollectorResolution=>({status,agentId:id});
  if(!apiKey||apiKey.length>512)return answer('not-configured');
  if(!/^[a-z0-9._]{1,30}$/.test(templateReference))
    return answer('not-configured');
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
    url.searchParams.set('withArgument','true');
    const inventory=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      credentials:'omit',redirect:'error',cache:'no-store',
      signal:AbortSignal.timeout(8000),
    });
    if(inventory.status===401||inventory.status===403)return answer('invalid-key');
    if(inventory.status===429)return answer('rate-limited');
    if(!inventory.ok)return answer('unavailable');
    const data=await boundedJson(inventory);
    const choice=pickPilotCollectorFromInventory(data,templateReference,displayName);
    if(choice.status==='invalid')return answer('invalid-inventory');
    if(choice.status==='not-found')return answer('workspace-mismatch');
    if(choice.status==='ambiguous')return answer('ambiguous-match');
    const id=choice.id!;
    const confirmed=await inspectDynamicCollectorTemplate(
      apiKey,id,fetcher,templateReference);
    if(confirmed==='ready')return answer('ready',id);
    if(confirmed==='invalid-key')return answer('invalid-key');
    if(confirmed==='rate-limited')return answer('rate-limited');
    if(confirmed==='not-found')return answer('collector-not-found');
    if(confirmed==='missing-cookie')return answer('missing-cookie');
    if(confirmed==='mismatch'||confirmed==='invalid-response')return answer('mismatch');
    return answer('unavailable');
  }catch{return answer('unavailable');}
}
