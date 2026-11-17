export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  const url = new URL(req.url);
  const requested = Number(url.searchParams.get('take') || '50');
  const take = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 200)) : 50;

  const logs = await prisma.activityLog.findMany({
    where: { instagramAccountId: id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(take, 200),
  });

  return NextResponse.json(logs);
}
