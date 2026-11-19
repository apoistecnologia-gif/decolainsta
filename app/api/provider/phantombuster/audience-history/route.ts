export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { previewCollectorResult } from '@/lib/providers/phantombuster-audience';
import {
  AUDIENCE_HISTORY_ACTION, MAX_HISTORY_BATCHES,
  makeAudienceSnapshot, parseAudienceSnapshot,
} from '@/lib/reference-audience-history';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

async function authorize(accountId: unknown, referenceId: unknown) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: 'Não autorizado', code: 401 } as const;
  if (typeof accountId !== 'string' || !accountId || accountId.length > 100 ||
      typeof referenceId !== 'string' || !referenceId || referenceId.length > 100) {
    return { error: 'Parâmetros inválidos', code: 400 } as const;
  }
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return { error: 'Conta não encontrada', code: 404 } as const;
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase()) {
    return { error: 'Histórico experimental indisponível para esta conta', code: 403 } as const;
  }
  const reference = await prisma.targetAccount.findFirst({
    where: { id: referenceId, instagramAccountId: account.id },
    select: { id: true, username: true },
  });
  if (!reference) return { error: 'Referência não encontrada', code: 404 } as const;
  return { account, reference, userId } as const;
}

function denied(value: Awaited<ReturnType<typeof authorize>>) {
  return 'error' in value
    ? NextResponse.json({ error: value.error }, { status: value.code, headers: HEADERS })
    : null;
}

function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  return !!origin && origin === new URL(req.url).origin;
}

function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 512 &&
    /^[\x21-\x7e]+$/.test(value) && !/sessionid|instagram|%3a|[;\s]/i.test(value);
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const ctx = await authorize(params.get('accountId'), params.get('referenceId'));
  const rejection = denied(ctx);
  if (rejection) return rejection;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const records = await prisma.activityLog.findMany({
    where: { instagramAccountId: ctx.account.id, action: AUDIENCE_HISTORY_ACTION,
      targetUsername: ctx.reference.username },
    select: { id: true, details: true, createdAt: true }, orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_BATCHES,
  });
  const history = records.flatMap(entry => {
    const snapshot = parseAudienceSnapshot(entry.details);
    return snapshot && snapshot.referenceId === ctx.reference.id
      ? [{ id: entry.id, savedAt: entry.createdAt, usernames: snapshot.usernames,
        collectorAgentId: snapshot.collectorAgentId, resultLocation: snapshot.resultLocation,
        referenceVerified: false }]
      : [];
  });
  return NextResponse.json({ history, source: 'operator_assigned_collector_result',
    referenceVerified: false, actionsEnabled: false }, { headers: HEADERS });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Origem inválida' }, { status: 403 });
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415 });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 1600) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !['accountId','referenceId','collectorAgentId','apiKey','confirmSave'].includes(k)) ||
      input.confirmSave !== true || typeof input.collectorAgentId !== 'string' ||
      !/^\d{10,25}$/.test(input.collectorAgentId) || !validKey(input.apiKey))
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });

  const ctx = await authorize(input.accountId, input.referenceId);
  const rejection = denied(ctx);
  if (rejection) return rejection;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  // The API key is used only for this new, explicitly approved read.
  // No cookies, phone numbers, emails, raw payloads, or API keys are persisted.
  const preview = await previewCollectorResult(input.apiKey, input.collectorAgentId,
    [ctx.account.username, ctx.reference.username]);
  if (preview.status !== 'found' || !preview.resultLocation) {
    return NextResponse.json({ saved: false, duplicate: false, status: preview.status,
      referenceVerified: false, actionsEnabled: false }, { headers: HEADERS });
  }
  const snapshot = makeAudienceSnapshot(
    ctx.reference.id, ctx.reference.username.toLowerCase(), input.collectorAgentId,
    preview.usernames, preview.resultLocation,
  );
  if (!snapshot) return NextResponse.json({ error: 'Resultado inválido para histórico' }, { status: 422 });
  // SERIALIZABLE plus retry prevents duplicate batches during concurrent clicks.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const saved = await prisma.$transaction(async tx => {
        const records = await tx.activityLog.findMany({
          where: { instagramAccountId: ctx.account.id, action: AUDIENCE_HISTORY_ACTION,
            targetUsername: ctx.reference.username },
          select: { details: true }, orderBy: { createdAt: 'desc' }, take: MAX_HISTORY_BATCHES,
        });
        if (records.some(entry => parseAudienceSnapshot(entry.details)?.fingerprint === snapshot.fingerprint))
          return { saved: false, duplicate: true, status: 'duplicate' };
        if (records.length >= MAX_HISTORY_BATCHES)
          return { saved: false, duplicate: false, status: 'history-limit' };
        await tx.activityLog.create({
          data: { instagramAccountId: ctx.account.id, action: AUDIENCE_HISTORY_ACTION,
            targetUsername: ctx.reference.username, success: true, details: JSON.stringify(snapshot) },
        });
        return { saved: true, duplicate: false, status: 'saved' };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ ...saved, importedCount: snapshot.usernames.length,
        referenceVerified: false, actionsEnabled: false }, { headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2034' || attempt === 2) {
        return NextResponse.json({ error: 'Não foi possível registrar o histórico' }, { status: 503, headers: HEADERS });
      }
    }
  }
  return NextResponse.json({ error: 'Conflito de atualização' }, { status: 503 });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Origem inválida' }, { status: 403 });
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415 });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 600) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(raw) as unknown; } catch { body = null; }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  const p = body as Record<string, unknown>;
  if (Object.keys(p).some(k => !['accountId','referenceId','historyId','confirmDelete'].includes(k)) ||
      p.confirmDelete !== true || typeof p.historyId !== 'string' ||
      !p.historyId || p.historyId.length > 100)
    return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
  const ctx = await authorize(p.accountId, p.referenceId);
  const rejection = denied(ctx);
  if (rejection) return rejection;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const entry = await prisma.activityLog.findFirst({
    where: { id: p.historyId, instagramAccountId: ctx.account.id,
      action: AUDIENCE_HISTORY_ACTION, targetUsername: ctx.reference.username },
    select: { details: true },
  });
  if (!entry || parseAudienceSnapshot(entry.details)?.referenceId !== ctx.reference.id)
    return NextResponse.json({ error: 'Registro não encontrado' }, { status: 404, headers: HEADERS });
  const removed = await prisma.activityLog.deleteMany({
    where: { id: p.historyId, instagramAccountId: ctx.account.id,
      action: AUDIENCE_HISTORY_ACTION, targetUsername: ctx.reference.username },
  });
  return NextResponse.json({ success: removed.count === 1 }, { headers: HEADERS });
}
