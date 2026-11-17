export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const { id, itemId } = await params;
  const item = await prisma.whitelist.findFirst({ where: { id: itemId, instagramAccountId: id, instagramAccount: { userId } } });
  if (!item) return NextResponse.json({ error: 'Item não encontrado' }, { status: 404 });
  await prisma.whitelist.delete({ where: { id: itemId } });
  return NextResponse.json({ success: true });
}
