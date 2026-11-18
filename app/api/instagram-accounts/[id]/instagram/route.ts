export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { connectedAccount } from '@/lib/instagram/accounts';
import { getMedia, getProfile } from '@/lib/instagram/meta';
import { instagramErrorResponse } from '@/lib/instagram/api-error';
import { measureFollowers } from '@/lib/instagram/growth-measurement';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    const { id } = await params;
    const connected = await connectedAccount(id, userId);
    if (!connected) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
    const [profile, media] = await Promise.all([
      getProfile(connected.token, connected.account.instagramUserId!), getMedia(connected.token, connected.account.instagramUserId!),
    ]);
    const measurement = measureFollowers(
      profile.followers_count, connected.account.profileFollowersCount,
    );
    const syncedAt = new Date();

    // Keep the last real count if the Meta response omits followers_count.
    // Account state and audit evidence are committed together.
    await prisma.$transaction(async tx => {
      await tx.instagramAccount.update({
        where: { id },
        data: {
          ...(measurement ? { profileFollowersCount: measurement.current } : {}),
          ...(typeof profile.media_count === 'number' && Number.isSafeInteger(profile.media_count) && profile.media_count >= 0
            ? { profileMediaCount: profile.media_count } : {}),
          lastSyncedAt: syncedAt,
        },
      });
      if (measurement) {
        await tx.activityLog.create({
          data: {
            instagramAccountId: id,
            action: 'followers_snapshot',
            details: JSON.stringify({ ...measurement, observedAt: syncedAt.toISOString() }),
            success: true,
          },
        });
      }
    });
    return NextResponse.json({
      profile,
      media: media.data || [],
      source: 'meta_official_api',
      followersMeasurement: measurement,
    });
  } catch (error) { return instagramErrorResponse(error); }
}
