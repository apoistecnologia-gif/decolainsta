/**
 * Read at most 10 usernames from a PREVIOUSLY COMPLETED PhantomBuster run.
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
};

function result(status: AudiencePreview['status'], usernames: string[] = []): AudiencePreview {
  return { status, usernames, referenceVerified: false,
    source: 'operator_assigned_collector_result', savedToDatabase: false, actionsEnabled: false };
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
async function boundedJson(r: Response): Promise<unknown> {
  if (Number(r.headers.get('content-length') ?? 0) > 150000) return null;
  const raw = await r.text();
  if (raw.length > 150000) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}
function rows(payload: unknown): unknown[] | null {
  const o = record(payload);
  if (!o) return null;
  let value: unknown = o.resultObject ?? record(o.data)?.resultObject;
  if (typeof value === 'string') {
    if (value.length > 150000) return null;
    try { value = JSON.parse(value) as unknown; } catch { return null; }
  }
  if (Array.isArray(value)) return value;
  return collection(value, 'results');
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

export async function previewCollectorResult(
  apiKey: string, agentId: string, excludedUsernames: string[], fetcher: Fetcher = fetch,
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
    listUrl.searchParams.set('limit', '1');
    listUrl.searchParams.set('withRuntimeEvents', 'false');
    const listRes = await fetcher(listUrl.toString(), opts);
    if ([401, 403].includes(listRes.status)) return result('invalid-key');
    if (listRes.status === 429) return result('rate-limited');
    if (!listRes.ok) return result('unavailable');
    const containers = collection(await boundedJson(listRes), 'containers');
    if (!containers) return result('unsupported-result');
    if (!containers.length) return result('no-run');
    const id = record(containers[0])?.id;
    if (!/^\d{10,25}$/.test(String(id ?? ''))) return result('unsupported-result');

    const resultUrl = new URL('https://api.phantombuster.com/api/v2/containers/fetch-result-object');
    resultUrl.searchParams.set('id', String(id));
    const resultRes = await fetcher(resultUrl.toString(), opts);
    if ([401, 403].includes(resultRes.status)) return result('invalid-key');
    if (resultRes.status === 429) return result('rate-limited');
    if (!resultRes.ok) return result('unavailable');
    const sourceRows = rows(await boundedJson(resultRes));
    if (!sourceRows) return result('unsupported-result');
    if (!sourceRows.length) return result('no-results');
    const excluded = new Set(excludedUsernames.map(x => x.toLowerCase()));
    const unique = new Set<string>();
    for (const item of sourceRows.slice(0, 150)) {
      const username = safeUsername(item);
      if (username && !excluded.has(username)) unique.add(username);
      if (unique.size >= 10) break;
    }
    return unique.size ? result('found', [...unique]) : result('no-results');
  } catch { return result('unavailable'); }
}
