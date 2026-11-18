import { validateUsername } from './guard.mjs';

export const MAX_IMPORT_ROWS = 2000;

/** Parse UTF-8 CSV with quoted cells and Excel-style semicolon separators. */
export function parseCandidateCSV(text) {
  if (typeof text !== 'string') throw new Error('Arquivo CSV inválido.');
  if (Buffer.byteLength(text, 'utf8') > 512 * 1024) throw new Error('CSV muito grande (máximo 512 KB).');
  const clean = text.replace(/^\uFEFF/, '');
  const header = clean.split(/\r?\n/, 1)[0] ?? '';
  const separator = (header.match(/;/g) ?? []).length >= (header.match(/,/g) ?? []).length ? ';' : ',';
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === separator) {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('CSV contém aspas não fechadas.');
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV precisa de cabeçalho e pelo menos uma linha.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error('Importação limitada a ' + MAX_IMPORT_ROWS + ' linhas.');
  const names = rows.shift().map(v => v.trim().toLowerCase());
  if (new Set(names).size !== names.length || names.length !== 3 ||
      !['username', 'nicho', 'origem'].every(name => names.includes(name))) {
    throw new Error('Cabeçalho obrigatório: username;nicho;origem (ou separado por vírgulas).');
  }
  return rows.map((cells, index) => {
    if (cells.length !== names.length) throw new Error('Linha ' + (index + 2) + ': número incorreto de colunas.');
    return Object.fromEntries(names.map((name, i) => [name, cells[i]]));
  });
}

export function normalizeCandidate(row, now = new Date().toISOString()) {
  const username = validateUsername(row.username).toLowerCase();
  const niche = (row.nicho ?? '').trim().replace(/\s+/g, ' ');
  if (!niche || niche.length > 70 || /[\x00-\x1F\x7F<>]/.test(niche)) {
    throw new Error('Nicho inválido: obrigatório, até 70 caracteres.');
  }
  let source = null;
  if ((row.origem ?? '').trim()) source = validateUsername(row.origem).toLowerCase();
  if (username === source) throw new Error('A origem não pode ser o próprio candidato.');
  return {
    username, niche, source, status: 'pending',
    provenance: 'manual_import_unverified', createdAt: now, history: [],
  };
}

export function importCandidates(current, rows, excludeUsernames = []) {
  if (!Array.isArray(current) || !Array.isArray(rows)) throw new Error('Fila inválida.');
  const excluded = new Set(excludeUsernames.map(name => validateUsername(name).toLowerCase()));
  const byName = new Set(current.map(candidate => candidate.username.toLowerCase()));
  let inserted = 0, duplicate = 0, excludedCount = 0;
  const next = [...current];
  const now = new Date().toISOString();
  // Validate all rows BEFORE modifying queue data.
  const normalized = rows.map((row, index) => {
    try { return normalizeCandidate(row, now); }
    catch (error) { throw new Error('Linha ' + (index + 2) + ': ' + error.message); }
  });
  for (const candidate of normalized) {
    if (excluded.has(candidate.username)) { excludedCount++; continue; }
    if (byName.has(candidate.username)) { duplicate++; continue; }
    byName.add(candidate.username);
    next.push(candidate);
    inserted++;
  }
  return { candidates: next, inserted, duplicate, excluded: excludedCount };
}

export function reviewCandidates(candidates, niche) {
  const normalizedNiche = (niche ?? '').trim().toLocaleLowerCase('pt-BR');
  return candidates.filter(candidate =>
    candidate.status === 'pending' &&
    (!normalizedNiche || candidate.niche.toLocaleLowerCase('pt-BR') === normalizedNiche)
  );
}

const OBSERVATIONS = Object.freeze({
  'follow:following_confirmed': 'follow_observed',
  'follow:request_submitted': 'request_observed',
  'unfollow:unfollow_confirmed': 'unfollow_observed',
});

/** Sync only confirmed local lab UI events; never simulated engine counters. */
export function reconcileObservations(candidates, events) {
  const next = structuredClone(candidates);
  const index = new Map(next.map(candidate => [candidate.username, candidate]));
  let applied = 0, ignored = 0;
  for (const event of events) {
    const username = typeof event.username === 'string' ? event.username.toLowerCase() : '';
    const candidate = index.get(username);
    const status = OBSERVATIONS[event.action + ':' + event.status];
    const id = event.eventId;
    if (!candidate || !status || !id || typeof id !== 'string' ||
        !Number.isFinite(Date.parse(event.timestamp ?? ''))) { ignored++; continue; }
    if (event.action === 'follow' && event.status === 'following_confirmed' && event.realActions !== 1) {
      ignored++; continue;
    }
    if (event.action === 'unfollow' && event.realActions !== 1) { ignored++; continue; }
    if (candidate.history.some(entry => entry.eventId === id)) { ignored++; continue; }
    candidate.history.push({
      eventId: id, action: event.action, observation: event.status,
      observedAt: event.timestamp, provenance: 'local_lab_ui',
    });
    candidate.status = status;
    applied++;
  }
  return { candidates: next, applied, ignored };
}
