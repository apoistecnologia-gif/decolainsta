import { validateUsername } from './guard.mjs';

/**
 * A reference account is the source selected by the user, not a topic or
 * category. Registration does not establish who follows that reference.
 */
export function normalizeReference(value, now = new Date().toISOString()) {
  const username = validateUsername(value).toLowerCase();
  return {
    username,
    addedAt: now,
    followerListSource: 'not_available_via_official_meta_api',
    followersIdentified: null,
    collectionStatus: 'not_implemented',
  };
}

export function addReference(current, value) {
  if (!Array.isArray(current)) throw new Error('Cadastro de referências inválido.');
  const item = normalizeReference(value);
  if (current.some(old => old.username.toLowerCase() === item.username)) {
    return { references: current, inserted: false };
  }
  return { references: [...current, item], inserted: true };
}

export function validateManualReferenceCandidate(candidate, reference) {
  const username = validateUsername(candidate).toLowerCase();
  const referenceUsername = validateUsername(reference).toLowerCase();
  if (username === referenceUsername) {
    throw new Error('O candidato não pode ser a própria conta de referência.');
  }
  return {
    username,
    referenceUsername,
    relationship: 'unverified_manual_claim',
  };
}
