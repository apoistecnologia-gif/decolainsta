export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { cleanUsername } from '@/lib/instagram/validation';
import {
  MANUAL_SOURCE_PREFIX,
  COLLECTOR_SOURCE_PREFIX,
  REFERENCE_ACTIONS,
  referenceFromSource,
  referenceProvenance,
  referenceSource,
  reviewIsDue,
  reviewTime,
} from '@/lib/reference-workflow';

type Context = { accountId: string; userId: string };

async function authorizedContext(accountId: unknown): Promise<Context | { error: 'invalid' | 'unauthorized' | 'not-found' }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: 'unauthorized' };
  if (typeof accountId !== 'string' || accountId.length > 100 || accountId.length < 1) return { error: 'invalid' };
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  if (!account) return { error: 'not-found' };
  return { accountId, userId };
}

function rejectContext(ctx: Awaited<ReturnType<typeof authorizedContext>>) {
  if (!('error' in ctx)) return null;
  if (ctx.error === 'unauthorized') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (ctx.error === 'invalid') return NextResponse.json({ error: 'Conta inválida' }, { status: 400 });
  return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
}

export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get('accountId');
  const ctx = await authorizedContext(accountId);
  const denied = rejectContext(ctx);
  if (denied) return denied;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const [account, references, leads, protectedUsers] = await Promise.all([
    prisma.instagramAccount.findUnique({ where: { id: ctx.accountId }, select: { id: true, username: true, instagramUserId: true } }),
    prisma.targetAccount.findMany({
      where: { instagramAccountId: ctx.accountId }, select: { id: true, username: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 100,
    }),
    prisma.followAction.findMany({
      where: {
        instagramAccountId: ctx.accountId,
        isDryRun: false,
        OR: [
          { sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
          { sourceTarget: { startsWith: COLLECTOR_SOURCE_PREFIX } },
        ],
        action: { in: [...REFERENCE_ACTIONS] },
      },
      select: {
        id: true, action: true, targetUsername: true, sourceTarget: true, followedAt: true,
        followedBack: true, unfollowedAt: true, unfollowScheduledAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' }, take: 500,
    }),
    prisma.whitelist.findMany({ where: { instagramAccountId: ctx.accountId }, select: { username: true } }),
  ]);
  const whitelisted = new Set(protectedUsers.map(entry => entry.username));
  const now = new Date();
  return NextResponse.json({
    account: account ? { id: account.id, username: account.username, connected: !!account.instagramUserId } : null,
    references,
    leads: leads.map(lead => ({
      id: lead.id,
      username: lead.targetUsername,
      reference: referenceFromSource(lead.sourceTarget),
      provenance: referenceProvenance(lead.sourceTarget),
      status: lead.action,
      followedAt: lead.followedAt,
      followedBack: lead.followedBack,
      unfollowedAt: lead.unfollowedAt,
      reviewAt: lead.unfollowScheduledAt,
      due: reviewIsDue(lead.action, lead.followedBack, lead.unfollowScheduledAt, now),
      protected: whitelisted.has(lead.targetUsername),
      createdAt: lead.createdAt,
    })),
    source: 'user_reported_not_meta_verified',
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const operation = input.operation;
  const allowed = ['accountId', 'operation', 'referenceId', 'username', 'leadId', 'hours'];
  if (Object.keys(input).some(key => !allowed.includes(key)) ||
      typeof input.accountId !== 'string' || typeof operation !== 'string') {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const ctx = await authorizedContext(input.accountId);
  const denied = rejectContext(ctx);
  if (denied) return denied;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  if (operation === 'add-lead') {
    const username = cleanUsername(input.username);
    if (!username || typeof input.referenceId !== 'string' || input.referenceId.length > 100) {
      return NextResponse.json({ error: 'Referência ou usuário inválido' }, { status: 400 });
    }
    const [reference, owner, count, alreadyExists] = await Promise.all([
      prisma.targetAccount.findFirst({ where: { id: input.referenceId, instagramAccountId: ctx.accountId } }),
      prisma.instagramAccount.findUnique({ where: { id: ctx.accountId }, select: { username: true } }),
      prisma.followAction.count({
        where: {
          instagramAccountId: ctx.accountId,
          OR: [
            { sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
            { sourceTarget: { startsWith: COLLECTOR_SOURCE_PREFIX } },
          ],
          action: { in: [...REFERENCE_ACTIONS] }, isDryRun: false,
        },
      }),
      prisma.followAction.findFirst({
        where: {
          instagramAccountId: ctx.accountId, targetUsername: username,
          OR: [
            { sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
            { sourceTarget: { startsWith: COLLECTOR_SOURCE_PREFIX } },
          ],
          action: { in: [...REFERENCE_ACTIONS] }, isDryRun: false,
        },
      }),
    ]);
    if (!reference || !owner) return NextResponse.json({ error: 'Referência não encontrada' }, { status: 404 });
    if (username === reference.username || username === owner.username) {
      return NextResponse.json({ error: 'A pessoa indicada deve ser diferente da conta e da referência' }, { status: 400 });
    }
    if (alreadyExists) return NextResponse.json({ error: 'Este perfil já está registrado neste acompanhamento' }, { status: 409 });
    if (count >= 500) return NextResponse.json({ error: 'Limite de 500 registros manuais por conta' }, { status: 409 });
    const lead = await prisma.followAction.create({
      data: {
        instagramAccountId: ctx.accountId, targetUsername: username,
        sourceTarget: referenceSource(reference.username), action: 'reference_candidate',
        isDryRun: false, followedBack: false,
      },
    });
    return NextResponse.json({ id: lead.id, status: lead.action, source: 'user_reported_not_meta_verified' }, { status: 201 });
  }

  if (typeof input.leadId !== 'string' || input.leadId.length < 1 || input.leadId.length > 100) {
    return NextResponse.json({ error: 'Registro inválido' }, { status: 400 });
  }

  const where = {
    id: input.leadId, instagramAccountId: ctx.accountId,
    isDryRun: false,
    OR: [
      { sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
      { sourceTarget: { startsWith: COLLECTOR_SOURCE_PREFIX } },
    ],
  };
  const now = new Date();

  if (operation === 'confirm-follow') {
    const reviewAt = reviewTime(now, input.hours);
    if (!reviewAt) return NextResponse.json({ error: 'Escolha 24 ou 72 horas' }, { status: 400 });
    const updated = await prisma.followAction.updateMany({
      where: { ...where, action: 'reference_candidate' },
      data: { action: 'reference_followed', followedAt: now, unfollowScheduledAt: reviewAt },
    });
    return updated.count === 1
      ? NextResponse.json({ success: true, reviewAt, source: 'user_reported_not_meta_verified' })
      : NextResponse.json({ error: 'Este registro não está disponível para confirmar follow' }, { status: 409 });
  }

  if (operation === 'confirm-followback') {
    const updated = await prisma.followAction.updateMany({
      where: { ...where, action: 'reference_followed', followedBack: false },
      data: { followedBack: true, unfollowScheduledAt: null },
    });
    return updated.count === 1
      ? NextResponse.json({ success: true, source: 'user_reported_not_meta_verified' })
      : NextResponse.json({ error: 'Não foi possível confirmar o follow-back' }, { status: 409 });
  }

  if (operation === 'keep-following') {
    const updated = await prisma.followAction.updateMany({
      where: { ...where, action: 'reference_followed' },
      data: { action: 'reference_kept', unfollowScheduledAt: null },
    });
    return updated.count === 1
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Registro não disponível' }, { status: 409 });
  }

  if (operation === 'confirm-unfollow') {
    // The due date is a reminder, not an automated action. Respect manual protection.
    const current = await prisma.followAction.findFirst({
      where: { ...where, action: 'reference_followed', followedBack: false, unfollowScheduledAt: { lte: now } },
      select: { targetUsername: true },
    });
    if (!current) return NextResponse.json({ error: 'O prazo de 24/72 horas não chegou ou o perfil foi protegido' }, { status: 409 });
    const protectedUser = await prisma.whitelist.findUnique({
      where: { instagramAccountId_username: { instagramAccountId: ctx.accountId, username: current.targetUsername } },
    });
    if (protectedUser) return NextResponse.json({ error: 'Perfil protegido na lista de exclusões' }, { status: 409 });
    const updated = await prisma.followAction.updateMany({
      where: { ...where, action: 'reference_followed', followedBack: false, unfollowScheduledAt: { lte: now } },
      data: { action: 'reference_unfollowed', unfollowedAt: now },
    });
    return updated.count === 1
      ? NextResponse.json({ success: true, source: 'user_reported_not_meta_verified' })
      : NextResponse.json({ error: 'Registro alterado; atualize a tela' }, { status: 409 });
  }

  if (operation === 'discard-candidate') {
    const removed = await prisma.followAction.deleteMany({ where: { ...where, action: 'reference_candidate' } });
    return removed.count === 1
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: 'Somente perfis ainda não acompanhados podem ser excluídos' }, { status: 409 });
  }

  return NextResponse.json({ error: 'Operação não permitida' }, { status: 400 });
}
