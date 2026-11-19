import { FOLLOW_BACK_REVIEW_HOURS } from '@/lib/reference-workflow';

export type ReportedRelationship = {
  targetUsername: string;
  action: string;
  followedBack: boolean;
  followedAt: Date | null;
};

export type RelationshipOverview = {
  basis: 'operator_reported_not_meta_verified';
  followbackVerifiedByMeta: false;
  socialActionsEnabled: false;
  reviewHours: 48;
  reportedRecords: number;
  manuallyTrackedCandidates: number;
  reportedFollowed: number;
  followBackReported: number;
  due48hReview: number;
  awaiting48h: number;
  followBackNotReported: number;
  protectedDue48h: number;
  invalidFollowTimestamps: number;
  keptReported: number;
  unfollowReported: number;
  identifiedWithoutReportedAction: number;
  identifiedWithReportedAction: number;
};

const isUsername = (name: unknown): name is string =>
  typeof name === 'string' && /^[a-z0-9._]{1,30}$/.test(name);

/**
 * Read-only aggregation of independent, self-reported tracking events.
 * Identifying a username from a collector NEVER implies a follow occurred.
 * The 48h threshold begins only at the self-reported follow timestamp.
 */
export function summarizeReportedRelationships(
  candidates: Iterable<string>,
  relationships: ReportedRelationship[],
  protectedUsernames: Iterable<string>,
  now: Date,
): RelationshipOverview {
  const found = new Set([...candidates].filter(isUsername).map(name => name.toLowerCase()));
  const protectedNames = new Set(
    [...protectedUsernames].filter(isUsername).map(name => name.toLowerCase()),
  );
  const manuallyTracked = new Set<string>();
  const result: RelationshipOverview = {
    basis: 'operator_reported_not_meta_verified',
    followbackVerifiedByMeta: false,
    socialActionsEnabled: false,
    reviewHours: FOLLOW_BACK_REVIEW_HOURS,
    reportedRecords: 0, manuallyTrackedCandidates: 0, reportedFollowed: 0,
    followBackReported: 0, due48hReview: 0, awaiting48h: 0,
    followBackNotReported: 0, protectedDue48h: 0, invalidFollowTimestamps: 0,
    keptReported: 0, unfollowReported: 0,
    identifiedWithoutReportedAction: 0, identifiedWithReportedAction: 0,
  };
  const nowTime = now.getTime();
  for (const row of relationships) {
    if (!isUsername(row.targetUsername)) continue;
    result.reportedRecords++;
    const name = row.targetUsername.toLowerCase();
    if (found.has(name)) manuallyTracked.add(name);

    if (row.action === 'reference_candidate') {
      result.manuallyTrackedCandidates++;
    } else if (row.action === 'reference_kept') {
      result.keptReported++;
    } else if (row.action === 'reference_unfollowed') {
      result.unfollowReported++;
    } else if (row.action === 'reference_followed') {
      result.reportedFollowed++;
      const followed = row.followedAt?.getTime();
      if (followed === undefined || !Number.isFinite(followed) ||
          !Number.isFinite(nowTime) || followed > nowTime) {
        result.invalidFollowTimestamps++;
        continue;
      }
      if (!row.followedBack) {
        result.followBackNotReported++;
        continue;
      }
      result.followBackReported++;
      const threshold = followed + FOLLOW_BACK_REVIEW_HOURS * 60 * 60 * 1000;
      if (nowTime < threshold) {
        result.awaiting48h++;
      } else if (protectedNames.has(name)) {
        result.protectedDue48h++;
      } else {
        result.due48hReview++;
      }
    }
  }
  result.identifiedWithReportedAction = manuallyTracked.size;
  result.identifiedWithoutReportedAction = found.size - manuallyTracked.size;
  return result;
}
