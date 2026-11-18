export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { connectedAccount } from '@/lib/instagram/accounts';
import { getProfile } from '@/lib/instagram/meta';
import {
  AUTOMATIC_SYNC_BATCH_LIMIT,
  AUTOMATIC_SYNC_INTERVAL_MS,
  prepareAutomaticSnapshot,
} from '@/lib/instagram/automatic-sync';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Fail closed on missing, empty or weak secrets. Never accept the literal "Bearer undefined".
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Invoked by Vercel Cron on production only, after explicit environment opt-in. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  if (process.env.DECOLAINSTA_AUTO_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false, updated: 0, failed: 0, realFollows: 0, realUnfollows: 0 });
  }

  try {
    const now = new Date();
    const threshold = new Date(now.getTime() - AUTOMATIC_SYNC_INTERVAL_MS);
    // Connections are opt-in via Meta OAuth. Do not activate the simulated follow engine.
    const accounts = await prisma.instagramAccount.findMany({
      where: {
        instagramUserId: { not: null },
        encryptedAccessToken: { not: null },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: threshold } }],
      },
      select: {
        id: true, userId: true, instagramUserId: true,
        lastSyncedAt: true, profileFollowersCount: true,
      },
      orderBy: [{ lastSyncedAt: 'asc' }, { id: 'asc' }],
      take: AUTOMATIC_SYNC_BATCH_LIMIT,
    });

    const results = await Promise.all(accounts.map(async (account): Promise<'updated' | 'skipped' | 'failed'> => {
      try {
        const connection = await connectedAccount(account.id, account.userId);
        if (!connection || !account.instagramUserId) return 'skipped';
        const profile = await getProfile(connection.token, account.instagramUserId);
        if (profile.id !== account.instagramUserId) return 'failed';

        const snapshot = prepareAutomaticSnapshot(profile, account.profileFollowersCount, now);
        // Conditional update prevents an older cron response overwriting a newer manual sync.
        const updated = await prisma.$transaction(async (tx) => {
          const result = await tx.instagramAccount.updateMany({
            where: { id: account.id, lastSyncedAt: account.lastSyncedAt },
            data: snapshot.update,
          });
          if (result.count === 1 && snapshot.measurement) {
            await tx.activityLog.create({
              data: {
                instagramAccountId: account.id,
                action: 'followers_snapshot',
                details: JSON.stringify({ ...snapshot.measurement, observedAt: now.toISOString(), scheduled: true }),
                success: true,
              },
            });
          }
          return result.count;
        });
        return updated === 1 ? 'updated' : 'skipped';
      } catch {
        // Never expose encrypted tokens, account handles, provider messages or user IDs.
        return 'failed';
      }
    }));
    const count = (result: 'updated' | 'skipped' | 'failed') => results.filter(value => value === result).length;
    return NextResponse.json({
      enabled: true,
      source: 'meta_official_api',
      examined: accounts.length,
      updated: count('updated'),
      skipped: count('skipped'),
      failed: count('failed'),
      realFollows: 0,
      realUnfollows: 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Falha na sincronização programada' }, { status: 500 });
  }
}
