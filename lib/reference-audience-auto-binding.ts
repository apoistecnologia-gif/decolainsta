import type { AudienceRefreshSource } from './reference-audience-refresh';
import {
  matchUniqueCollectorForReference, type DiscoveredFollowerCollector,
} from './providers/phantombuster-collector-discovery';

export type SavedReferenceForMatch = { id: string; username: string; accountId: string };

export type AutoBindingPlan = {
  candidates: AudienceRefreshSource[];
  alreadyBound: number;
  unmatched: number;
  ambiguousOrInUse: number;
  deferred: number;
};

/** Pure planner. Never assigns an agent based only on the reference name. */
export function planExactReadOnlyCollectorBindings(
  references: SavedReferenceForMatch[],
  discovered: DiscoveredFollowerCollector[],
  existing: AudienceRefreshSource[],
  maxNew = 3,
  reservedAgents: ReadonlySet<string> = new Set(),
): AutoBindingPlan {
  const used = new Set([
    ...existing.map(e => e.collectorAgentId),
    ...reservedAgents,
  ]);
  const assigned = new Set(existing.map(e => e.accountId + ':' + e.referenceId));
  const candidates: AudienceRefreshSource[] = [];
  let alreadyBound = 0, unmatched = 0, ambiguousOrInUse = 0, deferred = 0;
  for (const ref of references) {
    const key = ref.accountId + ':' + ref.id;
    if (assigned.has(key)) { alreadyBound++; continue; }
    const matching = discovered.filter(agent =>
      agent.referenceUsername === ref.username.toLowerCase());
    if (matching.length === 0) { unmatched++; continue; }
    const agentId = matchUniqueCollectorForReference(discovered, ref.username);
    if (!agentId || used.has(agentId)) { ambiguousOrInUse++; continue; }
    if (candidates.length >= maxNew) { deferred++; continue; }
    candidates.push({
      accountId: ref.accountId, referenceId: ref.id, collectorAgentId: agentId,
    });
    used.add(agentId);
  }
  return { candidates, alreadyBound, unmatched, ambiguousOrInUse, deferred };
}
