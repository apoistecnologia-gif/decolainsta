/**
 * Read existing PhantomBuster agent metadata to discover Follower Collectors
 * already configured for a single Instagram reference. Never emit raw
 * arguments, session cookies, private setup, emails or credentials.
 *
 * A match establishes ONLY provider configuration, not that the Instagram
 * follower relationship or completed run has been independently verified.
 */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type DiscoveredFollowerCollector = {
  collectorAgentId: string;
  referenceUsername: string;
};
export type CollectorDiscoveryResult = {
  status: 'ok' | 'invalid-key' | 'rate-limited' | 'unavailable' |
    'unsupported-response' | 'too-many-agents';
  collectors: DiscoveredFollowerCollector[];
  agentsExamined: number;
  targetProof: 'configured_agent_argument_not_meta_verified';
};

const MAX_AGENTS = 200;
const MAX_BYTES = 2_000_000;
// PhantomBuster also uses "spreadsheetUrl" for the ONE direct Instagram
// profile URL entered in "A URL". Accept it ONLY when the value is an exact
// Instagram profile URL; any Google Sheet, CSV, or external URL fails closed.
const KNOWN_TARGET_KEYS = [
  'instagramProfileUrl', 'profileUrl', 'instagramUrl',
  'targetProfileUrl', 'profileLink', 'targetUsername',
  'spreadsheetUrl', 'spreadsheetURL', 'inputUrl',
] as const;
const FORBIDDEN_MULTI_TARGET_KEYS = [
  'inputFileUrl', 'listUrl', 'urls', 'profiles', 'profileUrls',
] as const;

const obj = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

export function parseSingleInstagramReference(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 180) return null;
  const raw = value.trim();
  if (/^@?[a-zA-Z0-9._]{1,30}$/.test(raw))
    return raw.replace(/^@/, '').toLowerCase();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' ||
        !['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase()) ||
        url.port || url.username || url.password || url.search || url.hash)
      return null;
    const match = url.pathname.match(/^\/([a-z0-9._]{1,30})\/?$/i);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export function configuredFollowerCollectorReference(argument: unknown): string | null {
  let decoded: unknown = argument;
  if (typeof argument === 'string') {
    if (argument.length > 120_000) return null;
    try { decoded = JSON.parse(argument) as unknown; } catch { return null; }
  }
  const data = obj(decoded);
  if (!data) return null;
  if (FORBIDDEN_MULTI_TARGET_KEYS.some(key => data[key] !== undefined &&
      data[key] !== null && data[key] !== '')) return null;
  const candidates = KNOWN_TARGET_KEYS.filter(key =>
    data[key] !== undefined && data[key] !== null && data[key] !== '')
    .map(key => {
      // Input-source fields must be exact Instagram HTTPS profile links.
      // Do not mistake an arbitrary string or username for a data-source URL.
      if (['spreadsheetUrl', 'spreadsheetURL', 'inputUrl'].includes(key) &&
          (typeof data[key] !== 'string' ||
            !data[key].trim().toLowerCase().startsWith('https://')))
        return null;
      return parseSingleInstagramReference(data[key]);
    });
  if (!candidates.length || candidates.some(x => x === null)) return null;
  return candidates.every(value => value === candidates[0]) ? candidates[0] : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES ||
      !response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, raw = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); return null; }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function discoverFollowerCollectors(
  apiKey: string, fetcher: Fetcher = fetch,
): Promise<CollectorDiscoveryResult> {
  const result = (status: CollectorDiscoveryResult['status'],
    collectors: DiscoveredFollowerCollector[] = [],
    agentsExamined = 0): CollectorDiscoveryResult => ({
      status, collectors, agentsExamined,
      targetProof: 'configured_agent_argument_not_meta_verified',
    });
  if (!apiKey || apiKey.length > 512) return result('unavailable');
  try {
    // The provider documents withArgument=true on /agents/fetch-all. Most
    // discovery needs just this one read-only request. Missing arguments
    // fall back to per-agent /agents/fetch with bounded requests.
    const inventoryUrl = new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
    inventoryUrl.searchParams.set('withArgument', 'true');
    const options: RequestInit = {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Phantombuster-Key': apiKey },
      redirect: 'error', cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    };
    const response = await fetcher(inventoryUrl.toString(), options);
    if (response.status === 401 || response.status === 403) return result('invalid-key');
    if (response.status === 429) return result('rate-limited');
    if (!response.ok) return result('unavailable');
    const payload = await boundedJson(response);
    const wrapper = obj(payload);
    const agents = Array.isArray(payload) ? payload :
      Array.isArray(wrapper?.data) ? wrapper.data :
      Array.isArray(wrapper?.agents) ? wrapper.agents : null;
    if (!agents) return result('unsupported-response');
    if (agents.length > MAX_AGENTS) return result('too-many-agents', [], agents.length);

    const candidates = agents.flatMap(item => {
      const entry = obj(item);
      if (!entry || entry.script !== 'Instagram Follower Collector.js') return [];
      const id = String(entry.id ?? entry._id ?? '');
      return /^\d{10,25}$/.test(id)
        ? [{ id, argument: entry.argument }] : [];
    });
    // Fail closed rather than partially matching an inventory with more
    // than 20 details missing. Normal case uses a single provider request.
    if (candidates.filter(item => item.argument === undefined).length > 20)
      return result('too-many-agents', [], agents.length);
    const discovered: DiscoveredFollowerCollector[] = [];
    for (const candidate of candidates) {
      const id = candidate.id;
      if (candidate.argument !== undefined) {
        const username = configuredFollowerCollectorReference(candidate.argument);
        if (username)
          discovered.push({ collectorAgentId: id, referenceUsername: username });
        continue;
      }
      const detailUrl = new URL('https://api.phantombuster.com/api/v2/agents/fetch');
      detailUrl.searchParams.set('id', id);
      detailUrl.searchParams.set('withManifest', 'false');
      detailUrl.searchParams.set('withCode', 'false');
      const detail = await fetcher(detailUrl.toString(), options);
      if (detail.status === 401 || detail.status === 403) return result('invalid-key');
      if (detail.status === 429) return result('rate-limited');
      if (!detail.ok) return result('unavailable');
      const document = await boundedJson(detail);
      const outer = obj(document);
      const agent = obj(outer?.data) ?? outer;
      if (!agent || String(agent.id ?? agent._id ?? '') !== id ||
          agent.script !== 'Instagram Follower Collector.js')
        return result('unsupported-response');
      const username = configuredFollowerCollectorReference(agent.argument);
      if (username)
        discovered.push({ collectorAgentId: id, referenceUsername: username });
    }
    return result('ok', discovered, agents.length);
  } catch {
    return result('unavailable');
  }
}

