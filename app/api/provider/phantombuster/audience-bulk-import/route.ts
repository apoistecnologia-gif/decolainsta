export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { readCollectorAudience } from '@/lib/providers/phantombuster-audience';
import { MAX_HISTORY_BATCHES, AUDIENCE_HISTORY_ACTION,
  makeAudienceSnapshot, parseAudienceSnapshot, type AudienceSnapshot } from '@/lib/reference-audience-history';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/**
 * Explicit import of previously collected usernames for ONE owned reference.
 * No collector launch, no IG interaction, no raw profile/credential persistence.
 * Uses the same audited v1 snapshot schema as the existing ten-name history.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401, headers: HEADERS });
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin)
    return NextResponse.json({ error: 'Origem inválida' }, { status: 403, headers: HEADERS });
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415, headers: HEADERS });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 1600)
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(k => !['accountId','referenceId','collectorAgentId','apiKey','confirmBulkImport'].includes(k)) ||
      input.confirmBulkImport !== true ||
      typeof input.accountId !== 'string' || !input.accountId || input.accountId.length > 100 ||
      typeof input.referenceId !== 'string' || !input.referenceId || input.referenceId.length > 100 ||
      typeof input.collectorAgentId !== 'string' || !/^\d{10,25}$/.test(input.collectorAgentId) ||
      typeof input.apiKey !== 'string' || input.apiKey.length < 12 || input.apiKey.length > 512 ||
      !/^[\x21-\x7e]+$/.test(input.apiKey) || /sessionid|instagram|%3a|[;\s]/i.test(input.apiKey))
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400, headers: HEADERS });

  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404, headers: HEADERS });
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase())
    return NextResponse.json({ error: 'Piloto não habilitado' }, { status: 403, headers: HEADERS });
  const reference = await prisma.targetAccount.findFirst({
    where: { id: input.referenceId, instagramAccountId: account.id },
    select: { id: true, username: true },
  });
  if (!reference) return NextResponse.json({ error: 'Referência não encontrada' }, { status: 404, headers: HEADERS });

  // Authentication key is ephemeral; request history only and discard raw output.
  const output = await readCollectorAudience(input.apiKey, input.collectorAgentId,
    [account.username, reference.username]);
  if (output.status !== 'found' || !output.resultLocation)
    return NextResponse.json({ status: output.status, importedCount: 0,
      actionsEnabled: false, referenceVerified: false }, { headers: HEADERS });

  // Stable ordering makes repeated imports idempotent even if provider row order changes.
  const names = [...new Set(output.usernames)].sort();
  const batches: AudienceSnapshot[] = [];
  for (let offset = 0; offset < names.length; offset += 10) {
    const snapshot = makeAudienceSnapshot(reference.id, reference.username.toLowerCase(),
      input.collectorAgentId, names.slice(offset, offset + 10), output.resultLocation);
    if (!snapshot) return NextResponse.json({ error: 'Resultado incompatível' },
      { status: 422, headers: HEADERS });
    batches.push(snapshot);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved = await prisma.$transaction(async tx => {
        const existing = await tx.activityLog.findMany({
          where: { instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION,
            targetUsername: reference.username },
          select: { details: true }, take: MAX_HISTORY_BATCHES,
        });
        const fingerprints = new Set(existing.flatMap(row => {
          const snapshot = parseAudienceSnapshot(row.details);
          return snapshot?.referenceId === reference.id ? [snapshot.fingerprint] : [];
        }));
        const fresh = batches.filter(batch => !fingerprints.has(batch.fingerprint));
        if (fresh.length === 0) return { status: 'duplicate' as const, newBatches: 0 };
        if (fresh.length + existing.length > MAX_HISTORY_BATCHES)
          return { status: 'history-limit' as const, newBatches: 0 };
        await tx.activityLog.createMany({ data: fresh.map(batch => ({
          instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION,
          targetUsername: reference.username, success: true, details: JSON.stringify(batch),
        })) });
        return { status: 'saved' as const, newBatches: fresh.length };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ ...saved,
        importedCount: names.length, totalAvailable: names.length,
        referenceVerified: false, actionsEnabled: false, instagramActionsExecuted: 0 },
      { headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2034' || attempt === 2)
        return NextResponse.json({ error: 'Falha ao importar resultados completos' },
          { status: 503, headers: HEADERS });
    }
  }
  return NextResponse.json({ error: 'Conflito ao importar' }, { status: 503, headers: HEADERS });
}
