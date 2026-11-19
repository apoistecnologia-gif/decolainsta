import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readCollectorAudience } from '@/lib/providers/phantombuster-audience';
import {
  AUDIENCE_HISTORY_ACTION, MAX_HISTORY_BATCHES,
  makeAudienceSnapshot, parseAudienceSnapshot,
} from '@/lib/reference-audience-history';
import {
  AUDIENCE_CANDIDATE_ACTION, MAX_CANDIDATES_PER_ACCOUNT,
  MAX_QUEUE_ENTRIES_PER_SYNC, MAX_SNAPSHOTS_PER_SYNC,
  makeCandidateEvidence, parseCandidateEvidence, planCandidateIndex,
} from '@/lib/reference-candidate-queue';
import { MANUAL_SOURCE_PREFIX, REFERENCE_ACTIONS } from '@/lib/reference-workflow';
import {
  AUDIENCE_REFRESH_ACTION, boundAudienceDelta, dueRefreshSources,
  newAudienceNames, refreshIsDue,
  type AudienceRefreshSource,
} from '@/lib/reference-audience-refresh';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { loadActiveAudienceSources } from '@/lib/server/reference-audience-source-store';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

type RefreshResult = 'skipped' | 'unchanged' | 'imported' | 'failed' | 'history-limit';
type RefreshState = { status: RefreshResult; newNames: number; indexed: number; deferredNames?: number };

// A serialized claim prevents two cron workers from importing the same reference
// simultaneously. A failed claim remains a short backoff, not a permanent lock.
async function claim(source: AudienceRefreshSource): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        const last = await tx.activityLog.findFirst({
          where: { instagramAccountId: source.accountId,
            targetUsername: source.referenceId, action: AUDIENCE_REFRESH_ACTION },
          select: { createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!refreshIsDue(last?.createdAt ?? null, new Date())) return null;
        const log = await tx.activityLog.create({
          data: { instagramAccountId: source.accountId, targetUsername: source.referenceId,
            action: AUDIENCE_REFRESH_ACTION, success: false,
            details: JSON.stringify({ version: 1, status: 'claimed',
              collectorAgentId: source.collectorAgentId }) },
          select: { id: true },
        });
        return log.id;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2034' || attempt === 2) throw err;
    }
  }
  return null;
}
async function finish(id: string, status: string, newNames = 0, indexed = 0) {
  // Only status codes and counts. No provider errors, cookies or raw payload.
  await prisma.activityLog.update({
    where: { id }, data: { success: status === 'imported' || status === 'unchanged',
      details: JSON.stringify({ version: 1, status, newNames, indexed }) },
  });
}

