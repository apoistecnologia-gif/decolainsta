import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { configuredFollowerCollectorReference } from './phantombuster-collector-discovery';
import { collectorRunCompletedAt } from './phantombuster-audience';

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
/**
 * The pilot uses the exact Follower Collector chosen from its existing
 * PhantomBuster console, not a best-effort search by the old template URL.
 * Inspect the persisted agent configuration before enabling any execution.
 * The provider API key must be authorized to read this specific agent.
 */
export type PinnedDynamicCollectorStatus =
  | 'ready' | 'not-configured' | 'invalid-agent-id' |
    'missing-cookie' | 'mismatch' | 'unavailable' |
    'invalid-key' | 'not-found' | 'rate-limited' | 'invalid-response';
export async function resolvePinnedDynamicCollector(
  apiKey:string, configuredId:string|undefined, fetcher:Fetcher=fetch,
):Promise<{status:PinnedDynamicCollectorStatus;agentId:string|null}>{
  if(!configuredId)return {status:'not-configured',agentId:null};
  if(!safeId(configuredId))return {status:'invalid-agent-id',agentId:null};
  const status=await inspectDynamicCollectorTemplate(apiKey,configuredId,fetcher);
  return status==='ready' ? {status:'ready',agentId:configuredId} :
    {status,agentId:null};
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
/**
 * Verify a complete agent record from EITHER authenticated /agents/fetch-all
 * or /agents/fetch. No request may launch an agent or expose cookie contents.
 * An incomplete inventory record never counts as a valid connection.
 */
export function validateDynamicCollectorTemplateRecord(
  value:unknown,agentId:string,expectedReference?:string,
):'ready'|'missing-cookie'|'mismatch'|'invalid-response'{
  const agent=rec(value);
  if(!agent)return 'invalid-response';
  if(String(agent.id??agent._id??'')!==agentId||
    (agent.id!==undefined&&agent._id!==undefined&&
      String(agent.id)!==String(agent._id))||
    agent.script!=='Instagram Follower Collector.js')return 'mismatch';
  let argument:unknown=agent.argument;
  if(typeof argument==='string'){
    try{argument=JSON.parse(argument) as unknown;}catch{return 'mismatch';}
  }
  const saved=rec(argument);
  const source=saved&&configuredFollowerCollectorReference(saved);
  if(!saved||typeof saved.spreadsheetUrl!=='string'||!source||
     (expectedReference!==undefined&&source!==expectedReference))
    return 'mismatch';
  return typeof saved.sessionCookie==='string'&&saved.sessionCookie.length>=12
    ?'ready':'missing-cookie';
}

/** Read one trusted existing agent and ensure it is a *Follower Collector*
 * configured with a single direct Instagram source and the saved session.
 * The username is just a template source, NOT a target that will be processed.
 */
export async function inspectDynamicCollectorTemplate(
  apiKey:string,agentId:string,fetcher:Fetcher=fetch,
  expectedReference?:string,
):Promise<'ready'|'missing-cookie'|'mismatch'|'unavailable'|
  'invalid-key'|'not-found'|'rate-limited'|'invalid-response'>{
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
    if(response.status===401||response.status===403)return 'invalid-key';
    if(response.status===404)return 'not-found';
    if(response.status===429)return 'rate-limited';
    if(!response.ok)return 'unavailable';
    const raw=rec(await boundedJson(response));
    const agent=rec(raw?.data)??raw;
    // Never return, log or write the value of the session cookie.
    return validateDynamicCollectorTemplateRecord(
      agent,agentId,expectedReference);
  }catch{return 'unavailable';}
}


/** A particular container's immutable identity and caller-issued claim.
 * Does not use the current agent configuration or its latest result file.
 */
export type DynamicRunProofStatus='verified-finished'|'finished-unverified'|'running'|'unavailable';
export type DynamicRunProofReason=
  | 'verified'|'still-running'|'invalid-input'|'container-unavailable'
  | 'wrong-container'|'wrong-agent'|'agent-history-unavailable'
  | 'agent-history-missing'|'unknown-status'|'failed-run'
  | 'missing-completion-time'|'missing-claim'|'wrong-claim'
  | 'wrong-reference';
