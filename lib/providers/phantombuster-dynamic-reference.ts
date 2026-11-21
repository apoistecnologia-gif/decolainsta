import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { configuredFollowerCollectorReference } from './phantombuster-collector-discovery';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Rec=Record<string,unknown>;
const rec=(x:unknown):Rec|null=>x&&typeof x==='object'&&!Array.isArray(x)?x as Rec:null;
const safeId=(x:unknown):x is string=>typeof x==='string'&&/^\d{10,25}$/.test(x);
const safeUser=(x:unknown):x is string=>typeof x==='string'&&/^[a-z0-9._]{1,30}$/.test(x);
const safeClaim=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/.test(x);

/** Per-launch override, WITHOUT updating the original agent settings.
 * The persisted Instagram cookie stays at PhantomBuster and is never read
 * into the DECOLA INSTA database.
 */
export function dynamicReferenceLaunchPayload(agentId:unknown, reference:unknown, claimId:unknown){
  if(!safeId(agentId)||!safeUser(reference)||!safeClaim(claimId)) return null;
  return {
    id:agentId,
    bonusArgument:{spreadsheetUrl:'https://www.instagram.com/'+reference+'/'},
    saveArgument:false,
    manualLaunch:true,
    maxInstanceCount:1,
    userCustomMetadata:{decolainstaClaimId:claimId},
  } as const;
}
export type DynamicLaunchResult=Readonly<{
  status:'queued'|'invalid-request'|'unauthorized'|'rate-limited'|
    'rejected'|'unconfirmed'|'unavailable';
  containerId:string|null;
}>;
async function boundedJson(res:Response,max=24000):Promise<unknown>{
  if(!res.body||Number(res.headers.get('content-length')||0)>max)return null;
  const reader=res.body.getReader(),decoder=new TextDecoder();
  let n=0,s='';
  try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;
    if(n>max){await reader.cancel();return null;}
    s+=decoder.decode(x.value,{stream:true});}
    return JSON.parse(s+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
export async function launchExistingCollectorForReference(
  apiKey:string,agentId:string,reference:string,claimId:string,fetcher:Fetcher=fetch,
):Promise<DynamicLaunchResult>{
  const payload=dynamicReferenceLaunchPayload(agentId,reference,claimId);
  const answer=(status:DynamicLaunchResult['status'],containerId:string|null=null)=>
    ({status,containerId});
  if(!payload||!apiKey||apiKey.length>512)return answer('invalid-request');
  try{
    const res=await fetcher('https://api.phantombuster.com/api/v2/agents/launch',{
      method:'POST',
      headers:{...phantomBusterRequestHeaders(apiKey),'Content-Type':'application/json'},
      body:JSON.stringify(payload),cache:'no-store',credentials:'omit',
      redirect:'error',signal:AbortSignal.timeout(10000),
    });
    if(res.status===401||res.status===403)return answer('unauthorized');
    if(res.status===429)return answer('rate-limited');
    if(!res.ok) return answer(res.status>=500?'unconfirmed':'rejected');
    const json=rec(await boundedJson(res));
    const data=rec(json?.data)??json;
    const id=data?.containerId??data?.id;
    return safeId(typeof id==='number'?String(id):id)
      ?answer('queued',String(id)):answer('unconfirmed');
  }catch{return answer('unconfirmed');}
}
/** Read one trusted existing agent and ensure it is a *Follower Collector*
 * configured with a single direct Instagram source and the saved session.
 * The username is just a template source, NOT a target that will be processed.
 */
export async function inspectDynamicCollectorTemplate(
  apiKey:string,agentId:string,fetcher:Fetcher=fetch,
):Promise<'ready'|'missing-cookie'|'mismatch'|'unavailable'>{
  if(!apiKey||!safeId(agentId))return 'unavailable';
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch');
    url.searchParams.set('id',agentId);
    url.searchParams.set('withCode','false');
    url.searchParams.set('withManifest','false');
    const response=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return 'unavailable';
    const raw=rec(await boundedJson(response));
    const agent=rec(raw?.data)??raw;
    if(!agent||String(agent.id??'')!==agentId||
      agent.script!=='Instagram Follower Collector.js')return 'mismatch';
    let argument:unknown=agent.argument;
    if(typeof argument==='string'){
      try{argument=JSON.parse(argument) as unknown;}catch{return 'mismatch';}
    }
    const saved=rec(argument);
    if(!saved||typeof saved.spreadsheetUrl!=='string'||
       !configuredFollowerCollectorReference(saved))return 'mismatch';
    // Never return, log or write the value of the session cookie.
    return typeof saved.sessionCookie==='string'&&saved.sessionCookie.length>=12
      ?'ready':'missing-cookie';
  }catch{return 'unavailable';}
}
