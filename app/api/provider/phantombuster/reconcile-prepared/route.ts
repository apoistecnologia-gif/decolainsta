export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  findExistingCollectorDraft, prepareCollectorDraft,
} from '@/lib/providers/phantombuster-collector-drafts';
import { inspectConfiguredFollowerCollector } from '@/lib/providers/phantombuster-collector-discovery';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { planPreparedDraftReconciliation } from '@/lib/reference-prepared-draft-reconciliation';
import {
  SHARED_COLLECTOR_LEASE_ACTION, MAX_SHARED_COLLECTOR_LEASE_LOGS,
  reservedSharedCollectorAgents,
} from '@/lib/reference-shared-collector-lease';
import type {
  PreparedReference, PreparedDraft, PreparedPair,
} from '@/lib/reference-prepared-draft-reconciliation';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  makeAudienceSourceBinding, resolveLatestAudienceBindings,
  disabledAudienceReferenceKeys,
} from '@/lib/reference-audience-source-registry';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
} from '@/lib/reference-collector-draft-events';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const deny = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: HEADERS });

/**
 * Operator-only reconciliation of already-created deterministic drafts after
 * their provider setup. NO new agent, launch, schedule, session-cookie handling
 * or Instagram action occurs here. Each read is bounded to 3 candidates.
 *
 * A draft's saved agent ID alone is NEVER sufficient to bind it. Check exact
 * deterministic agent NAME, script, manual launch type, matching ID and current
 * one-reference input before the global SERIALIZABLE binding transaction.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED !== 'yes')
    return deny('Reconciliação experimental indisponível', 403);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return deny('Não autorizado', 401);
  const operator = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (operator?.role !== 'admin') return deny('Acesso restrito ao operador', 403);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return deny('Origem inválida', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return deny('Formato inválido', 415);
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 100) return deny('Parâmetros inválidos', 400);
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return deny('Operação inválida', 400);
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (body.operation !== 'reconcile-prepared' || keys.length > 2 ||
      keys.some(key => key !== 'operation' && key !== 'offset') ||
      (body.offset !== undefined &&
        (typeof body.offset !== 'number' || !Number.isInteger(body.offset) ||
          body.offset < 0 || body.offset > 1000)))
    return deny('Operação inválida', 400);
  const scanOffset = typeof body.offset === 'number' ? body.offset : 0;
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey))
    return deny('Integração não configurada', 409);

  // Global registry is essential: an agent associated elsewhere must never
  // become visible to a second customer just by filtering by account first.
  const load = async (client: typeof prisma) => {
    const [references, drafts, bindings, leases] = await Promise.all([
      client.targetAccount.findMany({
        select: { id: true, instagramAccountId: true, username: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1001,
      }),
      client.activityLog.findMany({
        where: { action: COLLECTOR_DRAFT_ACTION },
        select: {
          instagramAccountId: true, targetUsername: true,
          details: true, createdAt: true,
        }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: COLLECTOR_DRAFT_MAX_LOGS + 1,
      }),
      client.activityLog.findMany({
        where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
        select: {
          id: true, instagramAccountId: true, targetUsername: true,
          details: true, createdAt: true,
        }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_SOURCE_BINDING_LOGS + 1,
      }),
      client.activityLog.findMany({
        where: { action: SHARED_COLLECTOR_LEASE_ACTION },
        select: { instagramAccountId: true, targetUsername: true, details: true },
        take: MAX_SHARED_COLLECTOR_LEASE_LOGS + 1,
      }),
    ]);
    if (references.length > 1000 || drafts.length > COLLECTOR_DRAFT_MAX_LOGS ||
        bindings.length > MAX_SOURCE_BINDING_LOGS ||
        leases.length > MAX_SHARED_COLLECTOR_LEASE_LOGS) return null;
    const shared = reservedSharedCollectorAgents(leases);
    if (!shared.valid) return null;
    const refs: PreparedReference[] = references.map(r=>({
      id:r.id, accountId:r.instagramAccountId, username:r.username, createdAt:r.createdAt,
    }));
    const events: PreparedDraft[] = drafts.map(d=>({
      accountId:d.instagramAccountId, referenceId:d.targetUsername,
      details:d.details, createdAt:d.createdAt,
    }));
    const plan = planPreparedDraftReconciliation(refs, events,
      resolveLatestAudienceBindings(bindings),
      disabledAudienceReferenceKeys(bindings), 3, scanOffset);
    const eligible = plan.candidates.filter(p => !shared.agents.has(p.agentId));
    return { ...plan, candidates: eligible,
      ambiguous: plan.ambiguous + plan.candidates.length - eligible.length };
  };

  const planned = await load(prisma).catch(()=>null);
  if (!planned) return deny('Registro de preparação muito grande ou indisponível', 503);

  const verified: PreparedPair[] = [];
  let notConfigured=0, unverified=0;
  // Sequential and capped: at most six read-only provider requests.
  for (const pair of planned.candidates) {
    const expected = prepareCollectorDraft(
      pair.accountId, pair.referenceId, pair.username);
    if (!expected) { unverified++; continue; }
    const nameCheck = await findExistingCollectorDraft(apiKey, expected);
    if (nameCheck.status !== 'found' ||
        nameCheck.agentId !== pair.agentId) { unverified++; continue; }
    const configured = await inspectConfiguredFollowerCollector(
      apiKey, pair.agentId, pair.username);
    if (configured === 'matched') verified.push(pair);
    else if (configured === 'mismatch') notConfigured++;
    else unverified++;
  }
  if (!verified.length)
    return NextResponse.json({
      checked: planned.candidates.length, bound: 0, pending: planned.pending,
      notConfigured, unverified, ambiguous: planned.ambiguous,
      nextOffset: planned.nextOffset,
      createsCollectors: false, launchesCollectors: false,
      instagramActionsExecuted: 0, actionsEnabled: false,
    }, { headers: HEADERS });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const bound = await prisma.$transaction(async tx => {
        // Reload inside the SAME serializable transaction that appends bindings.
        const fresh = await load(tx as typeof prisma);
        if (!fresh) return null;
        const allowed = new Map(fresh.candidates.map(x=>[
          x.accountId + ':' + x.referenceId, x,
        ]));
        const selected = verified.filter(item => {
          const current = allowed.get(item.accountId + ':' + item.referenceId);
          return current && current.username === item.username &&
            current.agentId === item.agentId;
        });
        // No partial writes on malformed or invalid entries.
        const rows = selected.map(source => {
          const event = makeAudienceSourceBinding(
            source.referenceId, source.agentId, true);
          return event ? {
            instagramAccountId: source.accountId,
            targetUsername: source.referenceId,
            action: AUDIENCE_SOURCE_BINDING_ACTION,
            success: true,
            details: JSON.stringify(event),
          } : null;
        });
        if (rows.some(row=>row===null)) return null;
        if (rows.length) {
          await tx.activityLog.createMany({
            data: rows.filter((row): row is NonNullable<typeof row> => row !== null),
          });
        }
        return rows.length;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (bound === null) return deny('Conciliação pendente de revisão',409);
      return NextResponse.json({
        checked: planned.candidates.length, bound,
        pending: planned.pending, notConfigured, unverified,
        ambiguous: planned.ambiguous, nextOffset: planned.nextOffset,
        createsCollectors: false, launchesCollectors: false,
        instagramActionsExecuted: 0, actionsEnabled: false,
      }, { headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      return deny('Conflito ao registrar coletores configurados',503);
    }
  }
  return deny('Conflito de associação',503);
}
