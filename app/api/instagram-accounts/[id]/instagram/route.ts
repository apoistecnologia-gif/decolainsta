export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { connectedAccount } from '@/lib/instagram/accounts';
import { getMedia, getProfile } from '@/lib/instagram/meta';
import { instagramErrorResponse } from '@/lib/instagram/api-error';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const { id } = await params;
    const connected = await connectedAccount(id, userId);
    if (!connected) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    const [profile, media] = await Promise.all([
      getProfile(connected.token), getMedia(connected.token, connected.account.instagramUserId!),
    ]);
    await prisma.instagramAccount.update({
      where: { id }, data: {
        profileFollowersCount: profile.followers_count ?? null,
        profileMediaCount: profile.media_count ?? null,
        lastSyncedAt: new Date(),
      },
    });
    return NextResponse.json({ profile, media: media.data || [], source: 'meta_official_api' });
  } catch (error) { return instagramErrorResponse(error); }
}
