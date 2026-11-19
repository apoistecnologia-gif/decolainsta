/**
 * Read the result of ONE completed Instagram Profile Scraper run, without
 * launching any agent, scraping Instagram or storing a session/API credential.
 * Strictly allowlisted return fields; provider JSON may contain sensitive data.
 * https://hub.phantombuster.com/reference/get_containers-fetch-all
 * https://hub.phantombuster.com/reference/get_containers-fetch-result-object
 */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ProfileSnapshot = {
  username: string;
  followersCount: number | null;
  followingCount: number | null;
};

export type ProfileLookup = {
  status: 'found' | 'no-launch' | 'no-result' | 'profile-not-found'
    | 'invalid-key' | 'limited' | 'unavailable' | 'unexpected-response';
  profile?: ProfileSnapshot;
  source: 'phantombuster-profile-scraper';
  savedToDatabase: false;
  instagramSessionForActionsVerified: false;
  actionsEnabled: false;
};

function reply(status: ProfileLookup['status'], profile?: ProfileSnapshot): ProfileLookup {
  return {
    status,
    ...(profile ? { profile } : {}),
    source: 'phantombuster-profile-scraper',
    savedToDatabase: false,
    instagramSessionForActionsVerified: false,
    actionsEnabled: false,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function entries(value: unknown, field: 'containers' | 'results'): unknown[] | null {
  if (Array.isArray(value)) return value;
  const obj = asRecord(value);
  if (!obj) return null;
  if (Array.isArray(obj[field])) return obj[field] as unknown[];
  if (Array.isArray(obj.data)) return obj.data;
  const data = asRecord(obj.data);
  return data && Array.isArray(data[field]) ? data[field] as unknown[] : null;
}

function safeCount(value: unknown): number | null {
  if (typeof value === 'string' && !/^\d{1,10}$/.test(value)) return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 9999999999
    ? parsed : null;
}

function safeUsername(row: Record<string, unknown>): string | null {
  const name = row.profileName ?? row.username;
  if (typeof name === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(name.trim())) {
    return name.trim().toLowerCase();
  }
  const url = row.profileUrl;
  if (typeof url !== 'string' || url.length > 150) return null;
  try {
    const parsed = new URL(url);
    if (!['instagram.com', 'www.instagram.com'].includes(parsed.hostname.toLowerCase())
        || parsed.protocol !== 'https:') return null;
    const match = parsed.pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

async function safeRead(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > 120000) return null;
  const body = await response.text();
  if (body.length > 120000) return null;
  try { return JSON.parse(body) as unknown; } catch { return null; }
}

function asRows(payload: unknown): unknown[] | null {
  const rec = asRecord(payload);
  const raw = rec?.resultObject ?? asRecord(rec?.data)?.resultObject;
  if (raw === null || raw === undefined) return [];
  let result: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 120000) return null;
    try { result = JSON.parse(raw) as unknown; } catch { return null; }
  }
  if (Array.isArray(result)) return result;
  return entries(result, 'results');
}

export async function getLatestTestProfile(
  apiKey: string,
  agentId: string,
  expectedUsername: string,
  fetcher: Fetcher = fetch,
): Promise<ProfileLookup> {
  if (!apiKey.trim() || !/^\d{10,25}$/.test(agentId) ||
      !/^[a-zA-Z0-9._]{1,30}$/.test(expectedUsername)) {
    return reply('unexpected-response');
  }

  const options: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Phantombuster-Key': apiKey },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  };
  try {
    const containersUrl = new URL('https://api.phantombuster.com/api/v2/containers/fetch-all');
    containersUrl.searchParams.set('agentId', agentId);
    containersUrl.searchParams.set('mode', 'finalized');
    containersUrl.searchParams.set('limit', '3');
    containersUrl.searchParams.set('withRuntimeEvents', 'false');
    const containerResponse = await fetcher(containersUrl.toString(), options);
    if (containerResponse.status === 401 || containerResponse.status === 403) return reply('invalid-key');
    if (containerResponse.status === 429) return reply('limited');
    if (!containerResponse.ok) return reply('unavailable');
    const list = entries(await safeRead(containerResponse), 'containers');
    if (!list) return reply('unexpected-response');
    if (list.length === 0) return reply('no-launch');

    // Filter malformed IDs instead of allowing provider data to become a URL.
    const finished = list.map(asRecord).filter((item): item is Record<string, unknown> =>
      !!item && /^\d{10,25}$/.test(String(item.id ?? '')));
    if (!finished.length) return reply('unexpected-response');
    const newest = finished.sort((a, b) =>
      (Number(b.endedAt ?? 0) || 0) - (Number(a.endedAt ?? 0) || 0))[0];

    const resultUrl = new URL('https://api.phantombuster.com/api/v2/containers/fetch-result-object');
    resultUrl.searchParams.set('id', String(newest.id));
    const resultResponse = await fetcher(resultUrl.toString(), options);
    if (resultResponse.status === 401 || resultResponse.status === 403) return reply('invalid-key');
    if (resultResponse.status === 429) return reply('limited');
    if (!resultResponse.ok) return reply('unavailable');

    const rows = asRows(await safeRead(resultResponse));
    if (!rows) return reply('unexpected-response');
    if (!rows.length) return reply('no-result');
    const match = rows.slice(0, 25).map(asRecord).find(row =>
      row !== null && safeUsername(row) === expectedUsername.toLowerCase());
    if (!match) return reply('profile-not-found');
    return reply('found', {
      username: expectedUsername.toLowerCase(),
      followersCount: safeCount(match.followersCount),
      followingCount: safeCount(match.followingCount),
    });
  } catch {
    // Do not forward provider exceptions, response bodies, cookies or tokens.
    return reply('unavailable');
  }
}
