import { discoverFollowerCollectors } from './phantombuster-collector-discovery';
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type ProgressStatus =
  | 'running' | 'finished' | 'failed' | 'pending' | 'unverified'
  | 'no-run' | 'no-matching-collector' | 'ambiguous-collector'
  | 'invalid-key' | 'rate-limited' | 'unavailable' | 'invalid-reference';

export type ReferenceCollectorProgress = Readonly<{
  status: ProgressStatus;
  reference: string | null;
  latestRunSeen: boolean;
  source: 'existing_collector_metadata';
  instagramSessionVerifiedByProvider: false;
  resultsAttributedToSavedReference: false;
  newFollowersOnOwnAccount: 0;
  followsExecutedByDiagnostic: 0;
}>;

const obj = (v: unknown): Record<string,unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,unknown> : null;
const asArray = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value;
  const r = obj(value);
  if (!r) return null;
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.containers)) return r.containers;
  const d = obj(r.data);
  return d && Array.isArray(d.containers) ? d.containers : null;
};
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')||0)>120_000)
    return null;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let raw='',count=0;
  try {
    for (;;) {
      const part=await reader.read();
      if (part.done) break;
      count+=part.value.byteLength;
      if(count>120_000) {await reader.cancel();return null;}
      raw+=decoder.decode(part.value,{stream:true});
    }
    return JSON.parse(raw+decoder.decode()) as unknown;
  } catch {return null;}
  finally {reader.releaseLock();}
}
function statusOf(container:Record<string,unknown>): ProgressStatus {
  const rawStatus=typeof container.status==='string' ? container.status.toLowerCase() : '';
  if (['running','in_progress','in-progress','started','executing'].includes(rawStatus))
    return 'running';
  if (['queued','pending','waiting','launching'].includes(rawStatus))
    return 'pending';
  if (['failed','error','aborted','cancelled','canceled'].includes(rawStatus))
    return 'failed';
  if (rawStatus === 'finalized' || rawStatus === 'finished' ||
      rawStatus === 'completed' || rawStatus === 'success') {
    return container.endedAt ? 'finished' : 'unverified';
  }
  // A timestamp by itself does not prove a successful scrape or login.
  return 'unverified';
}
export function classifyCollectorContainers(payload: unknown, agentId: string):
  Pick<ReferenceCollectorProgress, 'status'|'latestRunSeen'> {
  const candidates=asArray(payload);
  if (!candidates || !/^\d{10,25}$/.test(agentId))
    return {status:'unverified', latestRunSeen:false};
  const matched=candidates.map(obj).filter((c):c is Record<string,unknown> =>
    !!c && /^\d{10,25}$/.test(String(c.id??'')) &&
    (c.agentId === undefined || String(c.agentId) === agentId));
  // Never trust a list containing unrelated agents as the latest run.
  if (matched.length !== candidates.length)
    return {status:'unverified',latestRunSeen:false};
  if (!matched.length) return {status:'no-run',latestRunSeen:false};
  const timestamp=(c:Record<string,unknown>) => {
    for(const key of ['startedAt','createdAt','endedAt']) {
      const v=c[key],n=typeof v==='number'?v:Date.parse(String(v??''));
      if(Number.isFinite(n)) return n;
    }
    return 0;
  };
  const ordered=[...matched].sort((a,b)=>timestamp(b)-timestamp(a));
  return {status:statusOf(ordered[0]),latestRunSeen:true};
}

/**
 * Reads the provider's current collector configuration and last containers.
 * There is no launch, no agent update, no scraping, and NO claim that
 * collected usernames became followers of the account.
 */
export async function inspectExistingReferenceCollector(
  apiKey:string, reference:string, fetcher:Fetcher=fetch,
):Promise<ReferenceCollectorProgress> {
  const answer=(status:ProgressStatus,latestRunSeen=false):ReferenceCollectorProgress=>({
    status,reference:/^[a-z0-9._]{1,30}$/.test(reference)?reference:null,
    latestRunSeen,source:'existing_collector_metadata',
    instagramSessionVerifiedByProvider:false,
    resultsAttributedToSavedReference:false,
    newFollowersOnOwnAccount:0,followsExecutedByDiagnostic:0,
  });
  if(!/^[a-z0-9._]{1,30}$/.test(reference)) return answer('invalid-reference');
  const discovery=await discoverFollowerCollectors(apiKey,fetcher);
  if(discovery.status!=='ok')
    return answer(['invalid-key','rate-limited'].includes(discovery.status) ?
      discovery.status as ProgressStatus :'unavailable');
  const matches=discovery.collectors.filter(x=>x.referenceUsername===reference);
  if(!matches.length)return answer('no-matching-collector');
  if(matches.length!==1)return answer('ambiguous-collector');
  const id=matches[0].collectorAgentId;
  try {
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    url.searchParams.set('agentId',id);
    url.searchParams.set('mode','all');
    url.searchParams.set('limit','5');
    url.searchParams.set('withRuntimeEvents','false');
    const response=await fetcher(url.toString(),{
      method:'GET', headers:phantomBusterRequestHeaders(apiKey),
      redirect:'error', credentials:'omit', cache:'no-store',
      signal:AbortSignal.timeout(8000),
    });
    if(response.status===401||response.status===403)return answer('invalid-key');
    if(response.status===429)return answer('rate-limited');
    if(!response.ok)return answer('unavailable');
    const result=classifyCollectorContainers(await boundedJson(response),id);
    return answer(result.status,result.latestRunSeen);
  }catch{return answer('unavailable');}
}

/**
 * Read-only progress check for a PRECISE approved collector agent.
 * Unlike legacy reference discovery, this does not depend on the agent's
 * old template reference URL. It never launches, updates, or scrapes.
 */
export async function inspectPinnedCollectorProgress(
  apiKey:string, agentId:string, fetcher:Fetcher=fetch,
):Promise<ProgressStatus>{
  if(!apiKey||!/^[0-9]{10,25}$/.test(agentId))return 'unavailable';
  try{
    const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    url.searchParams.set('agentId',agentId);
    url.searchParams.set('mode','all');
    url.searchParams.set('limit','5');
    url.searchParams.set('withRuntimeEvents','false');
    const response=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      redirect:'error',credentials:'omit',cache:'no-store',
      signal:AbortSignal.timeout(8000),
    });
    if(response.status===401||response.status===403)return 'invalid-key';
    if(response.status===429)return 'rate-limited';
    if(!response.ok)return 'unavailable';
    return classifyCollectorContainers(await boundedJson(response),agentId).status;
  }catch{return 'unavailable';}
}
