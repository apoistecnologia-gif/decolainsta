/**
 * Read only usernames from a PREVIOUSLY COMPLETED PhantomBuster run.
 * Does not launch a Phantom, call Instagram or persist followers/credentials.
 * The operator associates a Collector agent with a saved reference; PhantomBuster
 * output by itself does NOT verify follower-of-reference provenance.
 */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type AudiencePreview = {
  status: 'found' | 'no-run' | 'no-results' | 'unsupported-result' |
    'invalid-key' | 'rate-limited' | 'unavailable';
  usernames: string[];
  referenceVerified: false;
  source: 'operator_assigned_collector_result';
  savedToDatabase: false;
  actionsEnabled: false;
  resultLocation?: 'completed_run' | 'latest_agent_file';
};

function result(
  status: AudiencePreview['status'], usernames: string[] = [],
  resultLocation?: AudiencePreview['resultLocation'],
): AudiencePreview {
  return { status, usernames, referenceVerified: false,
    source: 'operator_assigned_collector_result', savedToDatabase: false, actionsEnabled: false,
    ...(resultLocation ? { resultLocation } : {}) };
}

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function collection(v: unknown, name: 'containers' | 'results'): unknown[] | null {
  if (Array.isArray(v)) return v;
  const o = record(v);
  if (!o) return null;
  if (Array.isArray(o[name])) return o[name];
  if (Array.isArray(o.data)) return o.data;
  const data = record(o.data);
  return data && Array.isArray(data[name]) ? data[name] : null;
}
// Read large collector output without accepting unbounded provider response bodies.
async function boundedJson(r: Response, maxBytes = 4_000_000): Promise<unknown> {
  const size = Number(r.headers.get('content-length') ?? 0);
  if (Number.isFinite(size) && size > maxBytes) return null;
  if (!r.body) return null;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return null;
      }
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
function rows(payload: unknown): unknown[] | null {
  const o = record(payload);
  if (!o) return null;
  // A finalized run can legitimately contain no collected rows.
  // Missing resultObject in an unexpected 200 response remains an error.
  const nested = record(o.data);
  const source = Object.prototype.hasOwnProperty.call(o, 'resultObject') ? o : nested;
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'resultObject')) return null;
  let value: unknown = source.resultObject;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') {
    if (value.length > 4_000_000) return null;
    try { value = JSON.parse(value) as unknown; } catch { return null; }
  }
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return collection(value, 'results');
}
// Only the official S3 location derived from trusted agent metadata is permitted.
// The API key is NEVER sent to this location or included in its URL.
function resultFileUrl(metadata: unknown, expectedAgentId: string): string | null {
  const outer = record(metadata);
  const agent = record(outer?.data) ?? outer;
  if (!agent || String(agent.id ?? '') !== expectedAgentId) return null;
  const organization = agent.orgS3Folder;
  const folder = agent.s3Folder;
  const safeSegment = (s: unknown): s is string =>
    typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
  if (!safeSegment(organization) || !safeSegment(folder)) return null;
  return `https://phantombuster.s3.amazonaws.com/${organization}/${folder}/result.json`;
}

function fileRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  return collection(payload, 'results') ?? rows(payload);
}

function safeUsername(item: unknown): string | null {
  const row = record(item);
  if (!row) return null;
  const name = row.username ?? row.profileName;
  if (typeof name === 'string') {
    const trimmed = name.trim().replace(/^@/, '').toLowerCase();
    if (/^[a-z0-9._]{1,30}$/.test(trimmed)) return trimmed;
  }
  if (typeof row.profileUrl !== 'string' || row.profileUrl.length > 180) return null;
  try {
    const u = new URL(row.profileUrl);
    if (u.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(u.hostname.toLowerCase()))
      return null;
    const match = u.pathname.match(/^\/([a-z0-9._]{1,30})\/?$/i);
    return match ? match[1].toLowerCase() : null;
  } catch { return null; }
}

