/**
 * Bounded social-action test policy. No API permissions, no Instagram login,
 * no bypass of platform safeguards. Provider outcomes must be verified.
 */
export const SOCIAL_PILOT_ACTION = 'reference_social_pilot_v1';
export const SOCIAL_PILOT_FOLLOW_CONFIRMATION = 'CONFIRM_SINGLE_TEST_FOLLOW';
export const SOCIAL_PILOT_UNFOLLOW_AFTER_HOURS = 48;
export type RelationshipProof = 'follows-back' | 'does-not-follow-back' | 'unknown';
export type ActionStage = 'requested' | 'launched' | 'uncertain' | 'confirmed' | 'failed';
export type PilotActionRecord = {
  version: 1;
  action: 'follow' | 'unfollow';
  referenceId: string;
  agentId: string;
  stage: ActionStage;
  containerId?: string;
  proof: 'provider_unverified' | 'provider_completed_result';
};

const validId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const validAgent = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{10,25}$/.test(v);
export const validUsername = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9._]{1,30}$/.test(v);

export function makePilotAction(input: PilotActionRecord): PilotActionRecord | null {
  if (input.version !== 1 ||
      !['follow', 'unfollow'].includes(input.action) ||
      !validId(input.referenceId) || !validAgent(input.agentId) ||
      !['requested','launched','uncertain','confirmed','failed'].includes(input.stage) ||
      !['provider_unverified','provider_completed_result'].includes(input.proof) ||
      (input.stage === 'confirmed' && input.proof !== 'provider_completed_result') ||
      (input.stage !== 'confirmed' && input.proof !== 'provider_unverified') ||
      (input.containerId !== undefined &&
       (typeof input.containerId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(input.containerId))))
    return null;
  return { ...input };
}
export function parsePilotAction(raw: unknown): PilotActionRecord | null {
  if (typeof raw !== 'string' || raw.length > 700) return null;
  let input: unknown;
  try { input = JSON.parse(raw) as unknown; } catch { return null; }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(k => ![
    'version','action','referenceId','agentId','stage','containerId','proof',
  ].includes(k))) return null;
  return makePilotAction(data as PilotActionRecord);
}

/** No time passage can prove someone followed back or did not follow back. */
export function mayReviewUnfollow(input: {
  followConfirmedAt: Date | null;
  relationship: RelationshipProof;
  whitelisted: boolean;
  now: Date;
}): boolean {
  return input.followConfirmedAt instanceof Date &&
    Number.isFinite(input.followConfirmedAt.getTime()) &&
    Number.isFinite(input.now.getTime()) &&
    input.now.getTime() >= input.followConfirmedAt.getTime() +
      SOCIAL_PILOT_UNFOLLOW_AFTER_HOURS * 60 * 60 * 1000 &&
    input.relationship === 'does-not-follow-back' &&
    !input.whitelisted;
}