/** Only one active agent may claim one saved reference, and vice versa. */
export function matchUniqueCollectorForReference(
  agents: DiscoveredFollowerCollector[], referenceUsername: string,
): string | null {
  const username = parseSingleInstagramReference(referenceUsername);
  if (!username) return null;
  const matches = agents.filter(agent => agent.referenceUsername === username);
  if (matches.length !== 1) return null;
  if (agents.filter(agent => agent.collectorAgentId === matches[0].collectorAgentId).length !== 1)
    return null;
  return matches[0].collectorAgentId;
}

/**
 * Re-check the agent's CURRENT configuration before a completed-run read.
 * This is NOT proof that the past run came from this target; no Meta attestation.
 */
export type CollectorInspectionStatus =
  | 'matched' | 'mismatch' | 'unavailable'
  | 'invalid-key' | 'rate-limited' | 'not-found';

/** Check a SINGLE already-bound collector; do not launch or expose arguments.
 * Returned codes are allowlisted, never raw provider error text or credentials.
 */
/** Verified exact-one-agent fallback using the provider's documented
 * /agents/fetch-all?agentIds=...&withArgument=true. Only used when /agents/fetch
 * returns an unavailable 5xx/invalid body or lacks the argument field.
 * No cookies or raw configuration leave this server-side function.
 */
async function inspectFromAgentInventory(
  apiKey: string, agentId: string, expected: string, fetcher: Fetcher,
): Promise<CollectorInspectionStatus> {
  const url = new URL('https://api.phantombuster.com/api/v2/agents/fetch-all');
  url.searchParams.set('agentIds', agentId);
  url.searchParams.set('withArgument', 'true');
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Phantombuster-Key': apiKey },
      cache: 'no-store', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return 'invalid-key';
    if (response.status === 429) return 'rate-limited';
    if (!response.ok) return 'unavailable';
    const payload = await boundedJson(response);
    const outer = obj(payload);
    const agents = Array.isArray(payload) ? payload :
      Array.isArray(outer?.data) ? outer.data :
      Array.isArray(outer?.agents) ? outer.agents : null;
    if (!agents || agents.length !== 1) return 'unavailable';
    const agent = obj(agents[0]);
    if (!agent || String(agent.id ?? agent._id ?? '') !== agentId ||
        agent.script !== 'Instagram Follower Collector.js') return 'mismatch';
    // An omitted argument is NOT a mismatch; refuse to infer a reference.
    if (agent.argument === undefined || agent.argument === null) return 'unavailable';
    return configuredFollowerCollectorReference(agent.argument) === expected
      ? 'matched' : 'mismatch';
  } catch {
    return 'unavailable';
  }
}

export async function inspectConfiguredFollowerCollector(
  apiKey: string, agentId: string, targetUsername: string,
  fetcher: Fetcher = fetch,
): Promise<CollectorInspectionStatus> {
  if (!apiKey || !/^\d{10,25}$/.test(agentId)) return 'unavailable';
  const expected = parseSingleInstagramReference(targetUsername);
  if (!expected) return 'mismatch';
  const url = new URL('https://api.phantombuster.com/api/v2/agents/fetch');
  url.searchParams.set('id', agentId);
  url.searchParams.set('withCode', 'false');
  url.searchParams.set('withManifest', 'false');
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Phantombuster-Key': apiKey },
      cache: 'no-store', redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return 'invalid-key';
    if (response.status === 404) return 'not-found';
    if (response.status === 429) return 'rate-limited';
    if (!response.ok) return response.status >= 500
      ? inspectFromAgentInventory(apiKey, agentId, expected, fetcher) : 'unavailable';
    const payload = await boundedJson(response);
    const outer = obj(payload);
    const agent = obj(outer?.data) ?? outer;
    if (!agent) return inspectFromAgentInventory(apiKey, agentId, expected, fetcher);
    if (String(agent.id ?? agent._id ?? '') !== agentId ||
        agent.script !== 'Instagram Follower Collector.js') return 'mismatch';
    if (agent.argument === undefined || agent.argument === null)
      return inspectFromAgentInventory(apiKey, agentId, expected, fetcher);
    return configuredFollowerCollectorReference(agent.argument) === expected
      ? 'matched' : 'mismatch';
  } catch {
    return 'unavailable';
  }
}

/** Compatibility adapter for read-only importer and existing tests. */
export async function verifyConfiguredFollowerCollector(
  apiKey: string, agentId: string, targetUsername: string,
  fetcher: Fetcher = fetch,
): Promise<'matched' | 'mismatch' | 'unavailable'> {
  const status = await inspectConfiguredFollowerCollector(
    apiKey, agentId, targetUsername, fetcher);
  return status === 'matched' || status === 'mismatch' ? status : 'unavailable';
}
