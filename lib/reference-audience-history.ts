import { createHash } from 'node:crypto';

export const AUDIENCE_HISTORY_ACTION = 'reference_audience_snapshot_v1';
export const MAX_HISTORY_BATCHES = 200;
export type AudienceHistoryLocation = 'completed_run' | 'latest_agent_file';
export type AudienceSnapshot = {
  version: 1;
  referenceId: string;
  referenceUsername: string;
  collectorAgentId: string;
  resultLocation: AudienceHistoryLocation;
  usernames: string[];
  fingerprint: string;
  provenance: 'operator_assigned_collector_result';
  verifiedByMeta: false;
};
const validUsername = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9._]{1,30}$/.test(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(value);

export function makeAudienceSnapshot(
  referenceId: string, referenceUsername: string, collectorAgentId: string,
  usernames: unknown, resultLocation: unknown,
): AudienceSnapshot | null {
  if (!validId(referenceId) || !validUsername(referenceUsername) ||
      typeof collectorAgentId !== 'string' || !/^\d{10,25}$/.test(collectorAgentId) ||
      (resultLocation !== 'completed_run' && resultLocation !== 'latest_agent_file') ||
      !Array.isArray(usernames) || usernames.length < 1 || usernames.length > 10 ||
      !usernames.every(validUsername)) return null;
  const sanitized = Array.from(new Set(usernames as string[])).filter(
    name => name !== referenceUsername,
  );
  if (!sanitized.length || sanitized.length !== usernames.length) return null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([referenceId, collectorAgentId, resultLocation, sanitized]))
    .digest('hex');
  return {
    version: 1, referenceId, referenceUsername, collectorAgentId,
    resultLocation, usernames: sanitized, fingerprint,
    provenance: 'operator_assigned_collector_result', verifiedByMeta: false,
  };
}

export function parseAudienceSnapshot(details: unknown): AudienceSnapshot | null {
  if (typeof details !== 'string' || details.length > 4000) return null;
  let value: unknown;
  try { value = JSON.parse(details) as unknown; } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1 || obj.provenance !== 'operator_assigned_collector_result' ||
      obj.verifiedByMeta !== false) return null;
  const result = makeAudienceSnapshot(
    obj.referenceId as string, obj.referenceUsername as string,
    obj.collectorAgentId as string, obj.usernames, obj.resultLocation,
  );
  return result && result.fingerprint === obj.fingerprint ? result : null;
}
