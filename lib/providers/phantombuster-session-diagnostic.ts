import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type PhantomSessionDiagnostic = Readonly<{
  status: 'session-error-observed' | 'verification-required-observed' |
    'no-session-error-observed' | 'no-output' | 'invalid-key' |
    'rate-limited' | 'unavailable' | 'invalid-agent';
  evidence: 'previous_agent_output_only';
  instagramSessionVerifiedNow: false;
  passwordChangeImpactConfirmed: false;
  providerActionsExecuted: 0;
}>;

const validAgent = (id: unknown): id is string =>
  typeof id === 'string' && /^\d{10,25}$/.test(id);
const rec = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

/**
 * Only inspect output/log/message/error fields. Result objects, arguments,
 * cookies, profile lists and authentication credentials must never be copied
 * into a response or a log. A successful previous launch is NOT a test of
 * the CURRENT Instagram session (particularly after password changes).
 */
export function classifyPreviousPhantomOutput(payload: unknown):
  PhantomSessionDiagnostic['status'] {
  const messages: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (messages.join('').length >= 24_000 || depth > 4) return;
    if (typeof value === 'string') {
      messages.push(value.slice(0, 24_000));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 40)) visit(entry, depth + 1);
      return;
    }
    const obj = rec(value);
    if (!obj) return;
    for (const field of ['output','log','message','error','runtimeEvents','events','data']) {
      if (Object.prototype.hasOwnProperty.call(obj,field))
        visit(obj[field], depth + 1);
    }
  };
  visit(payload,0);
  const text = messages.join('\n').slice(0,24_000);
  if (!text.trim()) return 'no-output';
  if (/(?:expired|invalid|missing)\s+session\s+cookie|session\s+cookie\s+(?:has\s+)?(?:expired|invalid)|disconnected\s+by\s+instagram|(?:exit\s+code|exitcode)\s*[:=]?\s*87|no valid credentials found|session\s+is\s+expired/i.test(text))
    return 'session-error-observed';
  if (/(?:checkpoint|required\s+verification|verify\s+your\s+identity|two.factor\s+authentication|2fa\s+required|challenge\s+required|suspicious\s+login)/i.test(text))
    return 'verification-required-observed';
  return 'no-session-error-observed';
}

async function readBounded(response: Response, max = 64_000): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length') || 0) > max)
    return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', n = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { await reader.cancel(); return null; }
      buffer += decoder.decode(value, { stream: true });
    }
    return JSON.parse(buffer + decoder.decode()) as unknown;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/**
 * Read-only diagnostic of existing PhantomBuster output, never launch or
 * check Instagram directly. Returns exclusively allowlisted status codes.
 */
export async function inspectPreviousPhantomSessionErrors(
  apiKey: string, agentId: string, fetcher: Fetcher = fetch,
): Promise<PhantomSessionDiagnostic> {
  const answer = (status: PhantomSessionDiagnostic['status']): PhantomSessionDiagnostic => ({
    status, evidence:'previous_agent_output_only', instagramSessionVerifiedNow:false,
    passwordChangeImpactConfirmed:false, providerActionsExecuted:0,
  });
  if (!apiKey || apiKey.length > 512 || !validAgent(agentId))
    return answer('invalid-agent');
  try {
    const url = new URL('https://api.phantombuster.com/api/v2/agents/fetch-output');
    url.searchParams.set('id',agentId);
    const res = await fetcher(url.toString(), {
      method: 'GET', headers: phantomBusterRequestHeaders(apiKey),
      credentials:'omit', redirect:'error', cache:'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return answer('invalid-key');
    if (res.status === 429) return answer('rate-limited');
    if (res.status === 404) return answer('no-output');
    if (!res.ok) return answer('unavailable');
    const body = await readBounded(res);
    if (body === null) return answer('unavailable');
    return answer(classifyPreviousPhantomOutput(body));
  } catch { return answer('unavailable'); }
}
