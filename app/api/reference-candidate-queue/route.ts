export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  AUDIENCE_CANDIDATE_ACTION, AUDIENCE_HISTORY_ACTION,
  MAX_CANDIDATES_PER_ACCOUNT, MAX_SNAPSHOTS_PER_SYNC, MAX_QUEUE_ENTRIES_PER_SYNC,
  makeCandidateEvidence, parseCandidateEvidence, planCandidateIndex,
} from '@/lib/reference-candidate-queue';
import { MANUAL_SOURCE_PREFIX, REFERENCE_ACTIONS } from '@/lib/reference-workflow';
import { summarizeReportedRelationships } from '@/lib/reference-relationship-overview';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

async function authorize(accountId: unknown) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: 'Não autorizado', code: 401 } as const;
  if (typeof accountId !== 'string' || !accountId || accountId.length > 100)
    return { error: 'Conta inválida', code: 400 } as const;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { id: true, username: true },
  });
  if (!account) return { error: 'Conta não encontrada', code: 404 } as const;
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_PILOT_USERNAME?.toLowerCase() !== account.username.toLowerCase())
    return { error: 'Fila experimental indisponível', code: 403 } as const;
  return { account } as const;
}

function denied(ctx: Awaited<ReturnType<typeof authorize>>) {
  return 'error' in ctx
    ? NextResponse.json({ error: ctx.error }, { status: ctx.code, headers: HEADERS })
    : null;
}

export async function GET(req: Request) {
  const ctx = await authorize(new URL(req.url).searchParams.get('accountId'));
  const rejection = denied(ctx);
  if (rejection) return rejection;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const [saved, reportedRelationships, protectedProfiles] = await Promise.all([
    prisma.activityLog.findMany({
      where: { instagramAccountId: ctx.account.id, action: AUDIENCE_CANDIDATE_ACTION },
      select: { id: true, targetUsername: true, details: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_QUEUE_ENTRIES_PER_SYNC + 1,
    }),
    prisma.followAction.findMany({
      where: {
        instagramAccountId: ctx.account.id, isDryRun: false,
        sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX },
        action: { in: [...REFERENCE_ACTIONS] },
      },
      select: { targetUsername: true, action: true, followedBack: true, followedAt: true },
      take: MAX_QUEUE_ENTRIES_PER_SYNC + 1,
    }),
    prisma.whitelist.findMany({
      where: { instagramAccountId: ctx.account.id },
      select: { username: true }, take: 2000,
    }),
  ]);
  const candidates = saved.flatMap(item => {
    const evidence = parseCandidateEvidence(item.details);
    return evidence && item.targetUsername
      ? [{ id: item.id, username: item.targetUsername, referenceId: evidence.referenceId,
        referenceUsername: evidence.referenceUsername, status: evidence.status,
        createdAt: item.createdAt }] : [];
  });
  const byReference = new Map<string, {
    referenceId: string; referenceUsername: string; candidates: number;
  }>();
  const seen = new Set<string>();
  let lastIndexedAt: string | null = null;
  let duplicateRecords = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.username.toLowerCase())) {
      duplicateRecords++;
      continue;
    }
    seen.add(candidate.username.toLowerCase());
    const existing = byReference.get(candidate.referenceId);
    if (existing) existing.candidates++;
    else byReference.set(candidate.referenceId, {
      referenceId: candidate.referenceId,
      referenceUsername: candidate.referenceUsername, candidates: 1,
    });
    const timestamp = candidate.createdAt.toISOString();
    if (!lastIndexedAt || timestamp > lastIndexedAt) lastIndexedAt = timestamp;
  }
  const counts = [...byReference.values()].sort((a,b) =>
    b.candidates - a.candidates || a.referenceUsername.localeCompare(b.referenceUsername));
  const relationshipOverview = summarizeReportedRelationships(
    seen, reportedRelationships, protectedProfiles.map(row => row.username), new Date(),
  );
  return NextResponse.json({
    relationshipOverview,
    persistedCandidates: seen.size,
    referencesRepresented: counts.length,
    byReference: counts,
    lastIndexedAt, duplicateRecords,
    capacity: MAX_CANDIDATES_PER_ACCOUNT,
    candidates: candidates.slice(0, 10),
    status: 'identified_unverified',
    provenance: 'operator_assigned_collector_result',
    verifiedByMeta: false, followbackVerified: false,
    actionsEnabled: false, instagramActionsExecuted: 0,
  }, { headers: HEADERS });
}

