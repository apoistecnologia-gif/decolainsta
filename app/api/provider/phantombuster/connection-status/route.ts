export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { checkPhantomBusterWorkspace } from '@/lib/providers/phantombuster';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { loadActiveAudienceSources } from '@/lib/server/reference-audience-source-store';
import { inspectConfiguredFollowerCollector } from '@/lib/providers/phantombuster-collector-discovery';
import { AUDIENCE_REFRESH_ACTION } from '@/lib/reference-audience-refresh';
import {
  lastReadStatusFromDetails, presentCollectorReadHealth,
  type CollectorMetadataCheck,
} from '@/lib/reference-audience-last-read';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/** Real GET to the provider, scoped to the signed-in customer's account.
 * No API key on the client, no provider arguments or global inventory exposed.
 * No collector launch, Instagram access or database mutation.
 */
export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview')
    return NextResponse.json({ error: 'Disponível apenas no Preview' },
      { status: 403, headers: HEADERS });
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId)
    return NextResponse.json({ error: 'Não autorizado' },
      { status: 401, headers: HEADERS });
  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId || !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))
    return NextResponse.json({ error: 'Conta inválida' },
      { status: 400, headers: HEADERS });
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { id: true },
  });
  if (!account)
    return NextResponse.json({ error: 'Conta não encontrada' },
      { status: 404, headers: HEADERS });

  const references = await prisma.targetAccount.count({
    where: { instagramAccountId: account.id },
  });
  const sources = await loadActiveAudienceSources(account.id);
  const configuredKey = isConfiguredPhantomBusterKey(process.env.PHANTOMBUSTER_API_KEY);
  const readsEnabled = process.env.PHANTOMBUSTER_READONLY_ENABLED === 'yes' &&
    process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED === 'yes';
  const status = !configuredKey ? 'not-configured' : !readsEnabled ? 'disabled'
    : (await checkPhantomBusterWorkspace(process.env.PHANTOMBUSTER_API_KEY!)).status;
  const isConnected = status === 'verified';

  // The last read attempt is scoped to the account AND currently bound refs;
  // its details contain only internal status codes, never raw provider data.
  const sourceIds = sources.map(source => source.referenceId);
  const lastAttempt = sourceIds.length ? await prisma.activityLog.findFirst({
    where: {
      instagramAccountId: account.id,
      targetUsername: { in: sourceIds },
      action: AUDIENCE_REFRESH_ACTION,
    },
    select: { createdAt: true, details: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }) : null;
  const lastReadStatus = lastReadStatusFromDetails(lastAttempt?.details ?? null);

  // Workspace authentication does NOT prove that a particular collector is
  // accessible or still targets its original reference. Inspect at most three
  // account-owned bindings in this user-triggered diagnostic, with NO launches.
  let collectorCheck: CollectorMetadataCheck = 'not-checked';
  if (isConnected && sources.length) {
    const bound = sources.slice(0, 3);
    const referencesToCheck = await prisma.targetAccount.findMany({
      where: { instagramAccountId: account.id, id: { in: bound.map(s => s.referenceId) } },
      select: { id: true, username: true },
    });
    const usernameById = new Map(referencesToCheck.map(r => [r.id, r.username]));
    const checks: CollectorMetadataCheck[] = [];
    for (const source of bound) {
      const username = usernameById.get(source.referenceId);
      checks.push(username ? await inspectConfiguredFollowerCollector(
        process.env.PHANTOMBUSTER_API_KEY!, source.collectorAgentId, username)
        : 'mismatch');
    }
    const problems: CollectorMetadataCheck[] = [
      'invalid-key', 'rate-limited', 'not-found', 'mismatch', 'unavailable',
    ];
    collectorCheck = problems.find(problem => checks.includes(problem)) ??
      (sources.length > 3 ? 'not-checked' : 'matched');
  }

  return NextResponse.json({
    status,
    providerReached: isConnected,
    keyStoredOnServer: configuredKey,
    readOnlyEnabled: readsEnabled,
    references,
    linkedCollectors: sources.length,
    waitingForCollectors: Math.max(0, references - sources.length),
    configuredToReadCompletedResults: isConnected && readsEnabled && sources.length > 0 && collectorCheck === 'matched',
    collectorCheck,
    lastReadStatus,
    lastReadAt: lastAttempt?.createdAt.toISOString() ?? null,
    readHealth: presentCollectorReadHealth(lastReadStatus, collectorCheck),
    collectionVerifiedByMeta: false,
    anyCollectorLaunched: false,
    instagramActionsExecuted: 0,
  }, { headers: HEADERS });
}
