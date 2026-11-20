/** Only known read-only statuses may be shown to an account owner. */
export type AudienceLastReadStatus =
  | 'imported' | 'unchanged' | 'historical-only'
  | 'source-unavailable' | 'source-mismatch'
  | 'invalid-key' | 'rate-limited' | 'unavailable'
  | 'no-run' | 'no-results' | 'unsupported-result'
  | 'latest-file-not-audited' | 'unverified-container-timestamp-or-binding'
  | 'history-limit' | 'failed' | 'claimed' | 'other';

const ALLOWED = new Set<AudienceLastReadStatus>([
  'imported','unchanged','historical-only','source-unavailable','source-mismatch',
  'invalid-key','rate-limited','unavailable','no-run','no-results','unsupported-result',
  'latest-file-not-audited','unverified-container-timestamp-or-binding',
  'history-limit','failed','claimed',
]);

export function lastReadStatusFromDetails(details: unknown): AudienceLastReadStatus | null {
  if (typeof details !== 'string' || details.length > 1000) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(details) as unknown; } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const data = parsed as Record<string, unknown>;
  if (data.version !== 1 || typeof data.status !== 'string') return null;
  return ALLOWED.has(data.status as AudienceLastReadStatus)
    ? data.status as AudienceLastReadStatus : 'other';
}

export type CollectorMetadataCheck =
  | 'matched' | 'mismatch' | 'unavailable' | 'invalid-key'
  | 'rate-limited' | 'not-found' | 'not-checked';

/** Separate API-key workspace health from the collector's actual configuration. */
export function presentCollectorReadHealth(
  lastRead: AudienceLastReadStatus | null,
  collectorCheck: CollectorMetadataCheck,
): 'ready' | 'needs-configuration' | 'provider-error' |
  'historical-only' | 'last-attempt-failed' | 'not-yet-tested' {
  if (collectorCheck === 'mismatch' || collectorCheck === 'not-found')
    return 'needs-configuration';
  if (collectorCheck === 'unavailable' || collectorCheck === 'invalid-key' ||
      collectorCheck === 'rate-limited') return 'provider-error';
  if (lastRead === 'historical-only') return 'historical-only';
  if (lastRead === 'imported' || lastRead === 'unchanged') return 'ready';
  if (lastRead && lastRead !== 'claimed') return 'last-attempt-failed';
  return 'not-yet-tested';
}
