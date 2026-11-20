import type { AudienceRefreshSource } from './reference-audience-refresh';
import { parseCollectorDraftEvent } from './reference-collector-draft-events';

export type PreparedReference = {
  id: string; accountId: string; username: string; createdAt: Date;
};
export type PreparedDraft = {
  accountId: string; referenceId: string | null;
  createdAt: Date; details: string | null;
};
export type PreparedPair = {
  accountId: string; referenceId: string;
  username: string; agentId: string;
};

/**
 * Select only references for which our own account+reference-specific draft
 * event recorded a concrete agent ID. This is NOT a provider proof: callers
 * must independently verify exact deterministic agent name, script, manual
 * launch type and currently configured reference before persisting a binding.
 *
 * Do not reuse an agent ID present in different draft records (including an
 * orphaned/deleted source). This avoids silently transferring ownership.
 */
export function planPreparedDraftReconciliation(
  references: PreparedReference[],
  events: PreparedDraft[],
  existing: AudienceRefreshSource[],
  revoked: ReadonlySet<string>,
  maxChecks = 3,
): { candidates: PreparedPair[]; pending: number; ambiguous: number } {
  const key = (a: string, r: string) => a + ':' + r;
  const activeKeys = new Set(existing.map(b => key(b.accountId, b.referenceId)));
  const activeAgents = new Set(existing.map(b => b.collectorAgentId));
  const allAgents = new Map<string, Set<string>>();
  const latest = new Map<string, PreparedDraft>();
  const orderedEvents = [...events].sort((a,b) =>
    b.createdAt.getTime() - a.createdAt.getTime() ||
    b.accountId.localeCompare(a.accountId));
  for (const entry of orderedEvents) {
    if (!entry.referenceId) continue;
    const k = key(entry.accountId, entry.referenceId);
    if (!latest.has(k)) latest.set(k, entry);
    const parsed = parseCollectorDraftEvent(entry.details);
    if (!parsed || parsed.referenceId !== entry.referenceId || !parsed.agentId) continue;
    const owners = allAgents.get(parsed.agentId) ?? new Set<string>();
    owners.add(k);
    allAgents.set(parsed.agentId, owners);
  }

  let pending = 0, ambiguous = 0;
  const candidates: PreparedPair[] = [];
  const sorted = [...references].sort((a,b) =>
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id));
  for (const ref of sorted) {
    const k = key(ref.accountId, ref.id);
    if (revoked.has(k) || activeKeys.has(k)) continue;
    const log = latest.get(k);
    if (!log) continue;
    const event = parseCollectorDraftEvent(log.details);
    if (!event || event.referenceId !== ref.id ||
        (event.state !== 'created' && event.state !== 'existing-draft') ||
        !event.agentId) continue;
    if (allAgents.get(event.agentId)?.size !== 1 ||
        activeAgents.has(event.agentId)) { ambiguous++; continue; }
    if (!/^[a-z0-9._]{1,30}$/.test(ref.username.toLowerCase())) continue;
    pending++;
    if (candidates.length < Math.max(0, Math.min(3, maxChecks)))
      candidates.push({
        accountId: ref.accountId, referenceId: ref.id,
        username: ref.username.toLowerCase(), agentId: event.agentId,
      });
  }
  return { candidates, pending, ambiguous };
}
