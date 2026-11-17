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

  const whitelist = await prisma.whitelist.findMany({
    where: { instagramAccountId: id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(whitelist);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  const body = await req.json();
  const { username } = body ?? {};
  if (!username) return NextResponse.json({ error: 'Username obrigatório' }, { status: 400 });

  const usernameClean = cleanUsername(username);
  if (!usernameClean) return NextResponse.json({ error: 'Nome de usuário inválido' }, { status: 400 });

  const item = await prisma.whitelist.upsert({
    where: { instagramAccountId_username: { instagramAccountId: id, username: usernameClean } },
    update: {},
    create: { instagramAccountId: id, username: usernameClean },
  });

  return NextResponse.json(item, { status: 201 });
}
