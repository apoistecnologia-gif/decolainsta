/**
 * Offline review planner for CONFIRMED single-action laboratory records.
 * Never opens Instagram, performs actions or schedules a background worker.
 * A due review is not permission to unfollow someone automatically.
 */
import { validateUsername } from './guard.mjs';

export function buildManualReviewQueue(events, hours, now = new Date().toISOString()) {
  if (hours !== 24 && hours !== 72) throw new Error('Escolha 24 ou 72 horas.');
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('Data atual inválida.');
  if (!Array.isArray(events)) throw new Error('Histórico inválido.');
  const chronological = events
    .filter(event => event && typeof event === 'object' &&
      event.realActions === 1 &&
      ((event.action === 'follow' && event.status === 'following_confirmed') ||
       (event.action === 'unfollow' && event.status === 'unfollow_confirmed')))
    .map(event => {
      let username;
      try { username = validateUsername(event.username).toLowerCase(); }
      catch { return null; }
      const timeMs = Date.parse(event.timestamp);
      if (!Number.isFinite(timeMs) || timeMs > nowMs + 60_000) return null;
      return { username, action: event.action, timestamp: event.timestamp, timeMs };
    })
    .filter(Boolean).sort((a, b) => a.timeMs - b.timeMs);
  const latest = new Map();
  for (const event of chronological) {
    if (event.action === 'unfollow') {
      latest.delete(event.username);
    } else {
      latest.set(event.username, event);
    }
  }
  return [...latest.values()]
    .map(({ username, timestamp, timeMs }) => {
      const reviewDueAt = new Date(timeMs + hours * 3_600_000).toISOString();
      return {
        username,
        followObservedAt: timestamp,
        reviewDueAt,
        status: Date.parse(reviewDueAt) <= nowMs ? 'review_due' : 'review_pending',
        followbackVerified: false,
        requiresManualDecision: true,
      };
    })
    .sort((a,b) => a.reviewDueAt.localeCompare(b.reviewDueAt));
}
