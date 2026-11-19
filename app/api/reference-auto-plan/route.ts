export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { NextResponse } from 'next/server';
import { AUDIENCE_HISTORY_ACTION, parseAudienceSnapshot } from '@/lib/reference-audience-history';
import { planAudienceAutomatically } from '@/lib/reference-auto-plan';
import { REFERENCE_ACTIONS } from '@/lib/reference-workflow';

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Automatic mixing of usernames FROM SAVED HISTORY ONLY.
 * Absolutely no scraping, live social action, scheduling, credential access,
 * or writes. Data from external collectors is not verified by Meta.
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers: NO_STORE });
  const params = new URL(req.url).searchParams;
  const accountId = params.get('accountId');
  if (!accountId || accountId.length > 100)
    return NextResponse.json({ error: 'Conta inválida' }, { status: 400, headers: NO_STORE });
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404, headers: NO_STORE });
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase())
    return NextResponse.json({ error: 'Planejamento experimental indisponível' },
      { status: 403, headers: NO_STORE });

  const [references, snapshots, protectedProfiles, trackedProfiles] = await Promise.all([
    prisma.targetAccount.findMany({
      where: { instagramAccountId: account.id },
      select: { id: true, username: true },
      take: 100,
    }),
    prisma.activityLog.findMany({
      where: { instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION },
      select: { targetUsername: true, details: true }, orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.whitelist.findMany({
      where: { instagramAccountId: account.id }, select: { username: true }, take: 1000,
    }),
    prisma.followAction.findMany({
      where: { instagramAccountId: account.id, isDryRun: false,
        action: { in: [...REFERENCE_ACTIONS] } },
      select: { targetUsername: true }, take: 1000,
    }),
  ]);

  const pools = new Map(references.map(ref => [ref.id, {
    referenceId: ref.id, referenceUsername: ref.username.toLowerCase(), usernames: new Set<string>(),
  }]));
  for (const snapshotRow of snapshots) {
    const saved = parseAudienceSnapshot(snapshotRow.details);
    if (!saved) continue;
    const pool = pools.get(saved.referenceId);
    if (!pool || saved.referenceUsername !== pool.referenceUsername ||
        snapshotRow.targetUsername?.toLowerCase() !== pool.referenceUsername) continue;
    for (const username of saved.usernames) pool.usernames.add(username);
  }

  const exclusions = [
    account.username.toLowerCase(),
    ...protectedProfiles.map(x => x.username.toLowerCase()),
    ...trackedProfiles.map(x => x.targetUsername.toLowerCase()),
  ];
  const plan = planAudienceAutomatically(
    [...pools.values()].map(p => ({
      referenceId: p.referenceId, referenceUsername: p.referenceUsername,
      usernames: [...p.usernames],
    })),
    exclusions,
    `${account.id}:${new Date().toISOString().slice(0, 10)}`,
  );
  return NextResponse.json(plan, { headers: NO_STORE });
}
