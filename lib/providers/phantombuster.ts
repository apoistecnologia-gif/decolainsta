/**
 * PhantomBuster workspace connectivity diagnostic — strictly read-only.
 *
 * Never send session cookies or login passwords to this module.
 * Do not add launching, updating, configuring, or scraping calls here.
 * Agent records can include sensitive setup details: return aggregate counts only.
 *
 * API reference: https://hub.phantombuster.com/reference/get_agents-fetch-all
 */
export type PhantomBusterStatus =
  | 'verified'
  | 'not-configured'
  | 'disabled'
  | 'invalid-key'
  | 'limited'
  | 'unavailable'
  | 'unexpected-response'
  | 'agent-not-found';

export type PhantomBusterResult = {
  status: PhantomBusterStatus;
  workspaceAgentCount?: number;
  pilotAgentFound?: boolean;
  /** Workspace access is NOT proof of an authenticated Instagram session. */
  instagramConnectionVerified: false;
  actionsEnabled: false;
};

type HttpFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const AGENTS_URL = 'https://api.phantombuster.com/api/v2/agents/fetch-all?withArgument=false';

export async function checkPhantomBusterWorkspace(
  apiKey: string,
  fetcher: HttpFetcher = fetch,
  agentId?: string,
): Promise<PhantomBusterResult> {
  if (!apiKey.trim()) {
    return { status: 'not-configured', instagramConnectionVerified: false, actionsEnabled: false };
  }
  // Only numeric, explicitly configured agent IDs are permitted.
  // Never interpolate user input into a provider URL.
  if (agentId && !/^[0-9]{10,25}$/.test(agentId)) {
    return { status: 'unexpected-response', instagramConnectionVerified: false, actionsEnabled: false };
  }
  try {
    const url = new URL(AGENTS_URL);
    if (agentId) url.searchParams.set('agentIds', agentId);
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Phantombuster-Key': apiKey,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401 || response.status === 403) {
      return { status: 'invalid-key', instagramConnectionVerified: false, actionsEnabled: false };
    }
    if (response.status === 429) {
      return { status: 'limited', instagramConnectionVerified: false, actionsEnabled: false };
    }
    if (!response.ok) {
      return { status: 'unavailable', instagramConnectionVerified: false, actionsEnabled: false };
    }
    if (Number(response.headers.get('content-length') ?? 0) > 2_000_000) {
      return { status: 'unexpected-response', instagramConnectionVerified: false, actionsEnabled: false };
    }

    // Discard each raw agent record, which may contain private configuration.
    const payload: unknown = await response.json();
    const agents = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload
        ? (payload as { data: unknown }).data
        : null;

    if (!Array.isArray(agents)) {
      return { status: 'unexpected-response', instagramConnectionVerified: false, actionsEnabled: false };
    }
    const agentFound = agentId
      ? agents.some((item: unknown) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          const record = item as Record<string, unknown>;
          return String(record.id ?? record._id ?? record.agentId ?? '') === agentId;
        })
      : undefined;

    return {
      status: agentId && !agentFound ? 'agent-not-found' : 'verified',
      workspaceAgentCount: agents.length,
      pilotAgentFound: agentFound,
      instagramConnectionVerified: false,
      actionsEnabled: false,
    };
  } catch {
    // Never forward provider response bodies, headers, or exception text.
    return { status: 'unavailable', instagramConnectionVerified: false, actionsEnabled: false };
  }
}
