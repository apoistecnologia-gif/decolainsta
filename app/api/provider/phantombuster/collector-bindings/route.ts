export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { verifyFollowerCollectorTemplate } from '@/lib/providers/phantombuster-collector-identity';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  makeAudienceSourceBinding, resolveLatestAudienceBindings,
} from '@/lib/reference-audience-source-registry';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Internal operator configuration, not a public customer action.
 * One shared PhantomBuster workspace is controlled by the DECOLA INSTA admin.
 * A template check blocks Auto Follow agents; it does not verify the target profile.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview')
    return NextResponse.json({ error: 'Disponível somente no Preview' },
      { status: 403, headers: HEADERS });

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers: HEADERS });
  const admin = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (admin?.role !== 'admin')
    return NextResponse.json({ error: 'Acesso restrito ao administrador' },
      { status: 403, headers: HEADERS });

  if (request.headers.get('origin') !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Origem inválida' },
      { status: 403, headers: HEADERS });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' },
      { status: 415, headers: HEADERS });
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 500)
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  let input: unknown;
  try { input = JSON.parse(raw) as unknown; } catch { input = null; }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  const body = input as Record<string, unknown>;
  const operation = body.operation;
  if (Object.keys(body).some(key => ![
    'accountId', 'referenceId', 'collectorAgentId', 'operation', 'confirmReadOnlyCollector',
  ].includes(key)) ||
      (operation !== 'bind' && operation !== 'unbind') ||
      typeof body.accountId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.accountId) ||
      typeof body.referenceId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.referenceId) ||
      (operation === 'bind' && (
        typeof body.collectorAgentId !== 'string' ||
        !/^\d{10,25}$/.test(body.collectorAgentId) ||
        body.confirmReadOnlyCollector !== true
      )) || (operation === 'unbind' && (
        body.collectorAgentId !== undefined ||
        body.confirmReadOnlyCollector !== undefined
      )))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });

  const accountId = body.accountId as string;
  const referenceId = body.referenceId as string;
  const agentId = operation === 'bind' ? body.collectorAgentId as string : null;

  const reference = await prisma.targetAccount.findFirst({
    where: { id: referenceId, instagramAccountId: accountId },
    select: { id: true, enabled: true },
  });
  if (!reference)
    return NextResponse.json({ error: 'Referência não pertence à conta indicada' },
      { status: 404, headers: HEADERS });
  if (operation === 'bind' && !reference.enabled)
    return NextResponse.json({ error: 'Referência desativada' },
      { status: 409, headers: HEADERS });

  if (operation === 'bind') {
    const apiKey = process.env.PHANTOMBUSTER_API_KEY;
    if (!isConfiguredPhantomBusterKey(apiKey))
      return NextResponse.json({ error: 'Integração não configurada' },
        { status: 409, headers: HEADERS });
    const identity = await verifyFollowerCollectorTemplate(apiKey, agentId!);
    if (identity !== 'verified-template')
      return NextResponse.json({ error: 'Agente não corresponde ao Instagram Follower Collector' },
        { status: 422, headers: HEADERS });
  }

  const binding = makeAudienceSourceBinding(referenceId, agentId, operation === 'bind');
  if (!binding) return NextResponse.json({ error: 'Vínculo inválido' },
    { status: 400, headers: HEADERS });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const outcome = await prisma.$transaction(async tx => {
        const rows = await tx.activityLog.findMany({
          where: { action: AUDIENCE_SOURCE_BINDING_ACTION },
          select: {
            id: true, instagramAccountId: true, targetUsername: true,
            details: true, createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_SOURCE_BINDING_LOGS + 1,
        });
        if (rows.length > MAX_SOURCE_BINDING_LOGS)
          return 'registry-capacity' as const;
        const current = resolveLatestAudienceBindings(rows);
        if (operation === 'bind' && current.some(s =>
          s.collectorAgentId === agentId &&
          (s.accountId !== accountId || s.referenceId !== referenceId)))
          return 'agent-in-use' as const;
        const existing = current.find(s => s.accountId === accountId &&
          s.referenceId === referenceId);
        if (operation === 'bind' && existing?.collectorAgentId === agentId)
          return 'unchanged' as const;
        if (operation === 'unbind' && !existing) return 'unchanged' as const;

        await tx.activityLog.create({
          data: {
            instagramAccountId: accountId,
            targetUsername: referenceId,
            action: AUDIENCE_SOURCE_BINDING_ACTION,
            success: true,
            details: JSON.stringify(binding),
          },
        });
        return operation === 'bind' ? 'bound' as const : 'unbound' as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({
        status: outcome, accountId, referenceId,
        collectorTypeVerified: operation === 'bind',
        referenceVerifiedByInstagram: false,
        instagramActionsExecuted: 0,
      }, { status: outcome === 'agent-in-use' || outcome === 'registry-capacity' ? 409 : 200,
        headers: HEADERS });
    } catch (error) {
      if ((error as {code?: string})?.code === 'P2034' && attempt < 2) continue;
      return NextResponse.json({ error: 'Não foi possível salvar o vínculo' },
        { status: 503, headers: HEADERS });
    }
  }
  return NextResponse.json({ error: 'Conflito ao vincular' },
    { status: 503, headers: HEADERS });
}
