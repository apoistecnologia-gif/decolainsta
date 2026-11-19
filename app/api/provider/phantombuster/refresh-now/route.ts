export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { runReadOnlyAudienceRefresh } from '@/lib/server/reference-audience-refresh-runner';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Owner-triggered ONE-TIME preview test of the same read-only cron pipeline.
 * Requires server-side provider credentials and explicit collector mappings.
 * Never forwards the key to the browser or launches the collector.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview')
    return NextResponse.json({ error: 'Disponível apenas no Preview experimental' },
      { status: 403, headers: HEADERS });
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' },
    { status: 401, headers: HEADERS });
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Origem inválida' },
      { status: 403, headers: HEADERS });
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' },
      { status: 415, headers: HEADERS });
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 200)
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !['accountId', 'operation'].includes(k)) ||
      input.operation !== 'refresh-readonly' ||
      typeof input.accountId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(input.accountId))
    return NextResponse.json({ error: 'Parâmetros inválidos' },
      { status: 400, headers: HEADERS });

  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true },
  });
  if (!account)
    return NextResponse.json({ error: 'Conta não encontrada' },
      { status: 404, headers: HEADERS });
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes')
    return NextResponse.json({ error: 'Leitura de audiências desativada' },
      { status: 403, headers: HEADERS });

  // The runner implements a six-hour claim cooldown and never performs IG actions.
  return runReadOnlyAudienceRefresh(account.id);
}
