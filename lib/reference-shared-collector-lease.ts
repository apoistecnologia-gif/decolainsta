import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  resolveLatestAudienceBindings,
} from './reference-audience-source-registry';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
  reservedCollectorDraftAgents,
} from './reference-collector-draft-events';

/**
 * Durable lease preparation for a future sequential collector orchestrator.
 * There is deliberately NO endpoint, scheduler or provider launch for this
 * function. It is disabled by default in every environment.
 *
 * A PostgreSQL transaction-scoped advisory lock serializes competing claims
 * for the SAME agent across all tenant accounts. The activity log holds an
 * immutable reservation; it does not expire or auto-unlock after a timeout.
 * An operator must eventually verify provider completion before adding a
 * separate, reviewed release flow. No external requests are made here.
 */
export const SHARED_COLLECTOR_LEASE_ACTION = 'reference_shared_collector_lease_v1';
export type SharedCollectorLeaseEvent = Readonly<{
  version: 1;
  state: 'reserved';
  claimId: string;
  accountId: string;
  referenceId: string;
  collectorAgentId: string;
  confirmation: 'operator_sequential_only';
  launchesProvider: false;
}>;

const localId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const agentIdValid = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{10,25}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export function parseSharedCollectorLease(raw: string | null): SharedCollectorLeaseEvent | null {
  if (!raw || raw.length > 700) return null;
  let payload: unknown;
  try { payload = JSON.parse(raw) as unknown; } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const event = payload as Record<string, unknown>;
  if (Object.keys(event).length !== 8 ||
    event.version !== 1 || event.state !== 'reserved' ||
    event.confirmation !== 'operator_sequential_only' ||
    event.launchesProvider !== false ||
    !uuid(event.claimId) || !localId(event.accountId) ||
    !localId(event.referenceId) || !agentIdValid(event.collectorAgentId))
    return null;
  return event as SharedCollectorLeaseEvent;
}

export function makeSharedCollectorLease(input: {
  accountId: string; referenceId: string; collectorAgentId: string; claimId: string;
}): SharedCollectorLeaseEvent | null {
  if (!localId(input.accountId) || !localId(input.referenceId) ||
    !agentIdValid(input.collectorAgentId) || !uuid(input.claimId)) return null;
  return {
    version: 1, state: 'reserved', claimId: input.claimId,
    accountId: input.accountId, referenceId: input.referenceId,
    collectorAgentId: input.collectorAgentId,
    confirmation: 'operator_sequential_only', launchesProvider: false,
  };
}

export type SharedCollectorLeaseClaim =
  | Readonly<{ status: 'reserved'; claimId: string }>
  | Readonly<{ status: 'disabled' | 'invalid' | 'unauthorized' |
    'not-owned' | 'in-use' | 'already-reserved' | 'review-required' }>;

/**
 * Internal only, NOT an HTTP handler. No provider calls or social actions.
 * No migration required. Never reuse any agent reserved by older draft or
 * individual collector bindings, and never create a second lease for an
 * agent even if the first reservation is old or malformed.
 */
export async function reserveSharedCollectorForFutureRead(input: {
  operatorUserId: string;
  accountId: string;
  referenceId: string;
  collectorAgentId: string;
}): Promise<SharedCollectorLeaseClaim> {
  if (process.env.VERCEL_ENV !== 'preview' ||
    process.env.PHANTOMBUSTER_SHARED_COLLECTOR_LEASE_ENABLED !== 'yes' ||
    process.env.PHANTOMBUSTER_SHARED_COLLECTOR_AGENT_ID !== input.collectorAgentId)
    return { status: 'disabled' };
  if (!localId(input.operatorUserId) || !localId(input.accountId) ||
    !localId(input.referenceId) || !agentIdValid(input.collectorAgentId))
    return { status: 'invalid' };

  try {
    return await prisma.$transaction(async tx => {
      const admin = await tx.user.findUnique({
        where: { id: input.operatorUserId }, select: { role: true },
      });
      if (admin?.role !== 'admin') return { status: 'unauthorized' } as const;

      // Global per-agent lock (not tenant-local); collision can only serialize
      // unrelated agents, never grant two reservations to one agent.
      await tx.$queryRaw<{ locked: number }[]>`
        SELECT 1::int AS locked
        FROM pg_advisory_xact_lock(
          hashtext('decolainsta_shared_collector_v1'),
          hashtext(${input.collectorAgentId})
        )
      `;

      const reference = await tx.targetAccount.findFirst({
        where: { id: input.referenceId, instagramAccountId: input.accountId,
          instagramAccount: { userId: input.operatorUserId } },
        select: { id: true },
      });
      if (!reference) return { status: 'not-owned' } as const;

      const [previous, bindings, drafts] = await Promise.all([
        tx.activityLog.findFirst({
          where: {
            action: SHARED_COLLECTOR_LEASE_ACTION,
            targetUsername: input.collectorAgentId,
          },
          select: { details: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        tx.activityLog.findMany({
          where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
          select: { id: true, instagramAccountId: true,
            targetUsername: true, details: true, createdAt: true },
          take: MAX_SOURCE_BINDING_LOGS + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        tx.activityLog.findMany({
          where: { action: COLLECTOR_DRAFT_ACTION },
          select: { targetUsername: true, details: true },
          take: COLLECTOR_DRAFT_MAX_LOGS + 1,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      ]);
      if (previous) {
        // Malformed reservations are NEVER ignored.
        const event = parseSharedCollectorLease(previous.details);
        return { status: event?.collectorAgentId === input.collectorAgentId ?
          'already-reserved' : 'review-required' } as const;
      }
      if (bindings.length > MAX_SOURCE_BINDING_LOGS ||
        drafts.length > COLLECTOR_DRAFT_MAX_LOGS)
        return { status: 'review-required' } as const;
      if (resolveLatestAudienceBindings(bindings).some(
        source => source.collectorAgentId === input.collectorAgentId) ||
        reservedCollectorDraftAgents(drafts).has(input.collectorAgentId))
        return { status: 'in-use' } as const;

      const claimId = randomUUID();
      const event = makeSharedCollectorLease({ ...input, claimId });
      if (!event) return { status: 'invalid' } as const;
      await tx.activityLog.create({
        data: {
          instagramAccountId: input.accountId,
          targetUsername: input.collectorAgentId,
          action: SHARED_COLLECTOR_LEASE_ACTION,
          success: false,
          details: JSON.stringify(event),
        },
      });
      return { status: 'reserved', claimId } as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch {
    // Transaction failure or lock timeout is NOT authorization to retry a
    // potentially completed write or to launch a collector.
    return { status: 'review-required' };
  }
}
