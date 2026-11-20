import { planExactReadOnlyCollectorBindings } from './reference-audience-auto-binding';
import type { SavedReferenceForMatch } from './reference-audience-auto-binding';
import type { AudienceRefreshSource } from './reference-audience-refresh';
import type { DiscoveredFollowerCollector } from './providers/phantombuster-collector-discovery';

export type GlobalMatchPlan = {
  candidates: AudienceRefreshSource[];
  alreadyBound: number;
  unmatched: number;
  ambiguousOrInUse: number;
  deferred: number;
  revoked: number;
  ambiguousAcrossCustomers: number;
  referencesExamined: number;
};

/** A shared provider workspace must NEVER automatically choose which of
 * two different customers owns a collector just because both referenced the
 * same public Instagram profile. The operator must resolve that separately.
 *
 * No Instagram activity, agent create or launch is performed.
 */
export function planGlobalReadOnlyBindings(
  references: SavedReferenceForMatch[],
  discovered: DiscoveredFollowerCollector[],
  existing: AudienceRefreshSource[],
  revokedReferenceKeys: ReadonlySet<string>,
  maxNew = 3,
  reservedAgents: ReadonlySet<string> = new Set(),
): GlobalMatchPlan {
  const key = (r: SavedReferenceForMatch) => r.accountId + ':' + r.id;
  const assigned = new Set(existing.map(r => r.accountId + ':' + r.referenceId));
  const uniqueReferenceKeys = new Set<string>();
  const eligible = references.filter(ref => {
    const identity = key(ref);
    if (uniqueReferenceKeys.has(identity)) return false;
    uniqueReferenceKeys.add(identity);
    return !revokedReferenceKeys.has(identity);
  });
  // Only different client accounts cause cross-customer ambiguity. Multiple
  // references with same username under one customer are already rejected by DB.
  const owners = new Map<string, Set<string>>();
  for (const ref of eligible) {
    const name = ref.username.toLowerCase();
    const set = owners.get(name) ?? new Set<string>();
    set.add(ref.accountId);
    owners.set(name, set);
  }
  const collisions = eligible.filter(ref =>
    !assigned.has(key(ref)) && (owners.get(ref.username.toLowerCase())?.size ?? 0) > 1);
  const safe = eligible.filter(ref => !collisions.includes(ref));
  const planned = planExactReadOnlyCollectorBindings(
    safe, discovered, existing, maxNew, reservedAgents);
  return {
    ...planned,
    revoked: references.length - eligible.length,
    ambiguousAcrossCustomers: collisions.length,
    referencesExamined: references.length,
  };
}
