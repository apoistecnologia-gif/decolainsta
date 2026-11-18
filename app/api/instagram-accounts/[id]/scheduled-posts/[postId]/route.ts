export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const { id, postId } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId }, select: { id: true } });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
  try {
    // A processing or published item cannot be cancelled: the Meta call might already have happened.
    const result = await prisma.scheduledInstagramPost.updateMany({
      where: { id: postId, instagramAccountId: id, status: 'queued' },
      data: { status: 'cancelled' },
    });
    if (result.count !== 1) {
      return NextResponse.json({ error: 'Publicação não encontrada ou já em processamento' }, { status: 409 });
    }
    return NextResponse.json({ cancelled: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível cancelar o agendamento' }, { status: 500 });
  }
}
