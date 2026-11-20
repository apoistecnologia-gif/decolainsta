/**
 * Read-only validation of a saved "Instagram Followers Auto Follow" Phantom.
 * Unlike "Instagram Auto Follow", this agent selects a follower from one
 * reference profile: it does NOT accept a specific follower recipient.
 *
 * This helper NEVER launches/updates/schedules or returns session cookies,
 * raw arguments, API keys, provider response text or Instagram usernames.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { parseSingleInstagramReference } from './phantombuster-collector-discovery';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type FollowersAgentCheck =
  'matched' | 'invalid-key' | 'rate-limited' | 'unavailable' |
  'wrong-agent-type' | 'wrong-frequency' | 'wrong-reference' |
  'ambiguous-input' | 'limit-not-one' | 'missing-configuration';

const getObject = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : null;

const urlFields = [
  'profileUrl', 'instagramProfileUrl', 'targetProfileUrl',
  'spreadsheetUrl', 'spreadsheetURL', 'inputUrl',
] as const;
const multiFields = ['listUrl', 'inputFileUrl', 'urls', 'profiles', 'profileUrls'];
const countFields = [
  'numberOfProfilesToFollow','numberOfProfiles','numberProfiles',
  'numberOfProfilesPerLaunch','numberOfProfilesToProcess','numberProfilesPerLaunch',
  'numberOfFollows','numberOfProfilesToFollowPerLaunch',
];

export function inspectFollowersAutoFollowDocument(
  raw: unknown, agentId: string, referenceUsername: string,
): FollowersAgentCheck {
  const envelope = getObject(raw);
  const agent = getObject(envelope?.data) ?? envelope;
  if (!agent || String(agent.id ?? agent._id ?? '') !== agentId)
    return 'missing-configuration';
  if (agent.script !== 'Instagram Followers Auto Follow.js')
    return 'wrong-agent-type';
  if (agent.launchType !== 'manually')
    return 'wrong-frequency';
  let arg: unknown = agent.argument;
  if (typeof arg === 'string') {
    if (arg.length > 120_000) return 'missing-configuration';
    try { arg = JSON.parse(arg) as unknown; }
    catch { return 'missing-configuration'; }
  }
  const args = getObject(arg);
  if (!args) return 'missing-configuration';
  if (multiFields.some(key => args[key] !== undefined &&
      args[key] !== null && args[key] !== ''))
    return 'ambiguous-input';
  const values = urlFields.filter(key =>
    args[key] !== undefined && args[key] !== null && args[key] !== '');
  // Do not infer a reference when a list/spreadsheet or several sources exist.
  if (values.length !== 1) return 'ambiguous-input';
  const source = args[values[0]];
  if (typeof source !== 'string' ||
      !source.trim().toLowerCase().startsWith('https://') ||
      parseSingleInstagramReference(source) !== referenceUsername)
    return 'wrong-reference';

  // Provider defaults to 20: a missing or unrecognized count is NOT safe.
  const present = countFields.filter(key => args[key] !== undefined);
  if (!present.length || !present.every(key => args[key] === 1))
    return 'limit-not-one';
  return 'matched';
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length') ?? 0) > 250_000)
    return null;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, data = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 250_000) { await reader.cancel(); return null; }
      data += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(data + decoder.decode()) as unknown;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function inspectFollowersAutoFollowAgent(
  apiKey: string, agentId: string, referenceUsername: string,
  fetcher: Fetcher = fetch,
): Promise<FollowersAgentCheck> {
  if (!apiKey || apiKey.length > 512 ||
      !/^\d{10,25}$/.test(agentId) ||
      parseSingleInstagramReference(referenceUsername) !== referenceUsername)
    return 'missing-configuration';
  const opts: RequestInit = {
    method: 'GET', headers: phantomBusterRequestHeaders(apiKey),
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  };
  const fetchOne = async (url: URL) => {
    const response = await fetcher(url.toString(), opts);
    if (response.status === 401 || response.status === 403)
      return { status: 'invalid-key' as const, body: null };
    if (response.status === 429)
      return { status: 'rate-limited' as const, body: null };
    if (!response.ok)
      return { status: 'unavailable' as const, body: null };
    return { status: 'ok' as const, body: await boundedJson(response) };
  };
  try {
    const url = new URL('https://api.phantombuster.com/api/v2/agents/fetch');
    url.searchParams.set('id', agentId);
    url.searchParams.set('withCode', 'false');
    url.searchParams.set('withManifest', 'false');
    const one = await fetchOne(url);
    if (one.status === 'invalid-key' || one.status === 'rate-limited')
      return one.status;
    if (one.status === 'ok' && one.body !== null) {
      const checked = inspectFollowersAutoFollowDocument(
        one.body, agentId, referenceUsername);
      if (checked !== 'missing-configuration') return checked;
    }
    // Some workspaces expose agent configurations via inventory, not /fetch.
    // Read the matching ID only; never return any raw entries to the caller.
    const inventory = new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
    inventory.searchParams.set('agentIds', agentId);
    inventory.searchParams.set('withArgument', 'true');
    const all = await fetchOne(inventory);
    if (all.status !== 'ok') return all.status;
    const wrapper = getObject(all.body);
    const array = Array.isArray(all.body) ? all.body :
      Array.isArray(wrapper?.data) ? wrapper.data :
      Array.isArray(wrapper?.agents) ? wrapper.agents : null;
    if (!array || array.length !== 1) return 'missing-configuration';
    return inspectFollowersAutoFollowDocument(array[0], agentId, referenceUsername);
  } catch {
    return 'unavailable';
  }
}
