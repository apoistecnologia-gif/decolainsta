import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  REFERENCE_HISTORY_FORMAT, newReferenceHistory,
  recordDeclaredCheck, recordConfirmedVisibleSample, summarizeReferenceHistory,
} from '../reference-history.mjs';

const FIXED_TIME = '2026-11-18T15:00:00.000Z';
const KEY = Buffer.alloc(32, 7);

test('histórico vazio com formato próprio não inventa seguidores ou verificações', () => {
  const empty = newReferenceHistory();
  assert.equal(empty.format, REFERENCE_HISTORY_FORMAT);
  assert.deepEqual(summarizeReferenceHistory(empty, 'referencia_a'), {
    reference: 'referencia_a', inspections: 0, distinctObserved: 0,
    manuallyReported: 0, repeatedSeen: 0, firstSeen: null, lastSeen: null,
  });
});

test('contagem declarada de verificação anterior não grava arrobas, HMAC ou falsos únicos', () => {
  const previous = newReferenceHistory();
  const saved = recordDeclaredCheck(previous, '@referencia_a', 5, FIXED_TIME);
  assert.deepEqual(previous.references, {});
  assert.equal(saved.visit.provenance, 'manual_report_from_previous_check');
  assert.equal(saved.visit.completeList, false);
  assert.equal(saved.summary.inspections, 1);
  assert.equal(saved.summary.distinctObserved, 0);
  assert.equal(saved.summary.manuallyReported, 5);
  assert.equal(saved.summary.repeatedSeen, 0);
  assert.deepEqual(saved.history.references.referencia_a.fingerprints, []);
});

test('HMAC protege nomes em texto claro, evita duplicatas e contabiliza visitas', () => {
  const first = recordConfirmedVisibleSample(
    newReferenceHistory(), 'referencia_a',
    ['pessoa_a', 'pessoa_b', 'pessoa_c'], KEY, FIXED_TIME,
  );
  assert.equal(first.visit.sampleSize, 3);
  assert.equal(first.visit.uniqueNew, 3);
  assert.equal(first.visit.repeated, 0);
  assert.equal(first.visit.completeList, false);
  assert.equal(first.visit.provenance, 'manually_opened_dialog_user_confirmed');
  const serialized = JSON.stringify(first.history);
  assert.doesNotMatch(serialized, /pessoa_a|pessoa_b|pessoa_c/);
  assert.match(serialized, /[a-f0-9]{64}/);
  assert.equal(first.summary.distinctObserved, 3);

  const again = recordConfirmedVisibleSample(first.history, 'REFERENCIA_A', [
    'PESSOA_A', 'pessoa_c', 'pessoa_d',
  ], KEY, '2026-11-19T15:00:00.000Z');
  assert.deepEqual([again.visit.uniqueNew, again.visit.repeated], [1, 2]);
  assert.equal(again.summary.inspections, 2);
  assert.equal(again.summary.distinctObserved, 4);
  assert.equal(again.summary.repeatedSeen, 2);
  assert.equal(first.summary.distinctObserved, 3);
});

test('mesmo perfil em referências diferentes gera métrica de coincidência, não relação inventada', () => {
  const first = recordConfirmedVisibleSample(
    newReferenceHistory(), 'ref_um', ['pessoa_a', 'pessoa_b'], KEY, FIXED_TIME,
  );
  const other = recordConfirmedVisibleSample(
    first.history, 'ref_dois', ['pessoa_b', 'pessoa_c'], KEY,
    '2026-11-19T15:00:00.000Z',
  );
  assert.equal(other.visit.crossReferenceOverlap, 1);
  assert.equal(other.visit.uniqueNew, 2);
  assert.equal(other.summary.distinctObserved, 2);
  assert.equal(other.history.references.ref_um.fingerprints.length, 2);
  assert.equal(Object.keys(other.history.references).length, 2);
});

test('histórico falha fechado para entrada inválida, amostra grande e chave incorreta', () => {
  const initial = newReferenceHistory();
  for (const invalid of [-1, 6, 1.5, '5']) {
    assert.throws(() => recordDeclaredCheck(initial, 'referencia_a', invalid));
  }
  assert.throws(() => recordConfirmedVisibleSample(initial, 'referencia_a', [], KEY));
  assert.throws(() => recordConfirmedVisibleSample(
    initial, 'referencia_a', Array(6).fill('falso'), KEY,
  ));
  assert.throws(() => recordConfirmedVisibleSample(
    initial, 'referencia_a', ['perfil_a', 'PERFIL_A'], KEY,
  ));
  assert.throws(() => recordConfirmedVisibleSample(
    initial, 'referencia_a', ['referencia_a'], KEY,
  ));
  assert.throws(() => recordConfirmedVisibleSample(
    initial, 'referencia_a', ['perfil_a'], randomBytes(8),
  ));
  assert.throws(() => recordDeclaredCheck(initial, 'referencia_a', 1, 'data'));
  assert.throws(() => summarizeReferenceHistory({ references: {} }, 'referencia_a'));
});

test('limita número de inspeções para evitar crescimento ilimitado do arquivo local', () => {
  let history = newReferenceHistory();
  for (let i = 0; i < 100; i++) {
    history = recordDeclaredCheck(history, 'referencia_a', 1, FIXED_TIME).history;
  }
  assert.equal(summarizeReferenceHistory(history, 'referencia_a').inspections, 100);
  assert.throws(() => recordDeclaredCheck(history, 'referencia_a', 1, FIXED_TIME), /Limite/);
});

test('comando local de histórico exige referência e não inicia Chrome ou ações', () => {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(base, '..', 'references-cli.mjs');
  const help = spawnSync(process.execPath, [cli, 'help'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /inspect-track/);
  assert.match(help.stdout, /refs -- note/);
  assert.match(help.stdout, /refs -- report/);
  const bad = spawnSync(process.execPath, [cli, 'note', 'referencia_a', '999'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /contagem deve ser de 0 a 5/);
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /--record-confirmed/);
  assert.match(source, /saveDeclaredCheck/);
  assert.match(source, /getReferenceHistoryReport/);
  assert.doesNotMatch(source, /https:\/\/api\.instagram\.com|fetch\(/);
});

test('modo de acompanhamento só persiste após a confirmação digitada do usuário', () => {
  const inspector = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'references-inspect.mjs'),
    'utf8',
  );
  assert.match(inspector, /const expected = 'REGISTRAR @'/);
  assert.match(inspector, /answer\.trim\(\) === expected/);
  assert.match(inspector, /saveConfirmedSample\(username, sample\)/);
  assert.doesNotMatch(inspector, /page\.click\(|\.mouse\.wheel\(|\.scroll\(/);
});
