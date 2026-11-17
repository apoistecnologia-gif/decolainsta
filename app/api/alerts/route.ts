export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const accounts = await prisma.instagramAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const accountIds = accounts.map((a: any) => a?.id).filter(Boolean);

  const alerts = await prisma.alert.findMany({
    where: { instagramAccountId: { in: accountIds } },
    include: { instagramAccount: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json(alerts);
}

export async function PATCH(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const alertId = body?.alertId;
  if (typeof alertId !== 'string' || !alertId.trim() || alertId.length > 128) {
    return NextResponse.json({ error: 'ID do alerta inválido' }, { status: 400 });
  }
  const changed = await prisma.alert.updateMany({
    where: { id: alertId, instagramAccount: { userId } },
    data: { read: true },
  });
  if (!changed.count) return NextResponse.json({ error: 'Alerta não encontrado' }, { status: 404 });
  return NextResponse.json({ success: true });
}
