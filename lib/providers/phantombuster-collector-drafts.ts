import { createHash } from 'node:crypto';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type CollectorDraft = Readonly<{
  org: 'phantombuster';
  script: 'Instagram Follower Collector.js';
  branch: 'master';
  name: string;
  launchType: 'manually';
  idempotencyKey: string;
}>;

const validId = (value: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const validUsername = (value: string) => /^[a-z0-9._]{1,30}$/.test(value);

/**
 * A PhantomBuster instance without an Instagram connection or input.
 * Never put usernames, session cookies, arguments, automatic schedules,
 * or a launch instruction in the creation request.
 */
export function prepareCollectorDraft(
  accountId: string, referenceId: string, referenceUsername: string,
): CollectorDraft | null {
  if (!validId(accountId) || !validId(referenceId) ||
      !validUsername(referenceUsername)) return null;
  const fingerprint = createHash('sha256')
    .update('decolainsta:phantombuster:follower-collector-draft:v1\0')
    .update(accountId).update('\0').update(referenceId)
    .digest('hex');
  return {
    org: 'phantombuster',
    script: 'Instagram Follower Collector.js',
    branch: 'master',
    name: 'DECOLA INSTA - Follower Collector draft ' + fingerprint.slice(0, 16),
    launchType: 'manually',
    idempotencyKey: fingerprint,
  };
}

export type DraftCreationStatus =
  | { status: 'created'; agentId: string }
  | { status: 'capacity-reached' | 'invalid-key' | 'rejected' |
      'rate-limited' | 'unavailable' | 'unconfirmed-id' };

/** External write. Caller MUST enforce preview-only, admin and opt-in flags. */
export async function createUnconfiguredCollectorDraft(
  apiKey: string, draft: CollectorDraft,
  fetcher: Fetcher = fetch,
): Promise<DraftCreationStatus> {
  if (!apiKey || apiKey.length > 512 ||
      draft.org !== 'phantombuster' ||
      draft.script !== 'Instagram Follower Collector.js' ||
      draft.branch !== 'master' ||
      draft.launchType !== 'manually' ||
      !/^DECOLA INSTA - Follower Collector draft [a-f0-9]{16}$/.test(draft.name) ||
      !/^[a-f0-9]{64}$/.test(draft.idempotencyKey))
    return { status: 'rejected' };
  try {
    const response = await fetcher(
      'https://api.phantombuster.com/api/v2/agents/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json',
          'X-Phantombuster-Key': apiKey,
        },
        cache: 'no-store', redirect: 'error', credentials: 'omit',
        signal: AbortSignal.timeout(9000),
        // Never add argument, sessionCookie, launchType=repeatedly, or id.
        body: JSON.stringify(draft),
      },
    );
    if (response.status === 401 || response.status === 403)
      return { status: 'invalid-key' };
    if (response.status === 402) return { status: 'capacity-reached' };
    if (response.status === 429) return { status: 'rate-limited' };
    if (response.status === 400 || response.status === 412)
      return { status: 'rejected' };
    if (!response.ok) return { status: 'unavailable' };
    if (Number(response.headers.get('content-length') ?? 0) > 5000)
      return { status: 'unconfirmed-id' };
    const raw = await response.text();
    if (raw.length > 5000) return { status: 'unconfirmed-id' };
    const data: unknown = JSON.parse(raw) as unknown;
    const payload = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown> : null;
    const result = payload?.data && typeof payload.data === 'object' &&
      !Array.isArray(payload.data)
      ? payload.data as Record<string, unknown> : payload;
    const agentId = result?.id ?? result?.agentId ?? result?._id;
    if (!/^\d{10,25}$/.test(String(agentId ?? '')))
      return { status: 'unconfirmed-id' };
    return { status: 'created', agentId: String(agentId) };
  } catch {
    // A network timeout could have happened AFTER a successful remote create.
    // Never retry this automatically: reconcile using the deterministic name.
    return { status: 'unavailable' };
  }
}
