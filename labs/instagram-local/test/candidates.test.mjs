import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCandidateCSV, normalizeCandidate, importCandidates,
  reviewCandidates, reconcileObservations, MAX_IMPORT_ROWS,
} from '../candidates.mjs';

test('CSV pt-BR com BOM, CRLF, aspas e ponto-e-vírgula', () => {
  const data = parseCandidateCSV('\uFEFFusername;nicho;origem\r\n"Perfil.Teste";"Espiritualidade";"referencia.teste"\r\noutro;Beleza;\r\n');
  assert.equal(data.length, 2);
  assert.equal(data[0].username, 'Perfil.Teste');
  assert.equal(data[0].nicho, 'Espiritualidade');
  assert.equal(data[1].origem, '');
  const normalized = normalizeCandidate(data[0], '2026-11-18T00:00:00.000Z');
  assert.equal(normalized.username, 'perfil.teste');
  assert.equal(normalized.source, 'referencia.teste');
  assert.equal(normalized.status, 'pending');
  assert.equal(normalized.provenance, 'manual_import_unverified');
});

test('CSV vírgula suporta campo de nicho entre aspas', () => {
  const rows = parseCandidateCSV('username,nicho,origem\nalvo,"Moda, roupas",perfilbase\n');
  assert.equal(rows[0].nicho, 'Moda, roupas');
});

test('arquivo sem cabeçalho válido, aspas quebradas ou colunas diferentes é rejeitado', () => {
  for (const text of [
    'usuario;nicho;origem\nalvo;beleza;outro',
    'username;nicho;origem\n"alvo;beleza;outro',
    'username;nicho;origem\nalvo;beleza',
    'username;nicho;origem\n',
    'username;username;origem\nalvo;beleza;outro',
  ]) assert.throws(() => parseCandidateCSV(text));
  const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => 'a' + i + ';nicho;');
  assert.throws(() => parseCandidateCSV('username;nicho;origem\n' + rows.join('\n')));
});

test('importação deduplica sem alterar o estado existente e permite excluir a própria conta', () => {
  const old = normalizeCandidate({ username: 'Alvo', nicho: 'antigo', origem: '' });
  old.status = 'follow_observed';
  old.history = [{ eventId: 'x' }];
  const rows = parseCandidateCSV(
    'username;nicho;origem\n@ALVO;novo;ref1\nNOVO;Beleza;ref1\nnovo;Beleza;ref1\nconta.propria;Beleza;\n',
  );
  const result = importCandidates([old], rows, ['CONTA.PROPRIA']);
  assert.deepEqual([result.inserted, result.duplicate, result.excluded], [1, 2, 1]);
  assert.equal(result.candidates.length, 2);
  assert.strictEqual(result.candidates[0], old);
  assert.equal(result.candidates[0].status, 'follow_observed');
  assert.equal(result.candidates[1].username, 'novo');
  assert.equal(reviewCandidates(result.candidates, 'beleza').length, 1);
  assert.equal(reviewCandidates(result.candidates, 'espiritualidade').length, 0);
});

test('importação inválida falha de forma atômica sem mutar registros antigos', () => {
  const old = normalizeCandidate({ username: 'existente', nicho: 'geral', origem: '' });
  const current = [old];
  assert.throws(() => importCandidates(current, [
    { username: 'valido', nicho: 'Beleza', origem: '' },
    { username: 'https://site.invalid/foo', nicho: 'Beleza', origem: '' },
  ]), /Linha 3/);
  assert.equal(current.length, 1);
  assert.equal(old.status, 'pending');
  assert.throws(() => normalizeCandidate({ username: 'x', nicho: '', origem: '' }));
});

test('sincronização apenas de ações reais observadas na interface, sem inventar seguidores', () => {
  const items = importCandidates([], parseCandidateCSV(
    'username;nicho;origem\nperfil.teste;Espiritualidade;ref',
  )).candidates;
  const timestamp = '2026-11-18T13:00:00.000Z';
  const events = [
    { eventId: 'sim', username: 'perfil.teste', action: 'follow', status: 'following_confirmed', realActions: 0, timestamp },
    { eventId: 'amb', username: 'perfil.teste', action: 'follow', status: 'unverified', realActions: 'unknown', timestamp },
    { eventId: 'real1', username: 'PERFIL.TESTE', action: 'follow', status: 'following_confirmed', realActions: 1, timestamp },
    { eventId: 'real1', username: 'perfil.teste', action: 'follow', status: 'following_confirmed', realActions: 1, timestamp },
  ];
  const first = reconcileObservations(items, events);
  assert.equal(first.applied, 1);
  assert.equal(first.ignored, 3);
  assert.equal(first.candidates[0].status, 'follow_observed');
  assert.equal(first.candidates[0].history.length, 1);
  assert.equal(reviewCandidates(first.candidates).length, 0);
  assert.equal(items[0].status, 'pending');
  const second = reconcileObservations(first.candidates, events);
  assert.equal(second.applied, 0);
  const after = reconcileObservations(first.candidates, [
    { eventId: 'real2', username: 'perfil.teste', action: 'unfollow', status: 'unfollow_confirmed', realActions: 1, timestamp },
  ]);
  assert.equal(after.applied, 1);
  assert.equal(after.candidates[0].status, 'unfollow_observed');
  assert.equal(after.candidates[0].history.length, 2);
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

test('CLI da fila aceita help e rejeita ações em lote sem abrir Chrome', () => {
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../candidates-cli.mjs');
  const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /inspect-one/);
  assert.match(help.stdout, /follow-one/);
  const invalid = spawnSync(process.execPath, [cli, 'inspect-one', 'beleza', 'extra'], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /no máximo um nicho/);

  // Static check: the only bridge to Instagram is the preexisting single-action
  // CLI, never a queue loop or a shell command assembled from usernames.
  const source = readFileSync(cli, 'utf8');
  assert.match(source, /spawnSync\(process\.execPath/);
  assert.match(source, /shell: false/);
  assert.match(source, /command === 'inspect-one' \|\| command === 'follow-one'/);
  assert.doesNotMatch(source, /for\s*\([^)]*candidate[^)]*\)\s*\{[^}]*spawnSync/s);
});