/**
 * Idempotent, account-scoped sync from SAVED HISTORY to an inert candidate
 * index. No PhantomBuster request, no Instagram request, and no FollowAction writes.
 * Can be triggered once by the experimental UI without selecting users.
 */
export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin)
    return NextResponse.json({ error: 'Origem inválida' }, { status: 403, headers: HEADERS });
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415, headers: HEADERS });
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 200)
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  let obj: unknown;
  try { obj = JSON.parse(raw) as unknown; } catch { obj = null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400, headers: HEADERS });
  const body = obj as Record<string, unknown>;
  if (Object.keys(body).some(k => !['accountId', 'operation'].includes(k)) ||
      body.operation !== 'sync-saved-history')
    return NextResponse.json({ error: 'Operação inválida' }, { status: 400, headers: HEADERS });

  const ctx = await authorize(body.accountId);
  const rejection = denied(ctx);
  if (rejection) return rejection;
  if ('error' in ctx) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const outcome = await prisma.$transaction(async tx => {
        // Lock predicate at Serializable isolation to deduplicate concurrent
        // browser mounts and repeated POSTs without new schema migrations.
        const [refs, snapshots, existing, protectedNames, manualActions] = await Promise.all([
          tx.targetAccount.findMany({
            where: { instagramAccountId: ctx.account.id },
            select: { id: true, username: true }, take: 100,
          }),
          tx.activityLog.findMany({
            where: { instagramAccountId: ctx.account.id, action: AUDIENCE_HISTORY_ACTION },
            select: { id: true, targetUsername: true, details: true, createdAt: true },
            orderBy: { createdAt: 'desc' }, take: MAX_SNAPSHOTS_PER_SYNC,
          }),
          tx.activityLog.findMany({
            where: { instagramAccountId: ctx.account.id, action: AUDIENCE_CANDIDATE_ACTION },
            select: { id: true, targetUsername: true, details: true }, take: MAX_QUEUE_ENTRIES_PER_SYNC + 1,
          }),
          tx.whitelist.findMany({
            where: { instagramAccountId: ctx.account.id },
            select: { username: true }, take: 2000,
          }),
          tx.followAction.findMany({
            where: { instagramAccountId: ctx.account.id, isDryRun: false,
              action: { in: [...REFERENCE_ACTIONS] } },
            select: { targetUsername: true }, take: 2000,
          }),
        ]);
        if (existing.length > MAX_QUEUE_ENTRIES_PER_SYNC)
          return { synced: 0, total: existing.length, status: 'capacity-reached' as const };
        const recorded = existing.flatMap(entry => {
          const evidence = parseCandidateEvidence(entry.details);
          return evidence && entry.targetUsername ? [entry.targetUsername.toLowerCase()] : [];
        });
        const alreadyUsed = new Set(recorded);
        const exclusions = [
          ctx.account.username.toLowerCase(),
          ...protectedNames.map(x => x.username.toLowerCase()),
          ...manualActions.map(x => x.targetUsername.toLowerCase()),
        ];
        const remainingCapacity = MAX_CANDIDATES_PER_ACCOUNT - alreadyUsed.size;
        const plan = planCandidateIndex(refs, snapshots, alreadyUsed, exclusions, remainingCapacity);
        if (plan.insert.length) {
          const rows = plan.insert.flatMap(candidate => {
            const details = makeCandidateEvidence(candidate.referenceId, candidate.referenceUsername,
              candidate.snapshotId, candidate.collectorAgentId);
            return details ? [{
              instagramAccountId: ctx.account.id, targetUsername: candidate.username,
              action: AUDIENCE_CANDIDATE_ACTION, success: true, details: JSON.stringify(details),
            }] : [];
          });
          if (rows.length) await tx.activityLog.createMany({ data: rows });
        }
        return {
          status: 'synced' as const, synced: plan.insert.length,
          total: alreadyUsed.size + plan.insert.length,
          availableInHistory: plan.available,
          referencesRepresented: plan.referencesRepresented,
          snapshotsRead: snapshots.length,
          historyTruncated: snapshots.length >= MAX_SNAPSHOTS_PER_SYNC,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return NextResponse.json({ ...outcome,
        savedToDatabase: true, instagramActionsExecuted: 0,
        actionsEnabled: false, referenceVerified: false, followbackVerified: false,
      }, { headers: HEADERS });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2034' || attempt === 2)
        return NextResponse.json({ error: 'Não foi possível sincronizar o índice de candidatos' },
          { status: 503, headers: HEADERS });
    }
  }
  return NextResponse.json({ error: 'Conflito de sincronização' }, { status: 503, headers: HEADERS });
}
