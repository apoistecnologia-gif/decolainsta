import { AUDIENCE_HISTORY_ACTION, parseAudienceSnapshot } from '@/lib/reference-audience-history';

/** A persistent index of already-saved snapshots, never an Instagram execution queue. */
export const AUDIENCE_CANDIDATE_ACTION = 'reference_audience_candidate_v1';
export const MAX_CANDIDATES_PER_ACCOUNT = 2000;
export const MAX_SNAPSHOTS_PER_SYNC = 2500;
export const MAX_QUEUE_ENTRIES_PER_SYNC = MAX_CANDIDATES_PER_ACCOUNT;

export type CandidateEvidence = {
  version: 1;
  status: 'identified_unverified';
  referenceId: string;
  referenceUsername: string;
  snapshotId: string;
  collectorAgentId: string;
  provenance: 'operator_assigned_collector_result';
  verifiedByMeta: false;
  followbackVerified: false;
  actionsEnabled: false;
};
export type CandidateRecord = CandidateEvidence & { username: string };
export type CandidateSource = {
  id: string;
  targetUsername: string | null;
  details: string | null;
  createdAt: Date;
};
export type CandidateReference = { id: string; username: string };

const validUsername = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9._]{1,30}$/.test(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);

export function makeCandidateEvidence(
  referenceId: string, referenceUsername: string, snapshotId: string,
  collectorAgentId: string,
): CandidateEvidence | null {
  if (!validId(referenceId) || !validId(snapshotId) ||
      !validUsername(referenceUsername) || !/^\d{10,25}$/.test(collectorAgentId)) return null;
  return {
    version: 1,
    status: 'identified_unverified',
    referenceId, referenceUsername, snapshotId, collectorAgentId,
    provenance: 'operator_assigned_collector_result',
    verifiedByMeta: false, followbackVerified: false, actionsEnabled: false,
  };
}

export function parseCandidateEvidence(details: unknown): CandidateEvidence | null {
  if (typeof details !== 'string' || details.length > 1200) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(details) as unknown; } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const data = parsed as Record<string, unknown>;
  const evidence = makeCandidateEvidence(
    data.referenceId as string, data.referenceUsername as string,
    data.snapshotId as string, data.collectorAgentId as string,
  );
  if (!evidence || data.version !== 1 || data.status !== evidence.status ||
      data.provenance !== evidence.provenance ||
      data.verifiedByMeta !== false || data.followbackVerified !== false ||
      data.actionsEnabled !== false ||
      Object.keys(data).some(k => !(k in evidence))) return null;
  return evidence;
}

/**
 * Assemble at most 2,000 distinct usernames from saved, owned, validated
 * references. Round-robin between references; existing names and exclusions
 * are never inserted again. No external request, timing, or social actions.
 */
export function planCandidateIndex(
  references: CandidateReference[],
  savedSnapshots: CandidateSource[],
  existingUsernames: Iterable<string>,
  excludedUsernames: Iterable<string>,
  limit = MAX_CANDIDATES_PER_ACCOUNT,
): { insert: CandidateRecord[]; available: number; referencesRepresented: number } {
  const safeLimit = Math.max(0, Math.min(MAX_CANDIDATES_PER_ACCOUNT, Math.floor(limit) || 0));
  const excluded = new Set([...excludedUsernames].filter(validUsername).map(x => x.toLowerCase()));
  const present = new Set([...existingUsernames].filter(validUsername).map(x => x.toLowerCase()));
  const byReference = new Map<string, { name: string; candidateByName: Map<string, CandidateRecord> }>();
  for (const ref of references) {
    const name = ref.username.toLowerCase();
    if (!validId(ref.id) || !validUsername(name)) continue;
    byReference.set(ref.id, { name, candidateByName: new Map() });
    excluded.add(name);
  }
  const ordered = [...savedSnapshots].sort((a, b) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  for (const row of ordered) {
    const snapshot = parseAudienceSnapshot(row.details);
    if (!snapshot) continue;
    const bucket = byReference.get(snapshot.referenceId);
    if (!bucket || bucket.name !== snapshot.referenceUsername ||
        row.targetUsername?.toLowerCase() !== bucket.name) continue;
    const evidence = makeCandidateEvidence(snapshot.referenceId, bucket.name, row.id,
      snapshot.collectorAgentId);
    if (!evidence) continue;
    for (const rawName of snapshot.usernames) {
      const name = rawName.toLowerCase();
      if (!validUsername(name) || excluded.has(name)) continue;
      if (!bucket.candidateByName.has(name))
        bucket.candidateByName.set(name, { ...evidence, username: name });
    }
  }
  const buckets = [...byReference.values()].sort((a, b) => a.name.localeCompare(b.name))
    .map(item => ({
      names: [...item.candidateByName.keys()].sort(),
      source: item.candidateByName,
      pos: 0,
    }));
  const eligible = new Set(buckets.flatMap(b => b.names).filter(name => !excluded.has(name)));
  const newlySeen = new Set(present);
  const insert: CandidateRecord[] = [];
  for (;;) {
    let advanced = false;
    for (const bucket of buckets) {
      while (bucket.pos < bucket.names.length) {
        const name = bucket.names[bucket.pos++];
        if (newlySeen.has(name)) continue;
        newlySeen.add(name);
        const row = bucket.source.get(name);
        if (row) insert.push(row);
        advanced = true;
        break;
      }
      if (insert.length >= safeLimit) break;
    }
    if (!advanced || insert.length >= safeLimit) break;
  }
  return {
    insert: insert.slice(0, safeLimit),
    available: eligible.size,
    referencesRepresented: buckets.filter(b => b.names.length > 0).length,
  };
}

export function validCandidateUsername(value: unknown): value is string {
  return validUsername(value);
}

export { AUDIENCE_HISTORY_ACTION };