export type DynamicRunProofDetail=Readonly<{
  status:DynamicRunProofStatus;
  reason:DynamicRunProofReason;
}>;
/** All reasons are fixed, privacy-safe codes: no cookies, arguments, names,
 * credentials, provider bodies or identifiers are returned to the browser.
 */
export async function inspectDynamicRunProofDetailed(
  apiKey:string,agentId:string,containerId:string,reference:string,
  claimId:string,fetcher:Fetcher=fetch,
):Promise<DynamicRunProofDetail>{
  const answer=(status:DynamicRunProofStatus,reason:DynamicRunProofReason)=>
    ({status,reason});
  if(!apiKey||!safeId(agentId)||!safeId(containerId)||
    !safeUser(reference)||!safeClaim(claimId))
    return answer('unavailable','invalid-input');
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch');
    url.searchParams.set('id',containerId);
    const init:RequestInit={
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(8000),
    };
    const res=await fetcher(url.toString(),init);
    if(!res.ok)return answer('unavailable','container-unavailable');
    const outer=rec(await boundedJson(res));
    if(!outer||outer.status==='error')
      return answer('unavailable','container-unavailable');
    const data=rec(outer.data)??outer;
    if(String(data.id??'')!==containerId)
      return answer('unavailable','wrong-container');
    if(data.agentId!==undefined&&data.agentId!==null){
      if(String(data.agentId)!==agentId)
        return answer('unavailable','wrong-agent');
    }else{
      const historyUrl=new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
      historyUrl.searchParams.set('agentId',agentId);
      historyUrl.searchParams.set('mode','all');
      historyUrl.searchParams.set('limit','100');
      const history=await fetcher(historyUrl.toString(),{
        ...init,signal:AbortSignal.timeout(8000),
      });
      if(!history.ok)return answer('unavailable','agent-history-unavailable');
      const listing=rec(await boundedJson(history,100000));
      if(!listing||listing.status==='error')
        return answer('unavailable','agent-history-unavailable');
      const body=rec(listing.data)??listing;
      const items=body.containers;
      if(!Array.isArray(items))return answer('unavailable','agent-history-unavailable');
      if(!items.some(v=>String(rec(v)?.id??'')===containerId))
        return answer('unavailable','agent-history-missing');
    }
    const status=String(data.status??'').toLowerCase();
    if(['running','starting','pending','queued','launching','scheduled'].includes(status))
      return answer('running','still-running');
    const finalized=['finalized','completed','finished','success'].includes(status);
    const ended=['failed','error','aborted','timeout','stopped','cancelled','canceled'].includes(status);
    if(!finalized&&!ended)return answer('unavailable','unknown-status');
    if(!finalized||(data.exitCode!==undefined&&data.exitCode!==null&&
      Number(data.exitCode)!==0))
      return answer('finished-unverified','failed-run');
    if(!collectorRunCompletedAt(data.endedAt))
      return answer('finished-unverified','missing-completion-time');
    const metadata=rec(data.userCustomMetadata);
    if(data.userCustomMetadata!==undefined&&data.userCustomMetadata!==null){
      if(!metadata||!Object.prototype.hasOwnProperty.call(metadata,'decolainstaClaimId'))
        return answer('finished-unverified','missing-claim');
      if(metadata.decolainstaClaimId!==claimId)
        return answer('finished-unverified','wrong-claim');
    }
    if(data.argument!==undefined&&data.argument!==null&&
       configuredFollowerCollectorReference(data.argument)!==reference)
      return answer('finished-unverified','wrong-reference');
    return answer('verified-finished','verified');
  }catch{return answer('unavailable','container-unavailable');}
}
/** Compatibility wrapper for existing safe proof-based integrations. */
export async function inspectDynamicRunProof(
  apiKey:string,agentId:string,containerId:string,reference:string,
  claimId:string,fetcher:Fetcher=fetch,
):Promise<DynamicRunProofStatus>{
  const detail=await inspectDynamicRunProofDetailed(
    apiKey,agentId,containerId,reference,claimId,fetcher);
  return detail.status;
}
export type DynamicContainerResults=Readonly<{
  status:'found'|'empty'|'unsupported'|'unavailable';
  usernames:string[];
}>;
/** Reads ONLY an immutable, already-verified container. No agent-wide
 * result files: those may contain earlier references and other customers.
 * fetch-result-object is primary; /containers/fetch?withResultObject=true
 * is a documented secondary read for the SAME container ID.
 */