async function refreshSource(source: AudienceRefreshSource, apiKey: string): Promise<RefreshState> {
  const account = await prisma.instagramAccount.findFirst({
    where: { id: source.accountId },
    select: { id: true, username: true },
  });
  if (!account) return { status: 'skipped', newNames: 0, indexed: 0 };
  const reference = await prisma.targetAccount.findFirst({
    where: { id: source.referenceId, instagramAccountId: account.id, enabled: true },
    select: { id: true, username: true },
  });
  if (!reference) return { status: 'skipped', newNames: 0, indexed: 0 };
  const claimId = await claim(source);
  if (!claimId) return { status: 'skipped', newNames: 0, indexed: 0 };
  try {
    // Read a COMPLETED result only. Never launch a collector or touch Instagram.
    const result = await readCollectorAudience(apiKey, source.collectorAgentId,
      [account.username, reference.username]);
    if (result.status !== 'found' || result.resultLocation !== 'completed_run') {
      await finish(claimId, result.resultLocation === 'latest_agent_file'
        ? 'latest-file-not-audited' : result.status);
      return { status: 'failed', newNames: 0, indexed: 0 };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await prisma.$transaction(async tx => {
          const previous = await tx.activityLog.findMany({
            where: { instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION,
              targetUsername: reference.username },
            select: { id: true, details: true }, take: MAX_HISTORY_BATCHES + 1,
          });
          if (previous.length > MAX_HISTORY_BATCHES)
            return { status: 'history-limit' as const, newNames: 0, indexed: 0 };
          const known = previous.flatMap(row => {
            const snap = parseAudienceSnapshot(row.details);
            return snap?.referenceId === reference.id ? snap.usernames : [];
          });
          const fresh = newAudienceNames(result.usernames, known,
            [account.username, reference.username]);
          const { importable, deferred } = boundAudienceDelta(
            fresh, previous.length, MAX_HISTORY_BATCHES);
          if (fresh.length > 0 && importable.length === 0)
            return { status: 'history-limit' as const, newNames: 0,
              indexed: 0, deferredNames: deferred };
          const snapshots = [];
          for (let i = 0; i < importable.length; i += 10) {
            const snapshot = makeAudienceSnapshot(reference.id, reference.username.toLowerCase(),
              source.collectorAgentId, importable.slice(i, i + 10), 'completed_run');
            if (!snapshot) throw Error('invalid-snapshot');
            snapshots.push(snapshot);
          }

          if (snapshots.length) await tx.activityLog.createMany({
            data: snapshots.map(snapshot => ({
              instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION,
              targetUsername: reference.username, success: true, details: JSON.stringify(snapshot),
            })),
          });

          // Synchronize the inert index for ALL saved references, round-robin.
          // This is never evidence that a follow or follow-back occurred.
          const [refs, history, existing, protectedNames, reported] = await Promise.all([
            tx.targetAccount.findMany({
              where: { instagramAccountId: account.id },
              select: { id: true, username: true }, take: 100,
            }),
            tx.activityLog.findMany({
              where: { instagramAccountId: account.id, action: AUDIENCE_HISTORY_ACTION },
              select: { id: true, targetUsername: true, details: true, createdAt: true },
              orderBy: { createdAt: 'desc' }, take: MAX_SNAPSHOTS_PER_SYNC,
            }),
            tx.activityLog.findMany({
              where: { instagramAccountId: account.id, action: AUDIENCE_CANDIDATE_ACTION },
              select: { targetUsername: true, details: true }, take: MAX_QUEUE_ENTRIES_PER_SYNC + 1,
            }),
            tx.whitelist.findMany({
              where: { instagramAccountId: account.id }, select: { username: true }, take: 2000,
            }),
            tx.followAction.findMany({
              where: { instagramAccountId: account.id, isDryRun: false,
                action: { in: [...REFERENCE_ACTIONS] },
                sourceTarget: { startsWith: MANUAL_SOURCE_PREFIX } },
              select: { targetUsername: true }, take: 2000,
            }),
          ]);
          if (existing.length > MAX_QUEUE_ENTRIES_PER_SYNC)
            return { status: importable.length ? 'imported' as const : 'unchanged' as const,
              newNames: importable.length, indexed: 0, deferredNames: deferred };
          const recorded = existing.flatMap(row => {
            const evidence = parseCandidateEvidence(row.details);
            return evidence && row.targetUsername ? [row.targetUsername.toLowerCase()] : [];
          });
          const excluded = [
            account.username.toLowerCase(),
            ...protectedNames.map(row => row.username.toLowerCase()),
            ...reported.map(row => row.targetUsername.toLowerCase()),
          ];
          const capacity = Math.max(0, MAX_CANDIDATES_PER_ACCOUNT - new Set(recorded).size);
          const plan = planCandidateIndex(refs, history, recorded, excluded, capacity);
          if (plan.insert.length) await tx.activityLog.createMany({
            data: plan.insert.map(row => ({
              instagramAccountId: account.id, action: AUDIENCE_CANDIDATE_ACTION,
              targetUsername: row.username, success: true,
              details: JSON.stringify(makeCandidateEvidence(row.referenceId, row.referenceUsername,
                row.snapshotId, row.collectorAgentId)),
            })),
          });
          return { status: importable.length || plan.insert.length ? 'imported' as const : 'unchanged' as const,
            newNames: importable.length, indexed: plan.insert.length, deferredNames: deferred };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await finish(claimId, saved.status, saved.newNames, saved.indexed);
        return saved;
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2034' && attempt < 2) continue;
        throw err;
      }
    }
  } catch {
    await finish(claimId, 'failed').catch(() => undefined);
  }
  return { status: 'failed', newNames: 0, indexed: 0 };
}

/**
 * Vercel cron can call this route only with CRON_SECRET, and only in a separately
 * opted-in environment. Preview builds do NOT activate production cron jobs.
 */
export async function runReadOnlyAudienceRefresh(onlyAccountId?: string) {
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' ||
      process.env.PHANTOMBUSTER_AUDIENCE_POLL_ENABLED !== 'yes') {
    return NextResponse.json({ enabled: false, examined: 0, instagramActionsExecuted: 0 },
      { headers: HEADERS });
  }
  // No named pilot account and no static list in Vercel. Read only bindings
  // explicitly approved in the database by the operator.
  if (process.env.VERCEL_ENV !== 'preview' &&
      process.env.PHANTOMBUSTER_MULTI_ACCOUNT_PRODUCTION_ENABLED !== 'yes')
    return NextResponse.json({ enabled: false, reason: 'environment-not-enabled',
      instagramActionsExecuted: 0 }, { headers: HEADERS });
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey))
    return NextResponse.json({ enabled: false, reason: 'configuration-incomplete',
      instagramActionsExecuted: 0 }, { headers: HEADERS });
  const results: RefreshState[] = [];
  try {
    const sources = await loadActiveAudienceSources(onlyAccountId);
    if (!sources.length)
      return NextResponse.json({ enabled: false, reason: 'no-approved-collector-bindings',
        instagramActionsExecuted: 0 }, { headers: HEADERS });
    // Disabled or deleted references do not consume the limited polling slots.
    // Every pairing must belong to the same Instagram account.
    const registered = await prisma.targetAccount.findMany({
      where: { id: { in: sources.map(s => s.referenceId) },
        instagramAccountId: { in: [...new Set(sources.map(s => s.accountId))] },
        enabled: true },
      select: { id: true, instagramAccountId: true },
    });
    const validPairs = new Set(registered.map(r => r.instagramAccountId + ':' + r.id));
    const eligible = sources.filter(s => validPairs.has(s.accountId + ':' + s.referenceId));

    // Prioritize overdue sources across all registered customer accounts.
    const lastAttempts = await prisma.activityLog.groupBy({
      by: ['instagramAccountId', 'targetUsername'],
      where: {
        action: AUDIENCE_REFRESH_ACTION,
        instagramAccountId: { in: [...new Set(eligible.map(s => s.accountId))] },
        targetUsername: { in: eligible.map(s => s.referenceId) },
      },
      _max: { createdAt: true },
    });
    const due = dueRefreshSources(eligible, lastAttempts.flatMap(entry =>
      entry.targetUsername ? [{
        accountId: entry.instagramAccountId,
        referenceId: entry.targetUsername,
        lastAttemptAt: entry._max.createdAt,
      }] : []), new Date());

    // At most three external reads, sequentially; no collector launch.
    for (const source of due) results.push(await refreshSource(source, apiKey));
    return NextResponse.json({
      enabled: true, examined: results.length,
      skippedConfiguration: sources.length - eligible.length,
      imported: results.filter(r => r.status === 'imported').length,
      unchanged: results.filter(r => r.status === 'unchanged').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      failed: results.filter(r => r.status === 'failed').length,
      historyLimit: results.filter(r => r.status === 'history-limit').length,
      newCandidatesObserved: results.reduce((sum,r) => sum + r.newNames, 0),
      deferredByHistoryLimit: results.reduce((sum,r) => sum + (r.deferredNames ?? 0), 0),
      indexed: results.reduce((sum,r) => sum + r.indexed, 0),
      provenance: 'operator_assigned_collector_result',
      referenceVerified: false, actionsEnabled: false, instagramActionsExecuted: 0,
    }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'Falha na atualização de audiências' },
      { status: 503, headers: HEADERS });
  }
}
