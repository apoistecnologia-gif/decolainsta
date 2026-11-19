/**
 * Self-reported reference workflow. These are user assertions, NOT Instagram API actions.
 * Prefix and statuses keep the cloud tracker isolated from the legacy fake engine.
 */
export const MANUAL_SOURCE_PREFIX = 'reference_manual:';
export const REFERENCE_ACTIONS = [
  'reference_candidate',
  'reference_followed',
  'reference_kept',
  'reference_unfollowed',
] as const;

export type ReferenceAction = (typeof REFERENCE_ACTIONS)[number];
export const FOLLOW_BACK_REVIEW_HOURS = 48 as const;
export type ReferenceReviewHours = typeof FOLLOW_BACK_REVIEW_HOURS;

export function referenceSource(username: string): string {
  return `${MANUAL_SOURCE_PREFIX}${username}`;
}

export function referenceFromSource(value: string | null): string | null {
  return value?.startsWith(MANUAL_SOURCE_PREFIX)
    ? value.slice(MANUAL_SOURCE_PREFIX.length)
    : null;
}

export function reviewTime(from: Date, hours: unknown): Date | null {
  if (hours !== FOLLOW_BACK_REVIEW_HOURS || !Number.isFinite(from.getTime())) return null;
  const date = new Date(from.getTime() + hours * 60 * 60 * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function reviewIsDue(
  action: string,
  followedBack: boolean,
  scheduledAt: Date | null,
  now: Date,
): boolean {
  // Follow-back must be explicitly confirmed. A mere passage of time never
  // becomes evidence of a follow-back or permission to unfollow someone.
  return action === 'reference_followed'
    && followedBack
    && scheduledAt instanceof Date
    && Number.isFinite(scheduledAt.getTime())
    && scheduledAt.getTime() <= now.getTime();
}
