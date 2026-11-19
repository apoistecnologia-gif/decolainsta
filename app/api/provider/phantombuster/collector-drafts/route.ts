export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  createUnconfiguredCollectorDraft, findExistingCollectorDraft,
  prepareCollectorDraft,
} from '@/lib/providers/phantombuster-collector-drafts';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  disabledAudienceReferenceKeys, resolveLatestAudienceBindings,
} from '@/lib/reference-audience-source-registry';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
  collectorDraftAlreadyAttempted, makeCollectorDraftEvent,
} from '@/lib/reference-collector-draft-events';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const BAD = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: HEADERS });

/**
 * Internal Preview-only draft provisioning.
 * 'plan' is local read-only. 'create-next-draft' requires ANOTHER disabled-by-default
 * server flag and explicit admin confirmation. No customer sees agent IDs.
 * No launch, Instagram cookies, input arguments, schedule or account actions.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview') return BAD('Somente no Preview', 403);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return BAD('Não autorizado', 401);
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (user?.role !== 'admin') return BAD('Acesso restrito', 403);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return BAD('Origem inválida', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return BAD('Formato inválido', 415);
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 250) return BAD('Parâmetros inválidos', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return BAD('Parâmetros inválidos', 400);
  const body = parsed as Record<string, unknown>;
  const operation = body.operation;
  if (Object.keys(body).some(k => ![
    'operation', 'accountId', 'confirmCreateUnconfiguredDraft',
  ].includes(k)) ||
      (operation !== 'plan' && operation !== 'create-next-draft') ||
      typeof body.accountId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.accountId) ||
      (operation === 'plan' && body.confirmCreateUnconfiguredDraft !== undefined) ||
      (operation === 'create-next-draft' &&
        body.confirmCreateUnconfiguredDraft !== true))
    return BAD('Parâmetros inválidos', 400);

  const accountId = body.accountId as string;
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId }, select: { id: true },
  });
  if (!account) return BAD('Conta não encontrada', 404);

  const references = await prisma.targetAccount.findMany({
    where: { instagramAccountId: account.id },
    select: { id: true, username: true }, take: 101,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (references.length > 100)
    return BAD('Limite de referências do Preview excedido', 409);

  // Global registry checks prevent one provider agent from crossing tenants.
  const [bindings, attempts] = await Promise.all([
    prisma.activityLog.findMany({
      where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
      select: {
        id: true, instagramAccountId: true, targetUsername: true,
        details: true, createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_SOURCE_BINDING_LOGS + 1,
    }),
    prisma.activityLog.findMany({
      where: { instagramAccountId: accountId, action: COLLECTOR_DRAFT_ACTION },
      select: { targetUsername: true, details: true },
      take: COLLECTOR_DRAFT_MAX_LOGS + 1,
    }),
  ]);
  if (bindings.length > MAX_SOURCE_BINDING_LOGS ||
      attempts.length > COLLECTOR_DRAFT_MAX_LOGS)
    return BAD('Registro de provisionamento excedeu o limite', 409);

  const existing = resolveLatestAudienceBindings(bindings);
  const suppressed = disabledAudienceReferenceKeys(bindings);
  const assigned = new Set(existing.filter(item => item.accountId === accountId)
    .map(item => item.referenceId));
  const prior = new Set(attempts.map(row => row.targetUsername));
  const eligible = references.filter(ref =>
    !assigned.has(ref.id) && !prior.has(ref.id) &&
    !suppressed.has(accountId + ':' + ref.id) &&
    prepareCollectorDraft(accountId, ref.id, ref.username));
  if (operation === 'plan') {
    return NextResponse.json({
      references: references.length,
      alreadyBound: references.filter(ref => assigned.has(ref.id)).length,
      previousDraftAttempts: references.filter(ref => prior.has(ref.id)).length,
      optedOut: references.filter(ref =>
        suppressed.has(accountId + ':' + ref.id)).length,
      eligibleDrafts: eligible.length,
      // No external operation was performed.
      draftCreationEnabled: process.env.PHANTOMBUSTER_DRAFT_CREATION_ENABLED === 'yes',
      providerRequestsMade: 0, instagramActionsExecuted: 0,
      requiresProviderSetup: true,
    }, { headers: HEADERS });
  }

  // An actual draft would consume a PhantomBuster slot, so writing is
  // INERT unless the operator deliberately enables this separate flag.
  if (process.env.PHANTOMBUSTER_DRAFT_CREATION_ENABLED !== 'yes')
    return BAD('Criação externa de rascunhos não autorizada', 403);
  // Pick the first eligible saved reference; admins do not type agent IDs
  // or choose one reference manually. One slot request per explicit action.
  const ref = eligible[0];
  if (!ref) return BAD('Nenhuma referência elegível para rascunho', 409);
  const draft = prepareCollectorDraft(accountId, ref.id, ref.username);
  if (!draft) return BAD('Referência inválida', 400);
  if (assigned.has(ref.id) || prior.has(ref.id) ||
      suppressed.has(accountId + ':' + ref.id))
    return BAD('Referência já vinculada, tentada ou revogada', 409);
  const key = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(key))
    return BAD('Chave do provedor não configurada', 409);

  let claimId: string | null = null;
  for (let retry = 0; retry < 3; retry++) {
    try {
      const outcome = await prisma.$transaction(async tx => {
        const [latestBinding, latestClaim, stillRegistered] = await Promise.all([
          tx.activityLog.findFirst({
            where: { instagramAccountId: accountId,
              targetUsername: ref.id, action: AUDIENCE_SOURCE_BINDING_ACTION },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { details: true },
          }),
          tx.activityLog.findMany({
            where: { instagramAccountId: accountId,
              targetUsername: ref.id, action: COLLECTOR_DRAFT_ACTION },
            select: { targetUsername: true, details: true }, take: 1,
          }),
          tx.targetAccount.findFirst({
            where: { id: ref.id, instagramAccountId: accountId, username: ref.username },
            select: { id: true },
          }),
        ]);
        // Also honor previously loaded global and account-local checks.
        if (!stillRegistered || latestBinding ||
            collectorDraftAlreadyAttempted(latestClaim, ref.id))
          return null;
        const record = makeCollectorDraftEvent(ref.id, 'claimed');
        if (!record) throw new Error('invalid-claim');
        const log = await tx.activityLog.create({
          data: { instagramAccountId: accountId, targetUsername: ref.id,
            action: COLLECTOR_DRAFT_ACTION, success: false,
            details: JSON.stringify(record) }, select: { id: true },
        });
        return log.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      claimId = outcome;
      break;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && retry < 2) continue;
      return BAD('Conflito ao reservar rascunho', 503);
    }
  }
  if (!claimId) return BAD('Provisionamento anteriormente iniciado', 409);

  let finalState: 'created' | 'existing-draft' | 'unconfirmed' |
    'capacity-reached' | 'rejected' = 'unconfirmed';
  let agentId: string | null = null;
  // Never retry after uncertain external outcome. The claim remains durable.
  const located = await findExistingCollectorDraft(key, draft);
  if (located.status === 'found') {
    finalState = 'existing-draft';
    agentId = located.agentId;
  } else if (located.status === 'not-found') {
    const created = await createUnconfiguredCollectorDraft(key, draft);
    if (created.status === 'created') {
      finalState = 'created'; agentId = created.agentId;
    } else if (created.status === 'capacity-reached') {
      finalState = 'capacity-reached';
    } else if (created.status === 'rejected') {
      finalState = 'rejected';
    }
  }
  const event = makeCollectorDraftEvent(ref.id, finalState, agentId);
  if (event) await prisma.activityLog.update({
    where: { id: claimId },
    data: { details: JSON.stringify(event),
      success: finalState === 'created' || finalState === 'existing-draft' },
  }).catch(() => undefined);
  return NextResponse.json({
    state: finalState,
    requiresManualProviderSetup: true,
    associatedWithReference: false,
    automaticallyScheduled: false,
    instagramActionsExecuted: 0,
  }, { headers: HEADERS });
}
