/**
 * PhantomBuster: one preconfigured, approved test agent at a time.
 * A 200 launch response proves ONLY a launch request, NOT an Instagram action.
 * No follow-back inference or auto-retry of an ambiguous launch.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { parseSingleInstagramReference } from './phantombuster-collector-discovery';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Kind = 'follow' | 'unfollow';
export type SocialAgentCheck =
  'matched' | 'mismatch' | 'unavailable' | 'invalid-key' | 'rate-limited';

const object = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string,unknown> : null;

async function boundedJson(resp: Response, maxBytes: number): Promise<unknown> {
  if (!resp.body || Number(resp.headers.get('content-length') ?? 0) > maxBytes)
    return null;
  const reader=resp.body.getReader(), decoder=new TextDecoder();
  let bytes=0, data='';
  try {
    for (;;) {
      const { done, value }=await reader.read();
      if (done) break;
      bytes+=value.byteLength;
      if (bytes>maxBytes) { await reader.cancel(); return null; }
      data+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(data+decoder.decode()) as unknown;
  } catch { return null; } finally { reader.releaseLock(); }
}

/** Requires EXACTLY ONE saved target and manual launch mode. */
export function inspectSocialAgentDocument(
  input: unknown, id: string, target: string, kind: Kind,
): SocialAgentCheck {
  const outer=object(input);
  const agent=object(outer?.data) ?? outer;
  if (!agent || String(agent.id??agent._id??'')!==id) return 'mismatch';
  if (agent.script !== (kind === 'follow'
    ? 'Instagram Auto Follow.js' : 'Instagram Auto Unfollow.js'))
    return 'mismatch';
  if (agent.launchType !== 'manually') return 'mismatch';
  let argument: unknown=agent.argument;
  if (typeof argument==='string' && argument.length<=120_000) {
    try { argument=JSON.parse(argument) as unknown; } catch { return 'mismatch'; }
  }
  const args=object(argument);
  if (!args) return 'mismatch';
  // Never accept spreadsheets, URL arrays, references to other domains, or
  // a provider preset that can act on multiple unspecified profiles.
  if (['listUrl','inputFileUrl','urls','profiles','profileUrls','inputUrl']
      .some(key=>args[key]!==undefined && args[key]!==null && args[key]!=='')) return 'mismatch';
  const keys=['profileUrl','instagramProfileUrl','targetProfileUrl',
    'spreadsheetUrl','spreadsheetURL'];
  const targetValues=keys.filter(k=>args[k]!==undefined && args[k]!==null && args[k]!=='')
    .map(k=>parseSingleInstagramReference(args[k]));
  if (targetValues.length!==1 || targetValues[0]!==target) return 'mismatch';
  const limits=['numberOfProfiles','numberProfiles','numberOfProfilesToFollow',
    'numberOfProfilesToProcess','numberOfProfilesPerLaunch'];
  // Require an explicit single-profile limit rather than relying on defaults.
  if (!limits.some(k=>args[k]===1)) return 'mismatch';
  if (limits.some(k=>args[k]!==undefined && args[k]!==1)) return 'mismatch';
  // For unfollow, never override the provider's saved safe follow-back option.
  // Require a known explicit setting: pending until exact provider schema confirmed.
  if (kind==='unfollow') return 'mismatch';
  return 'matched';
}

export async function inspectSingleTargetSocialAgent(
  apiKey: string, id: string, target: string, kind: Kind,
  fetcher: Fetcher=fetch,
): Promise<SocialAgentCheck> {
  if (!apiKey || apiKey.length>512 || !/^\d{10,25}$/.test(id) ||
      parseSingleInstagramReference(target)!==target)
    return 'mismatch';
  try {
    const url=new URL('https://api.phantombuster.com/api/v2/agents/fetch');
    url.searchParams.set('id',id);
    url.searchParams.set('withCode','false');
    url.searchParams.set('withManifest','false');
    const r=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      redirect:'error',cache:'no-store',credentials:'omit',
      signal:AbortSignal.timeout(8000),
    });
    if (r.status===401||r.status===403) return 'invalid-key';
    if (r.status===429) return 'rate-limited';
    if (!r.ok) return 'unavailable';
    return inspectSocialAgentDocument(await boundedJson(r,200_000),id,target,kind);
  } catch { return 'unavailable'; }
}

export type SocialLaunchResult =
 | {status:'accepted';containerId:string}
 | {status:'invalid-key'|'rate-limited'|'rejected'|'uncertain'};

export async function launchSingleSocialAgent(
  apiKey:string,id:string,fetcher:Fetcher=fetch,
):Promise<SocialLaunchResult> {
  if (!apiKey || apiKey.length>512 || !/^\d{10,25}$/.test(id))
    return {status:'rejected'};
  try {
    const response=await fetcher(
      'https://api.phantombuster.com/api/v2/agents/launch',{
        method:'POST',cache:'no-store',redirect:'error',credentials:'omit',
        headers:{...phantomBusterRequestHeaders(apiKey),'Content-Type':'application/json'},
        signal:AbortSignal.timeout(9000),
        body:JSON.stringify({id}),
      });
    if (response.status===401||response.status===403)
      return {status:'invalid-key'};
    if (response.status===429) return {status:'rate-limited'};
    if (!response.ok) return {status:'uncertain'};
    const wrapper=object(await boundedJson(response,5000));
    const data=object(wrapper?.data)??wrapper;
    const container=data?.containerId??data?.id;
    if (typeof container!=='string' && typeof container!=='number')
      return {status:'uncertain'};
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(String(container)))
      return {status:'uncertain'};
    return {status:'accepted',containerId:String(container)};
  } catch {
    return {status:'uncertain'};
  }
}