async function readCollectorResult(
  apiKey: string, agentId: string, excludedUsernames: string[],
  maxNames: number, maxRows: number, fetcher: Fetcher,
): Promise<AudiencePreview> {
  if (!apiKey.trim() || !/^\d{10,25}$/.test(agentId)) return result('unsupported-result');
  try {
    const opts: RequestInit = {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Phantombuster-Key': apiKey },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    };
    const listUrl = new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    listUrl.searchParams.set('agentId', agentId);
    listUrl.searchParams.set('mode', 'finalized');
    listUrl.searchParams.set('limit', '3');
    listUrl.searchParams.set('withRuntimeEvents', 'false');
    const listRes = await fetcher(listUrl.toString(), opts);
    if ([401, 403].includes(listRes.status)) return result('invalid-key');
    if (listRes.status === 429) return result('rate-limited');
    if (!listRes.ok) return result('unavailable');
    const containers = collection(await boundedJson(listRes), 'containers');
    if (!containers) return result('unsupported-result');
    if (!containers.length) return result('no-run');
    // Select newest by endedAt, ignoring malformed provider-supplied IDs.
    const valid = containers.map(record).filter((item): item is Record<string, unknown> =>
      !!item && /^\d{10,25}$/.test(String(item.id ?? '')));
    if (!valid.length) return result('unsupported-result');
    const newest = [...valid].sort((a, b) =>
      (Number(b.endedAt ?? 0) || 0) - (Number(a.endedAt ?? 0) || 0))[0];

    const resultUrl = new URL('https://api.phantombuster.com/api/v2/containers/fetch-result-object');
    resultUrl.searchParams.set('id', String(newest.id));
    const resultRes = await fetcher(resultUrl.toString(), opts);
    if ([401, 403].includes(resultRes.status)) return result('invalid-key');
    if (resultRes.status === 429) return result('rate-limited');
    if (!resultRes.ok) return result('unavailable');
    let sourceRows = rows(await boundedJson(resultRes));
    let location: AudiencePreview['resultLocation'] = 'completed_run';

    // Some collector runs have oversized or file-backed result objects.
    // The dashboard's result.json is the agent's latest result file, not
    // independently verified evidence about the operator's chosen reference.
    if (!sourceRows || !sourceRows.length) {
      const agentUrl = new URL('https://api.phantombuster.com/api/v2/agents/fetch');
      agentUrl.searchParams.set('id', agentId);
      agentUrl.searchParams.set('withArgument', 'false');
      const agentRes = await fetcher(agentUrl.toString(), opts);
      if ([401, 403].includes(agentRes.status)) return result('invalid-key');
      if (agentRes.status === 429) return result('rate-limited');
      if (agentRes.ok) {
        const fileUrl = resultFileUrl(await boundedJson(agentRes, 100_000), agentId);
        if (fileUrl) {
          const fileRes = await fetcher(fileUrl, {
            method: 'GET', headers: { Accept: 'application/json' },
            cache: 'no-store', redirect: 'error', credentials: 'omit',
            signal: AbortSignal.timeout(8000),
          });
          if (fileRes.ok) {
            const parsedFile = fileRows(await boundedJson(fileRes));
            if (parsedFile) {
              sourceRows = parsedFile;
              location = 'latest_agent_file';
            }
          }
        }
      }
    }
    if (!sourceRows) return result('unsupported-result');
    if (!sourceRows.length) return result('no-results');
    const excluded = new Set(excludedUsernames.map(x => x.toLowerCase()));
    const unique = new Set<string>();
    for (const item of sourceRows.slice(0, maxRows)) {
      const username = safeUsername(item);
      if (username && !excluded.has(username)) unique.add(username);
      if (unique.size >= maxNames) break;
    }
    return unique.size ? result('found', [...unique], location) : result('no-results');
  } catch { return result('unavailable'); }
}

/** Existing ten-name preview; never increases its exposure or writes. */
export async function previewCollectorResult(
  apiKey: string, agentId: string, excludedUsernames: string[], fetcher: Fetcher = fetch,
): Promise<AudiencePreview> {
  return readCollectorResult(apiKey, agentId, excludedUsernames, 10, 150, fetcher);
}

/** Optional explicit full read: at most 500 allowlisted usernames, no raw profile data. */
export async function readCollectorAudience(
  apiKey: string, agentId: string, excludedUsernames: string[], fetcher: Fetcher = fetch,
): Promise<AudiencePreview> {
  return readCollectorResult(apiKey, agentId, excludedUsernames, 500, 5000, fetcher);
}