export async function readDynamicContainerResults(
  apiKey:string,containerId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<DynamicContainerResults>{
  const answer=(status:DynamicContainerResults['status'],usernames:string[]=[])=>({status,usernames});
  if(!apiKey||!safeId(containerId)||!safeUser(reference))
    return answer('unsupported');

  const parseRows=(raw:unknown):DynamicContainerResults=>{
    let data:unknown=raw;
    if(typeof data==='string'){
      try{data=JSON.parse(data) as unknown;}catch{return answer('unsupported');}
    }
    if(data===null||data===undefined||data==='')return answer('empty');
    const asObject=rec(data);
    // Only explicit collections, never arbitrary nested records or URLs.
    const items=Array.isArray(data)?data:
      asObject&&Array.isArray(asObject.results)?asObject.results:
      asObject&&Array.isArray(asObject.data)?asObject.data:
      asObject&&Array.isArray(asObject.followers)?asObject.followers:
      asObject&&Array.isArray(asObject.profiles)?asObject.profiles:
      asObject&&Array.isArray(asObject.items)?asObject.items:
      asObject&&Array.isArray(asObject.rows)?asObject.rows:null;
    if(!items)return answer('unsupported');
    if(items.length===0)return answer('empty');
    const names=new Set<string>();
    for(const item of items.slice(0,1000)){
      const row=rec(item);
      if(!row)continue;
      let username=row.username??row.profileName;
      if(typeof username!=='string'&&typeof row.profileUrl==='string'){
        try{
          const profile=new URL(row.profileUrl);
          if(profile.protocol==='https:'&&
             ['instagram.com','www.instagram.com'].includes(profile.hostname))
            username=profile.pathname.replace(/^\\/|\\/$/g,'');
        }catch{continue;}
      }
      if(typeof username!=='string')continue;
      const name=username.trim().replace(/^@/,'').toLowerCase();
      if(safeUser(name)&&name!==reference)names.add(name);
      if(names.size>=250)break;
    }
    // A nonempty object with no valid usernames may be a FILE REFERENCE,
    // not an empty follower list. Do not finish the reference silently.
    return names.size?answer('found',[...names].sort()):answer('unsupported');
  };
  const init:RequestInit={
    method:'GET',headers:phantomBusterRequestHeaders(apiKey),
    cache:'no-store',credentials:'omit',redirect:'error',
    signal:AbortSignal.timeout(8000),
  };
  let prior:DynamicContainerResults=answer('unavailable');
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch-result-object');
    url.searchParams.set('id',containerId);
    const response=await fetcher(url.toString(),init);
    if(response.ok){
      const wrapper=rec(await boundedJson(response,4_000_000));
      const source=rec(wrapper?.data)??wrapper;
      if(source&&Object.prototype.hasOwnProperty.call(source,'resultObject')){
        prior=parseRows(source.resultObject);
        if(prior.status==='found'||prior.status==='empty')return prior;
      }else prior=answer('unsupported');
    }
    if([401,403,429].includes(response.status))return prior;
  }catch{/* A secondary read is safe only for the original container. */}

  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch');
    url.searchParams.set('id',containerId);
    url.searchParams.set('withResultObject','true');
    const response=await fetcher(url.toString(),{
      ...init,signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return prior;
    const wrapper=rec(await boundedJson(response,4_000_000));
    const source=rec(wrapper?.data)??wrapper;
    if(!source||String(source.id??'')!==containerId||
       !Object.prototype.hasOwnProperty.call(source,'resultObject'))
      return prior;
    return parseRows(source.resultObject);
  }catch{return prior;}
}
