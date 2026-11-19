import type { AudienceRefreshSource } from './reference-audience-refresh';

/**
 * Persist collector associations in the existing audit log during the preview
 * pilot. No migrations or per-client Vercel environment variables required.
 * New references are NOT implicitly bound to any PhantomBuster agent.
 */
export const AUDIENCE_SOURCE_BINDING_ACTION = 'reference_audience_binding_v1';
export const MAX_SOURCE_BINDING_LOGS = 5000;

export type AudienceSourceBindingEvent = {
  version: 1;
  referenceId: string;
  collectorAgentId: string | null;
  enabled: boolean;
  confirmation: 'operator_readonly_collector';
};

export type AudienceSourceBindingRow = {
  id: string;
  instagramAccountId: string;
  targetUsername: string | null;
  createdAt: Date;
  details: string | null;
};

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validAgent = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{10,25}$/.test(value);

export function makeAudienceSourceBinding(
  referenceId: string, collectorAgentId: string | null, enabled: boolean,
): AudienceSourceBindingEvent | null {
  if (!validId(referenceId) || typeof enabled !== 'boolean' ||
      (enabled && !validAgent(collectorAgentId)) ||
      (!enabled && collectorAgentId !== null)) return null;
  return {
    version: 1, referenceId, collectorAgentId, enabled,
    confirmation: 'operator_readonly_collector',
  };
}

export function parseAudienceSourceBinding(raw: string | null): AudienceSourceBindingEvent | null {
  if (!raw || raw.length > 500) return null;
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 5 ||
      row.version !== 1 || row.confirmation !== 'operator_readonly_collector')
    return null;
  return makeAudienceSourceBinding(
    row.referenceId as string, row.collectorAgentId as string | null, row.enabled as boolean,
  );
}

/** The latest event wins. Malformed latest records disable that binding (fail closed). */
export function resolveActiveAudienceSources(rows: AudienceSourceBindingRow[]): AudienceRefreshSource[] {
  const latest = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() ||
    b.id.localeCompare(a.id));
  const visited = new Set<string>();
  const active: AudienceRefreshSource[] = [];
  for (const row of latest) {
    const key = row.instagramAccountId + ':' + row.targetUsername;
    if (visited.has(key)) continue;
    visited.add(key);
    const binding = parseAudienceSourceBinding(row.details);
    if (!validId(row.instagramAccountId) || !binding ||
        binding.referenceId !== row.targetUsername ||
        !binding.enabled || !binding.collectorAgentId) continue;
    active.push({
      accountId: row.instagramAccountId,
      referenceId: binding.referenceId,
      collectorAgentId: binding.collectorAgentId,
    });
  }
  // A single collector cannot be automatically read for two distinct refs.
  // Conflicts are quarantined instead of assigning its data to the wrong tenant.
  const count = new Map<string, number>();
  for (const source of active)
    count.set(source.collectorAgentId, (count.get(source.collectorAgentId) ?? 0) + 1);
  return active.filter(source => count.get(source.collectorAgentId) === 1);
}
