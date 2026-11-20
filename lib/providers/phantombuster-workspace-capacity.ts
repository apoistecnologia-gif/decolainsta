/**
 * Strictly read-only provider capacity preflight.
 * Inventory records, configuration, session cookies, API keys and raw
 * organization objects are never returned. We do NOT infer available slots
 * by subtracting agent count from a guessed subscription limit.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type SlotMetric = { field: string; value: number };
export type CapacityStatus =
  'ok' | 'invalid-key' | 'rate-limited' | 'unavailable' | 'unexpected-response';
export type WorkspaceCapacity = {
  status: CapacityStatus;
  agents: number | null;
  resourcesRead: boolean;
  slotMetrics: SlotMetric[];
  exactFreeSlotsKnown: false;
  createsAgents: false;
  launchesAgents: false;
  instagramActionsExecuted: 0;
};

const resourceURL = 'https://api.phantombuster.com/api/v2/orgs/fetch-resources';
const agentsURL =
  'https://api.phantombuster.com/api/v2/agents/fetch-all?withArgument=false';

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown> : null;

async function limitedJson(response: Response, limit: number): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > limit || !response.body)
    return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function extractProviderSlotMetrics(input: unknown): SlotMetric[] {
  const result: SlotMetric[] = [];
  const seen = new Set<string>();
  function scan(value: unknown, path: string[], depth: number) {
    if (depth > 4 || result.length >= 16) return;
    const obj = record(value);
    if (!obj) return;
    for (const [key, item] of Object.entries(obj)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(key)) continue;
      const next = [...path, key];
      if (typeof item === 'number' && Number.isFinite(item) &&
          item >= 0 && item <= 1_000_000 &&
          next.some(part => /slot/i.test(part))) {
        const field = next.join('.');
        if (!seen.has(field)) { result.push({ field, value: item }); seen.add(field); }
      } else if (depth < 4 && item && typeof item === 'object' &&
                 !Array.isArray(item)) scan(item, next, depth + 1);
      if (result.length >= 16) break;
    }
  }
  scan(input, [], 0);
  return result;
}

export async function inspectWorkspaceCapacity(
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<WorkspaceCapacity> {
  const base = {
    agents: null, resourcesRead: false,
    slotMetrics: [], exactFreeSlotsKnown: false,
    createsAgents: false, launchesAgents: false,
    instagramActionsExecuted: 0,
  } as const;
  if (!apiKey || apiKey.length > 512) return { ...base, status: 'unavailable' };
  const options: RequestInit = {
    method: 'GET', headers: phantomBusterRequestHeaders(apiKey),
    credentials: 'omit', redirect: 'error', cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  };
  try {
    const r = await fetcher(resourceURL, options);
    if (r.status === 401 || r.status === 403)
      return { ...base, status: 'invalid-key' };
    if (r.status === 429)
      return { ...base, status: 'rate-limited' };
    if (!r.ok)
      return { ...base, status: 'unavailable' };
    const resourcePayload = await limitedJson(r, 300_000);
    if (!record(resourcePayload))
      return { ...base, status: 'unexpected-response' };

    const inventoryResponse = await fetcher(agentsURL, options);
    if (inventoryResponse.status === 401 || inventoryResponse.status === 403)
      return { ...base, status: 'invalid-key' };
    if (inventoryResponse.status === 429)
      return { ...base, status: 'rate-limited' };
    if (!inventoryResponse.ok)
      return { ...base, status: 'unavailable' };
    const inventory = await limitedJson(inventoryResponse, 1_000_000);
    const wrapper = record(inventory);
    const agents = Array.isArray(inventory) ? inventory :
      Array.isArray(wrapper?.data) ? wrapper.data :
      Array.isArray(wrapper?.agents) ? wrapper.agents : null;
    if (!agents) return { ...base, status: 'unexpected-response' };
    return {
      ...base, status: 'ok', agents: agents.length, resourcesRead: true,
      slotMetrics: extractProviderSlotMetrics(resourcePayload),
    };
  } catch {
    return { ...base, status: 'unavailable' };
  }
}
