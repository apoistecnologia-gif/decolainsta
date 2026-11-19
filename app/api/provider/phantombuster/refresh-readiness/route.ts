export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AUDIENCE_REFRESH_ACTION } from '@/lib/reference-audience-refresh';
import {
  evaluateAudienceReadiness, isConfiguredPhantomBusterKey,
} from '@/lib/reference-audience-readiness';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Protected diagnostics for the owner. No external request, collector launch,
 * API key disclosure, Instagram operation, or DB mutation.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' },
    { status: 401, headers: HEADERS });

  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId || !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))
    return NextResponse.json({ error: 'Conta inválida' },
      { status: 400, headers: HEADERS });

  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' },
    { status: 404, headers: HEADERS });

  const [references, lastAttempt, lastSuccessfulRead] = await Promise.all([
    prisma.targetAccount.findMany({
      where: { instagramAccountId: account.id },
      select: { id: true, username: true, enabled: true },
      take: 101,
    }),
    prisma.activityLog.findFirst({
      where: { instagramAccountId: account.id, action: AUDIENCE_REFRESH_ACTION },
      select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
    prisma.activityLog.findFirst({
      where: { instagramAccountId: account.id, action: AUDIENCE_REFRESH_ACTION,
        success: true },
      select: { createdAt: true }, orderBy: { createdAt: 'desc' },
    }),
  ]);
  const readiness = evaluateAudienceReadiness(
    account.id, references,
    process.env.PHANTOMBUSTER_AUDIENCE_SOURCES_JSON,
    {
      authorizedPilot: account.username.toLowerCase() ===
        process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase(),
      readOnlyEnabled: process.env.PHANTOMBUSTER_READONLY_ENABLED === 'yes',
      pollingEnabled: process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED === 'yes',
      cronSecretConfigured: (process.env.CRON_SECRET?.length ?? 0) >= 32,
      providerKeyConfigured: isConfiguredPhantomBusterKey(process.env.PHANTOMBUSTER_API_KEY),
    },
  );
  return NextResponse.json({
    ...readiness,
    technicalReady: readiness.technicalReady && references.length <= 100,
    referencesTruncated: references.length > 100,
    lastAttemptAt: lastAttempt?.createdAt ?? null,
    lastCompletedReadAt: lastSuccessfulRead?.createdAt ?? null,
    referenceVerifiedByInstagram: false,
    testedAgainstLivePhantomBuster: false,
    instagramActionsExecuted: 0,
  }, { headers: HEADERS });
}
