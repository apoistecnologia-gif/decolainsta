import type { AudienceRefreshSource } from './reference-audience-refresh';
import {
  parseCollectorDraftEvent, type CollectorDraftEvent,
} from './reference-collector-draft-events';

export type ProvisioningReference = {
  id: string;
  username: string;
  accountId: string;
  createdAt: Date;
};
export type ProvisioningAttempt = {
  accountId: string;
  referenceId: string | null;
  details: string | null;
  createdAt: Date;
};
export type ProvisioningPlan = {
  total: number;
  linked: number;
  pendingSetup: number;
  previousAttemptNeedsReview: number;
  explicitlyRevoked: number;
  eligible: number;
  next: { accountId: string; referenceId: string; username: string } | null;
};

/** A durable claim (even a malformed one) is not retried automatically.
 * No selector depends on pilot usernames or manually chosen profile IDs.
 * Fairness: take the earliest eligible reference of each customer before
 * taking that customer's second reference.
 */
export function planCollectorProvisioning(
  references: ProvisioningReference[],
  sources: AudienceRefreshSource[],
  revoked: ReadonlySet<string>,
  attempts: ProvisioningAttempt[],
): ProvisioningPlan {
  const key = (accountId: string, refId: string) => accountId + ':' + refId;
  const bound = new Set(sources.map(s => key(s.accountId, s.referenceId)));
  // Any attempt is intentional, even if its details were malformed or the
  // previous provider response was uncertain. Preserve idempotent fail-closed.
  const seen = new Map<string, CollectorDraftEvent | null>();
  for (const entry of [...attempts].sort((a,b) =>
    b.createdAt.getTime() - a.createdAt.getTime())) {
    if (!entry.referenceId) continue;
    const k = key(entry.accountId, entry.referenceId);
    if (!seen.has(k)) seen.set(k, parseCollectorDraftEvent(entry.details));
  }
  let linked=0, pendingSetup=0, previousAttemptNeedsReview=0;
  let explicitlyRevoked=0;
  const eligibleByCustomer = new Map<string, ProvisioningReference[]>();
  const ordered = [...references].sort((a,b) =>
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id));
  for (const ref of ordered) {
    const id = key(ref.accountId, ref.id);
    if (revoked.has(id)) { explicitlyRevoked++; continue; }
    if (bound.has(id)) { linked++; continue; }
    if (seen.has(id)) {
      const existing = seen.get(id);
      if (existing?.state === 'created' ||
          existing?.state === 'existing-draft') pendingSetup++;
      else previousAttemptNeedsReview++;
      continue;
    }
    if (!/^[a-z0-9._]{1,30}$/.test(ref.username.toLowerCase())) continue;
    const group = eligibleByCustomer.get(ref.accountId) ?? [];
    group.push(ref);
    eligibleByCustomer.set(ref.accountId, group);
  }
  const eligible = [...eligibleByCustomer.values()].reduce((n,group) => n + group.length,0);
  const groups = [...eligibleByCustomer.entries()].map(([accountId,rows])=>({
    accountId, first: rows[0].createdAt.getTime(), rows,
  })).sort((a,b)=>a.first-b.first||a.accountId.localeCompare(b.accountId));
  const top = groups[0]?.rows[0];
  return {
    total: references.length,
    linked, pendingSetup, previousAttemptNeedsReview, explicitlyRevoked,
    eligible,
    next: top ? {accountId:top.accountId,referenceId:top.id,username:top.username}:null,
  };
}
