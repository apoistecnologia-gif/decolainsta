/**
 * Check template identity using provider metadata only; do not read arguments,
 * Instagram cookies, result bodies, or launch any agent. Script identity alone
 * still does NOT prove the collector targets a particular reference username.
 */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type FollowerCollectorIdentity =
  | 'verified-template' | 'different-template' | 'not-found'
  | 'invalid-key' | 'unavailable';

export async function verifyFollowerCollectorTemplate(
  apiKey: string, agentId: string, fetcher: Fetcher = fetch,
): Promise<FollowerCollectorIdentity> {
  if (!apiKey || !/^\d{10,25}$/.test(agentId)) return 'unavailable';
  const url = new URL('https://api.phantombuster.com/api/v2/agents/fetch');
  url.searchParams.set('id', agentId);
  url.searchParams.set('withArgument', 'false');
  url.searchParams.set('withCode', 'false');
  url.searchParams.set('withManifest', 'false');
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET', headers: {
        Accept: 'application/json', 'X-Phantombuster-Key': apiKey,
      },
      redirect: 'error', cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return 'invalid-key';
    if (response.status === 404) return 'not-found';
    if (!response.ok) return 'unavailable';
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 100_000) return 'unavailable';
    const body = await response.text();
    if (body.length > 100_000) return 'unavailable';
    const raw: unknown = JSON.parse(body) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unavailable';
    const outer = raw as Record<string, unknown>;
    const obj = outer.data && typeof outer.data === 'object' &&
      !Array.isArray(outer.data) ? outer.data as Record<string, unknown> : outer;
    if (String(obj.id ?? '') !== agentId) return 'not-found';
    // Script is the provider's template identity; name is user-editable.
    if (obj.script !== 'Instagram Follower Collector.js')
      return 'different-template';
    return 'verified-template';
  } catch {
    return 'unavailable';
  }
}
