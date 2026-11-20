export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { loadActiveAudienceSources } from '@/lib/server/reference-audience-source-store';
import {
  COLLECTOR_DRAFT_ACTION, parseCollectorDraftEvent,
} from '@/lib/reference-collector-draft-events';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/** A customer's own references, not shared PhantomBuster workspace details.
 * This does not contact the provider or require an Instagram connection.
 */
export async function GET(request: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId)
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers: HEADERS });
  const accountId = new URL(request.url).searchParams.get('accountId');
  if (!accountId || !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))
    return NextResponse.json({ error: 'Conta inválida' }, { status: 400, headers: HEADERS });
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { id: true },
  });
  if (!account)
    return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404, headers: HEADERS });
  try {
    const [refs, bound, drafts] = await Promise.all([
      prisma.targetAccount.findMany({
        where: { instagramAccountId: account.id },
        select: { id: true }, take: 1001,
      }),
      loadActiveAudienceSources(account.id),
      prisma.activityLog.findMany({
        where: { instagramAccountId: account.id, action: COLLECTOR_DRAFT_ACTION },
        select: { targetUsername: true, details: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1001,
      }),
    ]);
    if (refs.length > 1000 || drafts.length > 1000)
      return NextResponse.json({ error: 'Limite de referências excedido' },
        { status: 409, headers: HEADERS });
    const assigned = new Set(bound.map(b => b.referenceId));
    const lastDraftByRef = new Map<string, ReturnType<typeof parseCollectorDraftEvent>>();
    for (const row of drafts) {
      if (row.targetUsername && !lastDraftByRef.has(row.targetUsername))
        lastDraftByRef.set(row.targetUsername, parseCollectorDraftEvent(row.details));
    }
    const statuses = refs.map(ref => {
      const draft = lastDraftByRef.get(ref.id);
      const state = assigned.has(ref.id) ? 'source-linked'
        : !lastDraftByRef.has(ref.id) ? 'awaiting-collector'
        : draft?.state === 'created' || draft?.state === 'existing-draft'
          ? 'awaiting-provider-setup'
        : draft?.state === 'capacity-reached' ? 'awaiting-provider-capacity'
        : 'needs-operator-review';
      return { referenceId: ref.id, state };
    });
    return NextResponse.json({
      statuses,
      references: refs.length,
      linked: statuses.filter(ref => ref.state === 'source-linked').length,
      awaiting: statuses.filter(ref => ref.state !== 'source-linked').length,
      // Binding is not collection nor an Instagram relationship attestation.
      collectionVerifiedByMeta: false,
      launchesCollectors: false,
      actionsEnabled: false,
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'Não foi possível consultar as referências' },
      { status: 503, headers: HEADERS });
  }
}
