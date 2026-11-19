import { prisma } from '@/lib/db';
import {
  AUDIENCE_SOURCE_BINDING_ACTION, MAX_SOURCE_BINDING_LOGS,
  resolveActiveAudienceSources,
} from '@/lib/reference-audience-source-registry';

/**
 * Registry lookup works for all customer accounts, not a named pilot user.
 * Fail closed on excessive history rather than silently omitting tenants.
 */
export async function loadActiveAudienceSources(accountId?: string) {
  const rows = await prisma.activityLog.findMany({
    where: {
      action: AUDIENCE_SOURCE_BINDING_ACTION,
      ...(accountId ? { instagramAccountId: accountId } : {}),
    },
    select: {
      id: true, instagramAccountId: true,
      targetUsername: true, details: true, createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_SOURCE_BINDING_LOGS + 1,
  });
  if (rows.length > MAX_SOURCE_BINDING_LOGS)
    throw new Error('audience-bindings-require-compaction');
  return resolveActiveAudienceSources(rows);
}
