export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

async function verify(id: string, targetId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return 401;
  const target = await prisma.targetAccount.findFirst({ where: { id: targetId, instagramAccountId: id, instagramAccount: { userId } } });
  return target ? 200 : 404;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { id, targetId } = await params;
  const status = await verify(id, targetId);
  if (status !== 200) return NextResponse.json({ error: 'Não autorizado ou alvo não encontrado' }, { status });
  const { enabled, niche, ...other } = await req.json().catch(() => ({}));
  if (Object.keys(other).length || (enabled !== undefined && typeof enabled !== 'boolean') || (niche !== undefined && (typeof niche !== 'string' || niche.length > 100))) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const updated = await prisma.targetAccount.update({
    where: { id: targetId }, data: { ...(enabled !== undefined && { enabled }), ...(niche !== undefined && { niche }) },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { id, targetId } = await params;
  const status = await verify(id, targetId);
  if (status !== 200) return NextResponse.json({ error: 'Não autorizado ou alvo não encontrado' }, { status });
  await prisma.targetAccount.delete({ where: { id: targetId } });
  return NextResponse.json({ success: true });
}
