export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { connectedAccount } from '@/lib/instagram/accounts';
import { isPublicImageUrl, publishPhoto } from '@/lib/instagram/meta';
import { instagramErrorResponse } from '@/lib/instagram/api-error';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const { imageUrl, caption = '' } = body;
  if (!isPublicImageUrl(imageUrl) || typeof caption !== 'string' || caption.length > 2200) {
    return NextResponse.json({ error: 'Informe uma URL HTTPS pública de imagem e uma legenda de até 2.200 caracteres' }, { status: 400 });
  }
  try {
    const { id } = await params;
    const connected = await connectedAccount(id, userId);
    if (!connected) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    const result = await publishPhoto(connected.token, connected.account.instagramUserId!, imageUrl, caption);
    await prisma.activityLog.create({
      data: { instagramAccountId: id, action: 'publish', details: `Publicação oficial do Instagram (ID ${result.id})`, success: true },
    });
    return NextResponse.json({ success: true, mediaId: result.id }, { status: 201 });
  } catch (error) { return instagramErrorResponse(error); }
}
