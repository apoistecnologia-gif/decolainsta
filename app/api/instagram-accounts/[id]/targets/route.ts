export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { cleanUsername } from '@/lib/instagram/validation';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  const targets = await prisma.targetAccount.findMany({
    where: { instagramAccountId: id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(targets);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  const body = await req.json();
  const { username, niche } = body ?? {};

  if (!username) {
    return NextResponse.json({ error: 'Username é obrigatório' }, { status: 400 });
  }

  const usernameClean = cleanUsername(username);
  if (!usernameClean) return NextResponse.json({ error: 'Nome de usuário inválido' }, { status: 400 });

  const existing = await prisma.targetAccount.findUnique({
    where: { instagramAccountId_username: { instagramAccountId: id, username: usernameClean } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Esta conta-alvo já está cadastrada' }, { status: 409 });
  }

  const target = await prisma.targetAccount.create({
    data: {
      instagramAccountId: id,
      username: usernameClean,
      // Register without activating existing social-action or collection flags.
      // Read-only collector binding requires separate operator approval.
      niche: niche || 'geral',
      enabled: false,
    },
  });

  return NextResponse.json(target, { status: 201 });
}
