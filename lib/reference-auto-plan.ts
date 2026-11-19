import { createHash } from 'node:crypto';

export type ReferenceAudiencePool = {
  referenceId: string;
  referenceUsername: string;
  usernames: string[];
};
export type AutoPlannedCandidate = { username: string; referenceUsername: string };
export type AutomaticAudiencePlan = {
  source: 'saved_snapshots_unverified';
  readOnly: true;
  actionsEnabled: false;
  referenceVerified: false;
  followbackVerified: false;
  suggestedReviewAfterHours: 48;
  referencesWithSnapshots: number;
  eligibleDistinct: number;
  candidates: AutoPlannedCandidate[];
};

const isUsername = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9._]{1,30}$/.test(value);
function rank(seed: string, key: string) {
  return createHash('sha256').update(seed).update('\0').update(key).digest('hex');
}

/**
 * Read-only planning. Mix candidates from every saved reference without
 * operator selection, without storing a new queue or triggering social actions.
 * Ordering changes by the caller's day seed, not through evasion or timing tricks.
 */
export function planAudienceAutomatically(
  pools: ReferenceAudiencePool[],
  excludedUsernames: Iterable<string>,
  daySeed: string,
): AutomaticAudiencePlan {
  const exclusions = new Set(
    [...excludedUsernames].filter(isUsername).map(s => s.toLowerCase()),
  );
  const references = pools.filter(p => isUsername(p.referenceUsername));
  for (const ref of references) exclusions.add(ref.referenceUsername);
  const buckets = references.map(ref => ({
    name: ref.referenceUsername,
    values: [...new Set(ref.usernames.filter(isUsername))]
      .filter(username => !exclusions.has(username))
      .sort((a, b) => rank(daySeed, a).localeCompare(rank(daySeed, b))),
    index: 0,
  })).sort((a, b) => rank(daySeed, a.name).localeCompare(rank(daySeed, b.name)));

  const all = new Set(buckets.flatMap(b => b.values));
  const chosen = new Set<string>();
  const candidates: AutoPlannedCandidate[] = [];
  // Round-robin representation across saved reference accounts.
  for (;;) {
    let advanced = false;
    for (const bucket of buckets) {
      while (bucket.index < bucket.values.length) {
        const name = bucket.values[bucket.index++];
        if (chosen.has(name)) continue;
        chosen.add(name);
        candidates.push({ username: name, referenceUsername: bucket.name });
        advanced = true;
        break;
      }
      if (candidates.length === 10) break;
    }
    if (!advanced || candidates.length === 10) break;
  }
  return {
    source: 'saved_snapshots_unverified',
    readOnly: true,
    actionsEnabled: false,
    referenceVerified: false,
    followbackVerified: false,
    suggestedReviewAfterHours: 48,
    referencesWithSnapshots: buckets.filter(b => b.values.length > 0).length,
    eligibleDistinct: all.size,
    candidates,
  };
}
