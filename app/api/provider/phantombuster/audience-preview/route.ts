export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { previewCollectorResult } from '@/lib/providers/phantombuster-audience';
import { NextResponse } from 'next/server';

/**
 * Preview only: GET existing PhantomBuster results using operator's temporary key.
 * No database writes, scheduled launches, Instagram requests, or follow/unfollow.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Origem inválida' }, { status: 403 });
  }
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415 });
  }
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 1600) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const p = parsed as Record<string, unknown>;
  if (Object.keys(p).some(k => !['accountId', 'referenceId', 'collectorAgentId', 'apiKey'].includes(k)) ||
      typeof p.accountId !== 'string' || !p.accountId || p.accountId.length > 100 ||
      typeof p.referenceId !== 'string' || !p.referenceId || p.referenceId.length > 100 ||
      typeof p.collectorAgentId !== 'string' || !/^\d{10,25}$/.test(p.collectorAgentId) ||
      typeof p.apiKey !== 'string' || p.apiKey.length < 12 || p.apiKey.length > 512 ||
      !/^[\x21-\x7e]+$/.test(p.apiKey) || /sessionid|instagram|%3a|[;\s]/i.test(p.apiKey)) {
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
  }

  const account = await prisma.instagramAccount.findFirst({
    where: { id: p.accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 });
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase()) {
    return NextResponse.json({ error: 'Piloto desativado para esta conta' }, { status: 403 });
  }
  const reference = await prisma.targetAccount.findFirst({
    where: { id: p.referenceId, instagramAccountId: account.id },
    select: { id: true, username: true },
  });
  if (!reference) return NextResponse.json({ error: 'Referência não cadastrada' }, { status: 404 });

  const output = await previewCollectorResult(
    p.apiKey, p.collectorAgentId,
    [account.username, reference.username],
  );
  // Not a verified relationship with this reference, since collector output
  // does not provide a trustworthy reference-owner proof.
  return NextResponse.json({
    ...output,
    referenceUsername: reference.username,
    referenceVerified: false,
  }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
