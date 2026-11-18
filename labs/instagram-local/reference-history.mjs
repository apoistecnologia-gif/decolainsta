import { createHmac } from 'node:crypto';
import { validateUsername } from './guard.mjs';

export const REFERENCE_HISTORY_FORMAT = 'decolainsta-reference-history-v1';
export const MAX_OBSERVATIONS = 100;
export const MAX_IDENTIFIERS = 500;
const PROVENANCE = 'manually_opened_dialog_user_confirmed';
const DECLARATION = 'manual_report_from_previous_check';

export function newReferenceHistory() {
  return { format: REFERENCE_HISTORY_FORMAT, references: {} };
}

function cleanReference(reference) {
  return validateUsername(reference).toLowerCase();
}

function verifyHistory(history) {
  if (!history || history.format !== REFERENCE_HISTORY_FORMAT ||
      !history.references || typeof history.references !== 'object' ||
      Array.isArray(history.references) ||
      Object.values(history.references).some(r => !r || typeof r !== 'object' ||
        !Array.isArray(r.visits) || !Array.isArray(r.fingerprints) ||
        r.fingerprints.length > MAX_IDENTIFIERS || r.visits.length > MAX_OBSERVATIONS ||
        !r.fingerprints.every(fp => /^[a-f0-9]{64}$/.test(fp)))) {
    throw new Error('Histórico inválido: não sobrescrever arquivo desconhecido.');
  }
}

export function summarizeReferenceHistory(history, reference) {
  verifyHistory(history);
  const key = cleanReference(reference);
  const record = history.references[key];
  if (!record) return {
    reference: key, inspections: 0, distinctObserved: 0, manuallyReported: 0,
    repeatedSeen: 0, firstSeen: null, lastSeen: null,
  };
  return {
    reference: key,
    inspections: record.visits.length,
    distinctObserved: record.fingerprints.length,
    manuallyReported: record.visits.filter(v => v.provenance === DECLARATION)
      .reduce((total, v) => total + v.sampleSize, 0),
    repeatedSeen: record.visits.reduce((total, v) => total + (v.repeated ?? 0), 0),
    firstSeen: record.visits[0]?.observedAt ?? null,
    lastSeen: record.visits.at(-1)?.observedAt ?? null,
  };
}

function validateTimestamp(timestamp) {
  if (typeof timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
      !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('Data inválida.');
  }
  return timestamp;
}

function recordVisit(history, reference, visit, newFingerprintValues = []) {
  verifyHistory(history);
  const key = cleanReference(reference);
  const next = structuredClone(history);
  const current = next.references[key] ?? { fingerprints: [], visits: [] };
  if (current.visits.length >= MAX_OBSERVATIONS ||
      current.fingerprints.length + newFingerprintValues.length > MAX_IDENTIFIERS) {
    throw new Error('Limite de histórico local atingido. Exporte ou apague antes de prosseguir.');
  }
  current.visits.push(visit);
  current.fingerprints.push(...newFingerprintValues);
  next.references[key] = current;
  return {
    history: next, visit, summary: summarizeReferenceHistory(next, key),
  };
}

export function recordDeclaredCheck(history, reference, count,
  observedAt = new Date().toISOString()) {
  if (!Number.isInteger(count) || count < 0 || count > 5) {
    throw new Error('Informe um número entre 0 e 5 para a amostra declarada.');
  }
  validateTimestamp(observedAt);
  // A declared past observation contains NO usernames or pseudonymous IDs.
  // It does not increase the distinct-observed count.
  return recordVisit(history, reference, {
    observedAt, provenance: DECLARATION, sampleSize: count,
    uniqueNew: null, repeated: null, crossReferenceOverlap: null,
    completeList: false,
  });
}

export function recordConfirmedVisibleSample(history, reference, usernames, hmacSecret,
  observedAt = new Date().toISOString()) {
  verifyHistory(history);
  const key = cleanReference(reference);
  validateTimestamp(observedAt);
  if (!Array.isArray(usernames) || usernames.length < 1 || usernames.length > 5) {
    throw new Error('Amostra deve conter entre 1 e 5 perfis visíveis.');
  }
  if (!Buffer.isBuffer(hmacSecret) || hmacSecret.length !== 32) {
    throw new Error('Segredo local HMAC não disponível ou inválido.');
  }
  const handles = usernames.map(handle => validateUsername(handle).toLowerCase());
  if (handles.some(handle => handle === key) ||
      new Set(handles).size !== handles.length) {
    throw new Error('Amostra contém duplicatas ou a própria referência.');
  }
  const fingerprints = handles.map(handle =>
    createHmac('sha256', hmacSecret).update(handle).digest('hex'));
  const ownSeen = new Set(history.references[key]?.fingerprints ?? []);
  const otherSeen = new Set(Object.entries(history.references)
    .filter(([otherKey]) => otherKey !== key)
    .flatMap(([, r]) => r.fingerprints));
  const newIds = fingerprints.filter(fp => !ownSeen.has(fp));
  const repeated = fingerprints.length - newIds.length;
  const crossReferenceOverlap = fingerprints.filter(fp => otherSeen.has(fp)).length;
  const visit = {
    observedAt, provenance: PROVENANCE, sampleSize: usernames.length,
    uniqueNew: newIds.length, repeated, crossReferenceOverlap,
    completeList: false,
  };
  return recordVisit(history, key, visit, newIds);
}
