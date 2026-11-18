import { measureFollowers, type FollowersMeasurement } from './growth-measurement';
import type { InstagramProfile } from './meta';

/** Daily read-only Meta sync. Never follows, unfollows or reads another account's followers. */
export const AUTOMATIC_SYNC_INTERVAL_MS = 23 * 60 * 60 * 1000;
export const AUTOMATIC_SYNC_BATCH_LIMIT = 5;

export function isDueForAutomaticSync(lastSyncedAt: Date | null, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  if (lastSyncedAt === null) return true;
  if (!Number.isFinite(lastSyncedAt.getTime())) return false;
  return now.getTime() - lastSyncedAt.getTime() >= AUTOMATIC_SYNC_INTERVAL_MS;
}

export function prepareAutomaticSnapshot(
  profile: InstagramProfile,
  previousFollowers: number | null,
  observedAt: Date,
): {
  update: { lastSyncedAt: Date; profileFollowersCount?: number; profileMediaCount?: number };
  measurement: FollowersMeasurement | null;
} {
  const measurement = measureFollowers(profile.followers_count, previousFollowers);
  const validMediaCount = typeof profile.media_count === 'number'
    && Number.isSafeInteger(profile.media_count) && profile.media_count >= 0;
  return {
    update: {
      lastSyncedAt: observedAt,
      ...(measurement ? { profileFollowersCount: measurement.current } : {}),
      ...(validMediaCount ? { profileMediaCount: profile.media_count } : {}),
    },
    measurement,
  };
}
