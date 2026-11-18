/**
 * Best-effort, per-server-instance Preview-only guard against accidental repeated
 * paid requests. This does NOT give a hard project-wide cost limit on serverless:
 * require an OpenAI project budget before enabling for a wider audience.
 */
const userRequests = new Map<string, number[]>();
const instanceRequests: number[] = [];
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_USER = 2;
const MAX_INSTANCE = 20;

export function canUsePreviewAI(userId: string, now = Date.now()) {
  const previous = userRequests.get(userId) ?? [];
  const recent = previous.filter(timestamp => timestamp > now - WINDOW_MS);
  userRequests.set(userId, recent);
  for (let i = instanceRequests.length - 1; i >= 0; i--) {
    if (instanceRequests[i] <= now - WINDOW_MS) instanceRequests.splice(i, 1);
  }
  return recent.length < MAX_PER_USER && instanceRequests.length < MAX_INSTANCE;
}

export function countPreviewAIRequest(userId: string, now = Date.now()) {
  if (!canUsePreviewAI(userId, now)) return false;
  userRequests.get(userId)!.push(now);
  instanceRequests.push(now);
  return true;
}
