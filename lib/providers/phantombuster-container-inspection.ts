/**
 * Read-only inspection of one exact PhantomBuster container.
 * Never infer provenance from the editable current agent configuration,
 * latest result.json, or an agent's accumulated data.
 *
 * The public /containers/fetch reference does not guarantee that the response
 * contains the immutable per-launch arguments. Even when an "argument" field
 * exists on a container, treat it as diagnostic only until the provider's
 * semantics have been verified with a real consented test.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';
import { configuredFollowerCollectorReference } from './phantombuster-collector-discovery';
import { collectorRunCompletedAt } from './phantombuster-audience';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ContainerInspection = Readonly<{
  status:
    | 'candidate-input-match' | 'input-not-verifiable' | 'reference-mismatch'
    | 'identity-mismatch' | 'not-finalized' | 'invalid-request' | 'not-found'
    | 'invalid-key' | 'rate-limited' | 'unavailable' | 'unexpected-response';
  completedAt: string | null;
  source: 'specific_provider_container';
  // The provider docs do not attest the semantics of "argument" per run.
  immutableInputProven: false;
  releaseAuthorized: false;
  instagramActionsExecuted: 0;
}>;

const validAgent = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{10,25}$/.test(value);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

async function boundedJson(response: Response, limit = 64_000): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > limit || !response.body)
    return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0, buffer = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); return null; }
      buffer += decoder.decode(chunk.value, {stream:true});
    }
    return JSON.parse(buffer + decoder.decode()) as unknown;
  } catch {
    return null;
  } finally { reader.releaseLock(); }
}

/**
 * One GET, no retries, no writes, no external launch. Returns safe status codes
 * only; never returns cookies, API keys, raw arguments, results, or profile lists.
 */
export async function inspectPhantomBusterContainer(
  apiKey: string, agentId: string, containerId: string,
  expectedReference: string, fetcher: Fetcher = fetch,
): Promise<ContainerInspection> {
  const answer = (status: ContainerInspection['status'], completedAt: string | null = null):
    ContainerInspection => ({
      status, completedAt, source: 'specific_provider_container',
      immutableInputProven: false, releaseAuthorized: false,
      instagramActionsExecuted: 0,
    });
  if (!apiKey || apiKey.length > 512 || !validAgent(agentId) ||
      !validAgent(containerId) ||
      !/^[a-z0-9._]{1,30}$/.test(expectedReference))
    return answer('invalid-request');

  try {
    const url = new URL('https://api.phantombuster.com/api/v2/containers/fetch');
    url.searchParams.set('id', containerId);
    const response = await fetcher(url.toString(), {
      method: 'GET', headers: phantomBusterRequestHeaders(apiKey),
      credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) return answer('invalid-key');
    if (response.status === 404) return answer('not-found');
    if (response.status === 429) return answer('rate-limited');
    if (!response.ok) return answer('unavailable');

    const payload = record(await boundedJson(response));
    if (!payload) return answer('unexpected-response');
    const container = record(payload.data) ?? payload;
    if (String(container.id ?? '') !== containerId ||
        String(container.agentId ?? '') !== agentId)
      return answer('identity-mismatch');
    if (container.status !== undefined && container.status !== null &&
        !['finalized','finished','completed','success'].includes(String(container.status)))
      return answer('not-finalized');
    const completedAt = collectorRunCompletedAt(container.endedAt);
    if (!completedAt) return answer('not-finalized');

    // Only the specific container's own argument may be consulted.
    // No fallback to agents/fetch or latest result files.
    if (!Object.prototype.hasOwnProperty.call(container,'argument') ||
        container.argument === null)
      return answer('input-not-verifiable',completedAt);
    const source = configuredFollowerCollectorReference(container.argument);
    if (!source) return answer('input-not-verifiable',completedAt);
    return answer(source === expectedReference
      ? 'candidate-input-match' : 'reference-mismatch',completedAt);
  } catch {
    return answer('unavailable');
  }
}
