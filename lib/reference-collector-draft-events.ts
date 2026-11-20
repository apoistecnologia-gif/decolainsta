import type { ActivityLog } from '@prisma/client';

export const COLLECTOR_DRAFT_ACTION = 'reference_collector_draft_v1';
export const COLLECTOR_DRAFT_MAX_LOGS = 5000;

export type CollectorDraftState =
  | 'claimed' | 'created' | 'existing-draft' | 'unconfirmed' |
    'capacity-reached' | 'rejected';

export type CollectorDraftEvent = {
  version: 1;
  referenceId: string;
  state: CollectorDraftState;
  agentId: string | null;
  setupComplete: false;
  autoLaunchEnabled: false;
};

export function makeCollectorDraftEvent(
  referenceId: string, state: CollectorDraftState, agentId: string | null = null,
): CollectorDraftEvent | null {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(referenceId) ||
      !['claimed', 'created', 'existing-draft', 'unconfirmed',
        'capacity-reached', 'rejected'].includes(state) ||
      ((state === 'created' || state === 'existing-draft') &&
        !/^\d{10,25}$/.test(agentId ?? '')) ||
      ((state !== 'created' && state !== 'existing-draft') && agentId !== null))
    return null;
  return {
    version: 1, referenceId, state, agentId,
    setupComplete: false, autoLaunchEnabled: false,
  };
}

export function parseCollectorDraftEvent(raw: unknown): CollectorDraftEvent | null {
  if (typeof raw !== 'string' || raw.length > 500) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 6 || record.version !== 1 ||
      record.setupComplete !== false || record.autoLaunchEnabled !== false)
    return null;
  return makeCollectorDraftEvent(record.referenceId as string,
    record.state as CollectorDraftState, record.agentId as string | null);
}

/**
 * Reserved agent identities survive reference deletion, revocation and newer
 * uncertain draft events. Generic matching must never appropriate a prepared
 * agent from another customer. Only verified reconciliation may bind it.
 */
export function reservedCollectorDraftAgents(
  rows: ReadonlyArray<Pick<ActivityLog, 'details' | 'targetUsername'>>,
): ReadonlySet<string> {
  const reserved = new Set<string>();
  for (const row of rows) {
    const event = parseCollectorDraftEvent(row.details);
    if (event?.agentId && event.referenceId === row.targetUsername)
      reserved.add(event.agentId);
  }
  return reserved;
}

/** Any previous claim blocks another remote create, even if it failed/unknown. */
export function collectorDraftAlreadyAttempted(
  rows: Pick<ActivityLog, 'details' | 'targetUsername'>[],
  referenceId: string,
): boolean {
  return rows.some(row => row.targetUsername === referenceId);
}
