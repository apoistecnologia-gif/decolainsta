export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { checkPhantomBusterWorkspace } from '@/lib/providers/phantombuster';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { loadActiveAudienceSources } from '@/lib/server/reference-audience-source-store';

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
  return NextResponse.json({
    status,
    providerReached: isConnected,
    keyStoredOnServer: configuredKey,
    readOnlyEnabled: readsEnabled,
    references,
    linkedCollectors: sources.length,
    waitingForCollectors: Math.max(0, references - sources.length),
    configuredToReadCompletedResults: isConnected && readsEnabled && sources.length > 0,
    collectionVerifiedByMeta: false,
    anyCollectorLaunched: false,
    instagramActionsExecuted: 0,
  }, { headers: HEADERS });
}
