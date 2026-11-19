/**
 * Lightweight, local-only metrics over explicitly saved, unverified audience snapshots.
 * No account data is transmitted, persisted or inferred from these calculations.
 */
export type SavedAudienceBatch = { id: string; savedAt: string; usernames: string[] };
export type AudienceBatchMetrics = { newNames: number; repeatedNames: number };
export type AudienceHistoryMetrics = {
  consultations: number;
  distinctNames: number;
  repeatedNames: number;
  appearances: number;
  byBatchId: Record<string, AudienceBatchMetrics>;
};

export function summarizeAudienceHistory(history: SavedAudienceBatch[]): AudienceHistoryMetrics {
  const appearances = new Map<string, number>();
  const byBatchId: Record<string, AudienceBatchMetrics> = Object.create(null) as Record<string, AudienceBatchMetrics>;
  const sorted = [...history].sort((a, b) => {
    const dateA = Date.parse(a.savedAt);
    const dateB = Date.parse(b.savedAt);
    const timeA = Number.isFinite(dateA) ? dateA : 0;
    const timeB = Number.isFinite(dateB) ? dateB : 0;
    return timeA - timeB || a.id.localeCompare(b.id);
  });
  let total = 0;
  for (const item of sorted) {
    let newNames = 0;
    let repeatedNames = 0;
    for (const username of new Set(item.usernames)) {
      // History API already filters allowed usernames; this also tolerates
      // one malformed entry without inflating metrics or surfacing its value.
      if (!/^[a-z0-9._]{1,30}$/.test(username)) continue;
      const count = appearances.get(username) ?? 0;
      if (count) repeatedNames++;
      else newNames++;
      appearances.set(username, count + 1);
      total++;
    }
    byBatchId[item.id] = { newNames, repeatedNames };
  }
  return {
    consultations: history.length,
    distinctNames: appearances.size,
    repeatedNames: [...appearances.values()].filter(count => count >= 2).length,
    appearances: total,
    byBatchId,
  };
}
