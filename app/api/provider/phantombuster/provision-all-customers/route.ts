export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  prepareCollectorDraft, findExistingCollectorDraft, createUnconfiguredCollectorDraft,
} from '@/lib/providers/phantombuster-collector-drafts';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { planCollectorProvisioning } from '@/lib/reference-collector-provisioning';
import { sequentialCollectorReadiness } from '@/lib/reference-shared-collector-evidence';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  disabledAudienceReferenceKeys, resolveActiveAudienceSources,
} from '@/lib/reference-audience-source-registry';
import {
  COLLECTOR_DRAFT_ACTION, COLLECTOR_DRAFT_MAX_LOGS,
  collectorDraftAlreadyAttempted, makeCollectorDraftEvent,
} from '@/lib/reference-collector-draft-events';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const BAD = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status, headers: HEADERS });

/** Operator-only global intake. No account, username or agent ID is accepted
 * from the request; the earliest eligible reference is chosen from DB.
 * No Instagram credentials, automatic launches or social actions.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview')
    return BAD('Disponível apenas no Preview', 403);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return BAD('Não autorizado', 401);
  const user = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (user?.role !== 'admin')
    return BAD('Acesso restrito ao operador', 403);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return BAD('Origem inválida', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return BAD('Formato inválido', 415);
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 200) return BAD('Parâmetros inválidos', 400);
  let input: unknown;
  try { input = JSON.parse(raw) as unknown; } catch { input = null; }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return BAD('Parâmetros inválidos', 400);
  const body = input as Record<string, unknown>;
  const keys = Object.keys(body);
  const operation = body.operation;
  if ((operation !== 'plan' && operation !== 'create-next-draft') ||
      keys.some(k => !['operation','confirmCreateUnconfiguredDraft'].includes(k)) ||
      (operation === 'plan' && (keys.length !== 1 ||
        body.confirmCreateUnconfiguredDraft !== undefined)) ||
      (operation === 'create-next-draft' &&
        (keys.length !== 2 || body.confirmCreateUnconfiguredDraft !== true)))
    return BAD('Operação inválida', 400);

  // Local-only plan: no provider requests and no external writes.
  const readGlobal = async (tx: typeof prisma) => {
    const [references, bindings, drafts] = await Promise.all([
      tx.targetAccount.findMany({
        select: {
          id: true, username: true, instagramAccountId: true, createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1001,
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
        select: {
          instagramAccountId: true, targetUsername: true,
          createdAt: true, details: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: COLLECTOR_DRAFT_MAX_LOGS + 1,
      }),
    ]);
    if (references.length > 1000 || bindings.length > MAX_SOURCE_BINDING_LOGS ||
        drafts.length > COLLECTOR_DRAFT_MAX_LOGS) return null;

    return planCollectorProvisioning(
      references.map(r => ({
        id:r.id, username:r.username, accountId:r.instagramAccountId,
        createdAt:r.createdAt,
      })),
      resolveActiveAudienceSources(bindings),
      disabledAudienceReferenceKeys(bindings),
      drafts.map(d=>({
        accountId:d.instagramAccountId, referenceId:d.targetUsername,
        details:d.details, createdAt:d.createdAt,
      })),
    );
  };

  if (operation === 'plan') {
    const plan = await readGlobal(prisma).catch(() => null);
    if (!plan) return BAD('Fila muito grande ou indisponível', 503);
    return NextResponse.json({
      ...plan,
      // The operator sees counts, not private customers' usernames.
      next: plan.next !== null,
      // Informational only. Reusing an agent requires an exclusive run lease
      // and provider-verified per-run input. Neither is enabled here.
      sharedCollector: sequentialCollectorReadiness(plan.eligible),
      draftCreationEnabled: process.env.PHANTOMBUSTER_DRAFT_CREATION_ENABLED === 'yes',
      providerRequestsMade: 0,
      requiresProviderSetup: true,
      automaticallyScheduled: false,
      instagramActionsExecuted: 0,
    }, { headers: HEADERS });
  }

  // Writing to an external PhantomBuster workspace consumes a plan slot.
  // This operation MUST remain disabled unless explicitly enabled by operator.
  if (process.env.PHANTOMBUSTER_DRAFT_CREATION_ENABLED !== 'yes')
    return BAD('Criação externa de rascunhos não autorizada', 403);
  const key = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(key))
    return BAD('Chave do provedor não configurada', 409);

  let claimed: { id: string; accountId: string; referenceId: string;
    username: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      claimed = await prisma.$transaction(async tx => {
        // Re-read the global queue INSIDE the serializable transaction.
        // This prevents concurrent operator requests from selecting the same
        // customer/reference even if two browser tabs click simultaneously.
        const [references, bindings, drafts] = await Promise.all([
          tx.targetAccount.findMany({
            select: { id: true, username: true, instagramAccountId: true, createdAt: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1001,
          }),
          tx.activityLog.findMany({
            where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
            select: {
              id: true, instagramAccountId: true, targetUsername: true,
              details: true, createdAt: true,
            }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: MAX_SOURCE_BINDING_LOGS + 1,
          }),
          tx.activityLog.findMany({
            where: { action: COLLECTOR_DRAFT_ACTION },
            select: {
              targetUsername: true, instagramAccountId: true,
              details: true, createdAt: true,
            }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: COLLECTOR_DRAFT_MAX_LOGS + 1,
          }),
        ]);
        if (references.length > 1000 || bindings.length > MAX_SOURCE_BINDING_LOGS ||
            drafts.length > COLLECTOR_DRAFT_MAX_LOGS) return null;
        const plan = planCollectorProvisioning(
          references.map(r=>({
            id:r.id,username:r.username,accountId:r.instagramAccountId,
            createdAt:r.createdAt,
          })),
          resolveActiveAudienceSources(bindings),
          disabledAudienceReferenceKeys(bindings),
          drafts.map(d=>({
            accountId:d.instagramAccountId,referenceId:d.targetUsername,
            details:d.details,createdAt:d.createdAt,
          })),
        );
        const next = plan.next;
        if (!next || !prepareCollectorDraft(next.accountId,next.referenceId,next.username))
          return null;
        const previous = drafts.filter(d=>d.instagramAccountId===next.accountId &&
          d.targetUsername===next.referenceId);
        if (collectorDraftAlreadyAttempted(previous,next.referenceId)) return null;
        const event = makeCollectorDraftEvent(next.referenceId,'claimed');
        if (!event) return null;
        const log = await tx.activityLog.create({
          data: {
            instagramAccountId:next.accountId,targetUsername:next.referenceId,
            action:COLLECTOR_DRAFT_ACTION,success:false,
            details:JSON.stringify(event),
          },select:{id:true},
        });
        return {id:log.id,...next};
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (err) {
      if ((err as {code?: string})?.code==='P2034' && attempt<2) continue;
      return BAD('Conflito ao reservar preparação',503);
    }
  }
  if (!claimed) return BAD('Nenhuma referência elegível para nova preparação',409);
  const draft = prepareCollectorDraft(claimed.accountId,claimed.referenceId,claimed.username);
  if (!draft) return BAD('Preparação inválida',503);

  let state: 'created'|'existing-draft'|'capacity-reached'|'rejected'|'unconfirmed' =
    'unconfirmed';
  let agentId: string|null = null;
  // A successful remote create may return an uncertain response; it must not
  // be retried blindly. The durable event blocks a second attempt.
  const existing = await findExistingCollectorDraft(key,draft);
  if (existing.status === 'found') {
    state='existing-draft'; agentId=existing.agentId;
  } else if (existing.status === 'not-found') {
    const created = await createUnconfiguredCollectorDraft(key,draft);
    if (created.status === 'created') {
      state='created'; agentId=created.agentId;
    } else if (created.status === 'capacity-reached') state='capacity-reached';
    else if (created.status === 'rejected') state='rejected';
  }
  const event = makeCollectorDraftEvent(claimed.referenceId,state,agentId);
  if (event) {
    await prisma.activityLog.update({
      where:{id:claimed.id},
      data:{details:JSON.stringify(event),
        success:state==='created'||state==='existing-draft'},
    }).catch(()=>undefined);
  }
  return NextResponse.json({
    state,
    requiresManualProviderSetup:true,
    associatedWithReference:false,
    automaticallyScheduled:false,
    instagramActionsExecuted:0,
  },{headers:HEADERS});
}
