import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_HISTORY_FORMAT, newReferenceHistory, recordConfirmedVisibleSample,
  recordDeclaredCheck, summarizeReferenceHistory, forgetReferenceHistory,
} from './reference-history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '.data');
const filename = path.join(dir, 'reference-history.json');
const keyFile = path.join(dir, 'reference-history-hmac.key');

export async function loadReferenceHistory() {
  let raw;
  try { raw = await readFile(filename, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return newReferenceHistory();
    throw error;
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Arquivo reference-history.json corrompido. Não sobrescrever.'); }
  if (parsed.format !== REFERENCE_HISTORY_FORMAT ||
      !parsed.references || typeof parsed.references !== 'object' ||
      Array.isArray(parsed.references)) {
    throw new Error('Histórico não reconhecido. Nenhuma alteração realizada.');
  }
  // Validate entries before reading the report or making any write.
  for (const reference of Object.keys(parsed.references)) {
    summarizeReferenceHistory(parsed, reference);
  }
  return parsed;
}

async function getOrCreateLocalKey() {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let key;
  try { key = await readFile(keyFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Exclusive create prevents silently replacing an existing key.
    try {
      const created = randomBytes(32);
      await writeFile(keyFile, created, { mode: 0o600, flag: 'wx' });
    } catch (createError) {
      if (createError.code !== 'EEXIST') throw createError;
    }
    key = await readFile(keyFile);
  }
  if (key.length !== 32) {
    throw new Error('Chave local inválida. Não sobrescrever; preserve o histórico.');
  }
  return key;
}

async function saveHistory(history) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, 'reference-history.' + randomUUID() + '.tmp');
  try {
    await writeFile(tmp, JSON.stringify(history, null, 2) + '\n', {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    await rename(tmp, filename);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function saveDeclaredCheck(reference, sampleCount) {
  const previous = await loadReferenceHistory();
  const result = recordDeclaredCheck(previous, reference, sampleCount);
  await saveHistory(result.history);
  return result;
}

export async function saveConfirmedSample(reference, usernames) {
  const previous = await loadReferenceHistory();
  const secret = await getOrCreateLocalKey();
  const result = recordConfirmedVisibleSample(previous, reference, usernames, secret);
  await saveHistory(result.history);
  return result;
}

export async function getReferenceHistoryReport(reference) {
  const history = await loadReferenceHistory();
  const summary = summarizeReferenceHistory(history, reference);
  const visits = (history.references[summary.reference]?.visits ?? []).slice(-10);
  return { summary, visits };
}

export async function clearReferenceHistory(reference) {
  const history = await loadReferenceHistory();
  const result = forgetReferenceHistory(history, reference);
  if (result.deleted) await saveHistory(result.history);
  return result.deleted;
}
