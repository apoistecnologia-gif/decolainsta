import { prisma } from '@/lib/db';
import { connectedAccount } from '@/lib/instagram/accounts';
import { publishPhoto } from '@/lib/instagram/meta';

/** At most one publication attempt per daily invocation, for safe Hobby execution. */
export async function processScheduledPosts(): Promise<{ claimed: number; published: number; needsReview: number }> {
  const now = new Date();
  const due = await prisma.scheduledInstagramPost.findMany({
    where: { status: 'queued', scheduledFor: { lte: now } },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    include: { instagramAccount: { select: { userId: true } } },
    take: 1,
  });
  let claimed = 0;
  let published = 0;
  let needsReview = 0;

  for (const post of due) {
    // Atomic state claim. A duplicate Vercel invocation cannot publish the same queued post.
    const lock = await prisma.scheduledInstagramPost.updateMany({
      where: { id: post.id, status: 'queued', scheduledFor: { lte: now } },
      data: { status: 'processing', startedAt: new Date() },
    });
    if (lock.count !== 1) continue;
    claimed += 1;
    try {
      const connected = await connectedAccount(post.instagramAccountId, post.instagramAccount.userId);
      if (!connected || !connected.account.instagramUserId) {
        throw new Error('Conta Meta não conectada');
      }
      // Meta endpoint creates and validates a container before one publish request.
      // No automatic retry after an ambiguous network failure.
      const result = await publishPhoto(
        connected.token, connected.account.instagramUserId, post.imageUrl, post.caption
      );
      await prisma.$transaction(async tx => {
        await tx.scheduledInstagramPost.update({
          where: { id: post.id },
          data: { status: 'published', publishedAt: new Date(), publishedMediaId: result.id },
        });
        await tx.activityLog.create({
          data: {
            instagramAccountId: post.instagramAccountId,
            action: 'scheduled_publish',
            details: JSON.stringify({ postId: post.id, mediaId: result.id, source: 'meta_official_api' }),
            success: true,
          },
        });
      });
      published += 1;
    } catch {
      // Treat every uncertain outcome as needs_review. Never auto-retry a publish call.
      await prisma.scheduledInstagramPost.updateMany({
        where: { id: post.id, status: 'processing' },
        data: {
          status: 'needs_review',
          reviewNote: 'Resultado não confirmado; consulte o perfil Instagram antes de qualquer nova tentativa.',
        },
      });
      needsReview += 1;
    }
  }
  return { claimed, published, needsReview };
}
