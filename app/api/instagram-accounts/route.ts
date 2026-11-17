export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { publicInstagramAccount } from '@/lib/instagram/accounts';
import { cleanUsername } from '@/lib/instagram/validation';

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const accounts = await prisma.instagramAccount.findMany({
    where: { userId },
    include: { settings: true, _count: { select: { targetAccounts: true, followActions: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(accounts.map(publicInstagramAccount));
}

/** Legacy manual accounts are permitted only as explicitly marked demonstrations. */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const username = cleanUsername(body.username);
  if (!username || body.password || body.proxyUrl) {
    return NextResponse.json({ error: 'Não envie senha ou proxy. Conecte sua conta pela autorização oficial; cadastro manual é apenas demonstração.' }, { status: 400 });
  }
  try {
    const existing = await prisma.instagramAccount.findUnique({ where: { userId_username: { userId, username } } });
    if (existing) return NextResponse.json({ error: 'Conta já cadastrada' }, { status: 409 });
    const account = await prisma.instagramAccount.create({
      data: { userId, username, encryptedPassword: '', status: 'inactive', dryMode: true, settings: { create: {} } },
      include: { settings: true },
    });
    return NextResponse.json(publicInstagramAccount(account), { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível cadastrar a demonstração' }, { status: 500 });
  }
}
