export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { discoverFollowerCollectors } from '@/lib/providers/phantombuster-collector-discovery';
import { planExactReadOnlyCollectorBindings } from '@/lib/reference-audience-auto-binding';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
  reservedCollectorDraftAgents,
} from '@/lib/reference-collector-draft-events';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import {
  SHARED_COLLECTOR_LEASE_ACTION, MAX_SHARED_COLLECTOR_LEASE_LOGS,
  reservedSharedCollectorAgents,
} from '@/lib/reference-shared-collector-lease';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  makeAudienceSourceBinding, resolveLatestAudienceBindings,
  disabledAudienceReferenceKeys,
} from '@/lib/reference-audience-source-registry';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Operator-only PREVIEW discovery and association of EXISTING agents.
 * No agent creation, scheduling, collector launch or Instagram action.
 * Customer never has to enter a PhantomBuster agent ID or select a follower.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED !== 'yes')
    return NextResponse.json({ error: 'Descoberta experimental desativada' },
      { status: 403, headers: HEADERS });
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' },
    { status: 401, headers: HEADERS });
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (user?.role !== 'admin')
    return NextResponse.json({ error: 'Acesso restrito ao administrador' },
      { status: 403, headers: HEADERS });

  if (request.headers.get('origin') !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Origem inválida' },
      { status: 403, headers: HEADERS });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' },
      { status: 415, headers: HEADERS });
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 200)
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  let input: unknown;
  try { input = JSON.parse(raw) as unknown; } catch { input = null; }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(k => !['accountId', 'operation'].includes(k)) ||
      body.operation !== 'match-existing' || typeof body.accountId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.accountId))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });

  const accountId = body.accountId as string;
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId }, select: { id: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' },
    { status: 404, headers: HEADERS });
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey))
    return NextResponse.json({ error: 'Chave do provedor não configurada' },
      { status: 409, headers: HEADERS });

  // No API keys or raw PhantomBuster arguments ever leave server memory.
  const discovered = await discoverFollowerCollectors(apiKey);
  if (discovered.status !== 'ok')
    return NextResponse.json({ error: 'Não foi possível verificar os coletores',
      status: discovered.status }, { status: 503, headers: HEADERS });

  const refs = await prisma.targetAccount.findMany({
    where: { instagramAccountId: account.id },
    select: { id: true, username: true }, take: 101,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (refs.length > 100)
    return NextResponse.json({ error: 'Limite experimental de referências excedido' },
      { status: 409, headers: HEADERS });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const summary = await prisma.$transaction(async tx => {
        const [rows, currentRefs, drafts, allRefs, leases] = await Promise.all([
          tx.activityLog.findMany({
            where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
            select: {
              id: true, instagramAccountId: true, targetUsername: true,
              details: true, createdAt: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: MAX_SOURCE_BINDING_LOGS + 1,
          }),
          tx.targetAccount.findMany({
            where: { id: { in: refs.map(ref => ref.id) }, instagramAccountId: accountId },
            select: { id: true, username: true },
          }),
          tx.activityLog.findMany({
            where: { action: COLLECTOR_DRAFT_ACTION },
            select: { targetUsername: true, details: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: COLLECTOR_DRAFT_MAX_LOGS + 1,
          }),
          // Check ownership across EVERY customer, not only the chosen account.
          // A public reference shared between clients cannot assign one agent.
          tx.targetAccount.findMany({
            select: { id: true, username: true, instagramAccountId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1001,
          }),
          tx.activityLog.findMany({
            where: { action: SHARED_COLLECTOR_LEASE_ACTION },
            select: { instagramAccountId: true, targetUsername: true, details: true },
            take: MAX_SHARED_COLLECTOR_LEASE_LOGS + 1,
          }),
        ]);
        if (rows.length > MAX_SOURCE_BINDING_LOGS ||
            drafts.length > COLLECTOR_DRAFT_MAX_LOGS ||
            allRefs.length > 1000 ||
            leases.length > MAX_SHARED_COLLECTOR_LEASE_LOGS) return null;
        const shared = reservedSharedCollectorAgents(leases);
        if (!shared.valid) return null;
        // Protect against deleted/renamed refs and concurrent binds.
        const active = resolveLatestAudienceBindings(rows);
        const suppressed = disabledAudienceReferenceKeys(rows);
        const owners = new Map<string, Set<string>>();
        for (const ref of allRefs) {
          if (suppressed.has(ref.instagramAccountId + ':' + ref.id)) continue;
          const name = ref.username.toLowerCase();
          const set = owners.get(name) ?? new Set<string>();
          set.add(ref.instagramAccountId);
          owners.set(name, set);
        }
        const mapped = currentRefs
          .filter(ref => !suppressed.has(accountId + ':' + ref.id))
          .map(ref => ({ id: ref.id, username: ref.username, accountId }));
        const uniqueToCustomer = mapped.filter(ref =>
          (owners.get(ref.username.toLowerCase())?.size ?? 0) === 1);
        const plan = planExactReadOnlyCollectorBindings(
          uniqueToCustomer, discovered.collectors, active, 3,
          new Set([...reservedCollectorDraftAgents(drafts), ...shared.agents]));
        if (plan.candidates.length) await tx.activityLog.createMany({
          data: plan.candidates.map(source => ({
            instagramAccountId: source.accountId,
            targetUsername: source.referenceId,
            action: AUDIENCE_SOURCE_BINDING_ACTION, success: true,
            details: JSON.stringify(makeAudienceSourceBinding(
              source.referenceId, source.collectorAgentId, true)),
          })),
        });
        return { matched: plan.candidates.length,
          alreadyBound: plan.alreadyBound,
          unmatched: plan.unmatched,
          ambiguousOrInUse: plan.ambiguousOrInUse,
          deferred: plan.deferred, referencesExamined: mapped.length,
          ambiguousAcrossCustomers: mapped.length - uniqueToCustomer.length,
          excludedByOwner: currentRefs.length - mapped.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!summary) return NextResponse.json({ error: 'Registro de vínculos atingiu o limite' },
        { status: 409, headers: HEADERS });
      return NextResponse.json({
        ...summary, agentsExamined: discovered.agentsExamined,
        origin: 'existing_collector_configuration',
        targetVerifiedByMeta: false, actionsEnabled: false,
        instagramActionsExecuted: 0,
      }, { headers: HEADERS });
    } catch (error) {
      if ((error as {code?: string})?.code === 'P2034' && attempt < 2) continue;
      return NextResponse.json({ error: 'Falha na associação automática' },
        { status: 503, headers: HEADERS });
    }
  }
  return NextResponse.json({ error: 'Conflito de sincronização' },
    { status: 503, headers: HEADERS });
}
