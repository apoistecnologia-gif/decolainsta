/**
 * An existing owner may be selected as the FIRST operator only via an
 * explicit offline process with access to the database AND their existing
 * account password. Never infer ownership from being the only registered user.
 * This policy performs no writes and exposes no user or credential data.
 */
export const FIRST_OPERATOR_CONFIRMATION =
  'AUTHORIZE_VERIFIED_EXISTING_OWNER_AS_FIRST_OPERATOR';

export type FirstOperatorSnapshot = {
  requestedEmail: string;
  knownUserCount: number;
  adminCount: number;
  candidate: {
    email: string;
    role: string;
    hasPasswordHash: boolean;
  } | null;
};

export function eligibleFirstOperator(snapshot: FirstOperatorSnapshot): boolean {
  const email = snapshot.requestedEmail.trim().toLowerCase();
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) ||
      email.length > 254 || snapshot.knownUserCount !== 1 ||
      snapshot.adminCount !== 0 || !snapshot.candidate ||
      snapshot.candidate.email.trim().toLowerCase() !== email ||
      snapshot.candidate.role !== 'user' ||
      snapshot.candidate.hasPasswordHash !== true)
    return false;
  return true;
}

export function explicitFirstOperatorApproval(
  mode: string | undefined,
  confirmation: string | undefined,
  providerEnvironment: string | undefined,
): boolean {
  if (mode === 'check') return true;
  return mode === 'apply' &&
    confirmation === FIRST_OPERATOR_CONFIRMATION &&
    providerEnvironment !== 'production';
}
