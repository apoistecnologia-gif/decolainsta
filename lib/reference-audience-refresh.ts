/**
 * Configuration for read-only polling of completed, externally scheduled collector runs.
 * A source is explicit and account-scoped; collector output alone does not prove
 * that usernames follow a particular Instagram reference.
 */
export type AudienceRefreshSource = {
  accountId: string;
  referenceId: string;
  collectorAgentId: string;
};

export const MAX_REFRESH_SOURCES = 20;
export const MAX_REFRESHES_PER_TICK = 3;
export const MIN_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const AUDIENCE_REFRESH_ACTION = 'reference_audience_refresh_v1';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validAgent = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{10,25}$/.test(value);

export function parseAudienceRefreshSources(raw: string | undefined): AudienceRefreshSource[] {
  if (!raw || raw.length > 5000) return [];
  let decoded: unknown;
  try { decoded = JSON.parse(raw) as unknown; } catch { return []; }
  if (!Array.isArray(decoded) || decoded.length > MAX_REFRESH_SOURCES) return [];
  const sources: AudienceRefreshSource[] = [];
  const references = new Set<string>();
  const agents = new Set<string>();
  for (const value of decoded) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || Object.keys(row).some(k =>
      !['accountId', 'referenceId', 'collectorAgentId'].includes(k)) ||
      !validId(row.accountId) || !validId(row.referenceId) || !validAgent(row.collectorAgentId))
      return [];
    const referenceKey = row.accountId + ':' + row.referenceId;
    // Do not silently assign the same collector to two references.
    if (references.has(referenceKey) || agents.has(row.collectorAgentId)) return [];
    references.add(referenceKey);
    agents.add(row.collectorAgentId);
    sources.push({ accountId: row.accountId, referenceId: row.referenceId,
      collectorAgentId: row.collectorAgentId });
  }
  return sources;
}

export function refreshIsDue(lastClaim: Date | null, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  if (!lastClaim) return true;
  if (!Number.isFinite(lastClaim.getTime()) || lastClaim > now) return false;
  return now.getTime() - lastClaim.getTime() >= MIN_REFRESH_INTERVAL_MS;
}

/** Keep only genuinely new names, excluding owner and reference. */
export function newAudienceNames(
  observed: Iterable<string>, saved: Iterable<string>, excluded: Iterable<string>,
): string[] {
  const valid = (v: string) => /^[a-z0-9._]{1,30}$/.test(v);
  const known = new Set([...saved].map(s => s.toLowerCase()));
  const ignored = new Set([...excluded].map(s => s.toLowerCase()));
  const names = new Set<string>();
  for (const raw of observed) {
    const name = raw.toLowerCase();
    if (valid(name) && !known.has(name) && !ignored.has(name)) names.add(name);
  }
  return [...names].sort();
}
