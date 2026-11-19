export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AUDIENCE_HISTORY_ACTION, parseAudienceSnapshot } from '@/lib/reference-audience-history';
import {
  COLLECTOR_SOURCE_PREFIX, MANUAL_SOURCE_PREFIX, REFERENCE_ACTIONS,
  referenceCollectorSource,
} from '@/lib/reference-workflow';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const sourceFilters = [
  { sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
  { sourceTarget: { startsWith: COLLECTOR_SOURCE_PREFIX } },
];

/**
 * Explicitly promote ONE username from an already saved collector snapshot to a
 * tracking candidate. This does not call PhantomBuster, Instagram or any
 * follow/unfollow endpoint. The original unverified provenance remains visible.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers: HEADERS });
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin)
    return NextResponse.json({ error: 'Origem inválida' }, { status: 403, headers: HEADERS });
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415, headers: HEADERS });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 600)
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  const input = body as Record<string, unknown>;
  const allowed = ['accountId', 'referenceId', 'historyId', 'username', 'confirmAdd'];
  if (Object.keys(input).some(key => !allowed.includes(key)) ||
      input.confirmAdd !== true ||
      typeof input.accountId !== 'string' || !input.accountId || input.accountId.length > 100 ||
      typeof input.referenceId !== 'string' || !input.referenceId || input.referenceId.length > 100 ||
      typeof input.historyId !== 'string' || !input.historyId || input.historyId.length > 100 ||
      typeof input.username !== 'string' || !/^[a-z0-9._]{1,30}$/.test(input.username))
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400, headers: HEADERS });
  const username = input.username;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404, headers: HEADERS });
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase())
    return NextResponse.json({ error: 'Acompanhamento experimental indisponível' },
      { status: 403, headers: HEADERS });
  const reference = await prisma.targetAccount.findFirst({
    where: { id: input.referenceId, instagramAccountId: account.id },
    select: { id: true, username: true },
  });
  if (!reference) return NextResponse.json({ error: 'Referência não encontrada' },
    { status: 404, headers: HEADERS });
  if (username === account.username.toLowerCase() || username === reference.username.toLowerCase())
    return NextResponse.json({ error: 'Conta de teste e referência não podem ser candidatas' },
      { status: 400, headers: HEADERS });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const outcome = await prisma.$transaction(async tx => {
        const saved = await tx.activityLog.findFirst({
          where: {
            id: input.historyId, instagramAccountId: account.id,
            action: AUDIENCE_HISTORY_ACTION, targetUsername: reference.username,
          },
          select: { details: true },
        });
        const snapshot = parseAudienceSnapshot(saved?.details);
        if (!snapshot || snapshot.referenceId !== reference.id ||
            snapshot.referenceUsername !== reference.username.toLowerCase() ||
            !snapshot.usernames.includes(username))
          return { type: 'invalid-history' as const };

        const protectedUser = await tx.whitelist.findUnique({
          where: { instagramAccountId_username: { instagramAccountId: account.id, username } },
          select: { username: true },
        });
        if (protectedUser) return { type: 'protected' as const };

        const [count, existing] = await Promise.all([
          tx.followAction.count({
            where: {
              instagramAccountId: account.id, isDryRun: false,
              OR: sourceFilters, action: { in: [...REFERENCE_ACTIONS] },
            },
          }),
          tx.followAction.findFirst({
            where: {
              instagramAccountId: account.id, targetUsername: username,
              isDryRun: false, OR: sourceFilters, action: { in: [...REFERENCE_ACTIONS] },
            },
            select: { id: true },
          }),
        ]);
        if (existing) return { type: 'duplicate' as const };
        if (count >= 500) return { type: 'full' as const };
        const candidate = await tx.followAction.create({
          data: {
            instagramAccountId: account.id, targetUsername: username,
            sourceTarget: referenceCollectorSource(reference.username),
            action: 'reference_candidate', followedBack: false, isDryRun: false,
          },
          select: { id: true },
        });
        return { type: 'created' as const, id: candidate.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      if (outcome.type === 'invalid-history')
        return NextResponse.json({ error: 'Nome não encontrado no histórico salvo desta referência' },
          { status: 404, headers: HEADERS });
      if (outcome.type === 'protected')
        return NextResponse.json({ error: 'Perfil protegido na lista de exclusões' },
          { status: 409, headers: HEADERS });
      if (outcome.type === 'duplicate')
        return NextResponse.json({ error: 'Este perfil já está registrado no acompanhamento' },
          { status: 409, headers: HEADERS });
      if (outcome.type === 'full')
        return NextResponse.json({ error: 'Limite de 500 perfis no acompanhamento' },
          { status: 409, headers: HEADERS });
      return NextResponse.json({
        id: outcome.id, status: 'reference_candidate',
        provenance: 'operator_assigned_collector_result',
        referenceVerified: false, socialActionExecuted: false,
      }, { status: 201, headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2034' || attempt === 2)
        return NextResponse.json({ error: 'Não foi possível registrar este candidato' },
          { status: 503, headers: HEADERS });
    }
  }
  return NextResponse.json({ error: 'Conflito ao registrar candidato' },
    { status: 503, headers: HEADERS });
}
