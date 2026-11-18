export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { validateScheduledPost } from '@/lib/instagram/scheduled-post';

type Params = { params: Promise<{ id: string }> };

async function ownerAccount(id: string, userId: string) {
  return prisma.instagramAccount.findFirst({
    where: { id, userId },
    select: { id: true, instagramUserId: true, encryptedAccessToken: true, tokenExpiresAt: true },
  });
}

export async function GET(_request: Request, { params }: Params) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const { id } = await params;
  const account = await ownerAccount(id, userId);
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
  const enabled = process.env.DECOLAINSTA_AUTO_PUBLISH_ENABLED === 'true';
  if (!enabled) return NextResponse.json({ enabled: false, posts: [] });
  try {
    const posts = await prisma.scheduledInstagramPost.findMany({
      where: { instagramAccountId: id },
      select: {
        id: true, imageUrl: true, caption: true, scheduledFor: true, status: true,
        createdAt: true, publishedAt: true, publishedMediaId: true, reviewNote: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return NextResponse.json({ enabled: true, posts });
  } catch {
    return NextResponse.json({ error: 'Fila ainda não disponível; verifique a migração do banco' }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: Params) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (process.env.DECOLAINSTA_AUTO_PUBLISH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Agendamento desativado até configuração e aprovação da produção' }, { status: 409 });
  }
  const { id } = await params;
  const account = await ownerAccount(id, userId);
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
  if (!account.instagramUserId || !account.encryptedAccessToken ||
      (account.tokenExpiresAt && account.tokenExpiresAt <= new Date())) {
    return NextResponse.json({ error: 'Conecte uma conta profissional autorizada pela Meta' }, { status: 409 });
  }
  const input = await request.json().catch(() => null);
  let draft;
  try {
    draft = validateScheduledPost(input);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Dados inválidos' }, { status: 400 });
  }
  try {
    const count = await prisma.scheduledInstagramPost.count({
      where: { instagramAccountId: id, status: { in: ['queued', 'processing'] } },
    });
    if (count >= 30) return NextResponse.json({ error: 'Limite de 30 publicações pendentes por conta' }, { status: 429 });
    const post = await prisma.scheduledInstagramPost.create({
      data: { instagramAccountId: id, imageUrl: draft.imageUrl, caption: draft.caption, scheduledFor: draft.scheduledFor },
      select: { id: true, status: true, scheduledFor: true },
    });
    return NextResponse.json(post, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar o agendamento' }, { status: 500 });
  }
}
