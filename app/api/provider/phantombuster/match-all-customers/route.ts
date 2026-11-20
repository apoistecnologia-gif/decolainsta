export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { discoverFollowerCollectors } from '@/lib/providers/phantombuster-collector-discovery';
import { planGlobalReadOnlyBindings } from '@/lib/reference-audience-global-matching';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
  reservedCollectorDraftAgents,
} from '@/lib/reference-collector-draft-events';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  makeAudienceSourceBinding, resolveLatestAudienceBindings,
  disabledAudienceReferenceKeys,
} from '@/lib/reference-audience-source-registry';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const error = (reason: string, status: number) =>
  NextResponse.json({ error: reason }, { status, headers: HEADERS });

/**
 * The operator approves a single batch for ALL customers without choosing
 * specific accounts, references or candidate names. It only matches EXISTING
 * exact Follower Collector configurations. It never creates or launches
 * Phantoms, makes Instagram actions or trusts filenames/candidate counts.
 *
 * Shared workspace: a reference username appearing in more than one customer
 * account is deliberately held back, not arbitrarily assigned.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED !== 'yes')
    return error('Vinculação experimental desativada', 403);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return error('Não autorizado', 401);
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (user?.role !== 'admin') return error('Acesso restrito ao operador', 403);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return error('Origem inválida', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return error('Formato inválido', 415);
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 100) return error('Parâmetros inválidos', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      (parsed as Record<string, unknown>).operation !== 'match-all-existing')
    return error('Parâmetros inválidos', 400);

  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey))
    return error('Integração não configurada', 409);
  // One read-only provider inventory request, independent of how many customers.
  const discovered = await discoverFollowerCollectors(apiKey);
  if (discovered.status !== 'ok')
    return NextResponse.json({ error: 'Falha na leitura dos coletores',
      providerStatus: discovered.status }, { status: 503, headers: HEADERS });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const summary = await prisma.$transaction(async tx => {
        const [refs, rows, drafts] = await Promise.all([
          tx.targetAccount.findMany({
            // Global scan with a hard ceiling; refuse partial decisions.
            select: { id: true, username: true, instagramAccountId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 1001,
          }),
          tx.activityLog.findMany({
            where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
            select: {
              id: true, instagramAccountId: true, targetUsername: true,
              createdAt: true, details: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: MAX_SOURCE_BINDING_LOGS + 1,
          }),
          tx.activityLog.findMany({
            where: { action: COLLECTOR_DRAFT_ACTION },
            select: { targetUsername: true, details: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: COLLECTOR_DRAFT_MAX_LOGS + 1,
          }),
        ]);
        if (refs.length > 1000 || rows.length > MAX_SOURCE_BINDING_LOGS ||
            drafts.length > COLLECTOR_DRAFT_MAX_LOGS)
          return null;

        const existing = resolveLatestAudienceBindings(rows);
        const revoked = disabledAudienceReferenceKeys(rows);
        const plan = planGlobalReadOnlyBindings(
          refs.map(ref => ({
            id: ref.id, username: ref.username,
            accountId: ref.instagramAccountId,
          })),
          discovered.collectors, existing, revoked, 3,
          reservedCollectorDraftAgents(drafts),
        );
        if (plan.candidates.length) {
          await tx.activityLog.createMany({
            data: plan.candidates.map(source => ({
              instagramAccountId: source.accountId,
              targetUsername: source.referenceId,
              action: AUDIENCE_SOURCE_BINDING_ACTION,
              success: true,
              details: JSON.stringify(makeAudienceSourceBinding(
                source.referenceId, source.collectorAgentId, true)),
            })),
          });
        }
        return {
          matched: plan.candidates.length,
          alreadyBound: plan.alreadyBound,
          unmatched: plan.unmatched,
          ambiguousOrInUse: plan.ambiguousOrInUse,
          ambiguousAcrossCustomers: plan.ambiguousAcrossCustomers,
          revoked: plan.revoked,
          deferred: plan.deferred,
          referencesExamined: plan.referencesExamined,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (!summary) return error('Capacidade de registro excedida', 409);
      return NextResponse.json({
        ...summary, agentsExamined: discovered.agentsExamined,
        origin: 'operator_approved_existing_collectors',
        createsCollectors: false, launchesCollectors: false,
        actionsEnabled: false, instagramActionsExecuted: 0,
      }, { headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      return error('Falha na associação de coletores', 503);
    }
  }
  return error('Conflito ao atualizar vínculos', 503);
}
