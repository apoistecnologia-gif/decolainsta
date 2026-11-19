export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { checkPhantomBusterWorkspace, type PhantomBusterResult } from '@/lib/providers/phantombuster';
import { NextResponse } from 'next/server';

function reply(data: PhantomBusterResult, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Explicitly pilot-only read API:
 * - Requires an authenticated user owning the specified Instagram account.
 * - Requires the exact opt-in account ID and environment flag.
 * - Does NOT authenticate to Instagram or launch any Phantom.
 * - Never returns the API key, agent setup or session cookies.
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const accountId = new URL(req.url).searchParams.get('accountId');
  if (typeof accountId !== 'string' || !accountId || accountId.length > 100) {
    return NextResponse.json({ error: 'Conta inválida' }, { status: 400 });
  }
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });

  // Allow an explicit test account by its app ID OR exact username.
  // In either case, the authenticated user must own the account in our DB.
  // Username allowlisting avoids needing to inspect or copy a customer's DB ID.
  const pilotById = !!process.env.PHANTOMBUSTER_PILOT_ACCOUNT_ID &&
    process.env.PHANTOMBUSTER_PILOT_ACCOUNT_ID === account.id;
  const pilotByUsername = !!process.env.PHANTOMBUSTER_PILOT_USERNAME &&
    process.env.PHANTOMBUSTER_PILOT_USERNAME.toLowerCase() === account.username.toLowerCase();
  if (
    process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
    !(pilotById || pilotByUsername)
  ) {
    return reply({ status: 'disabled', instagramConnectionVerified: false, actionsEnabled: false });
  }

  // Key is backend-only, never accepted from req or browser and never printed.
  const key = process.env.PHANTOMBUSTER_API_KEY;
  if (!key) {
    return reply({ status: 'not-configured', instagramConnectionVerified: false, actionsEnabled: false });
  }
  return reply(await checkPhantomBusterWorkspace(key));
}
