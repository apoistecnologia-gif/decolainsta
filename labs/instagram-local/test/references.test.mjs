import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeReference, addReference, validateManualReferenceCandidate } from '../references.mjs';

test('conta de referência usa apenas o @, sem nicho obrigatório', () => {
  assert.deepEqual(normalizeReference('@CartomanteGrande', '2026-11-18T00:00:00.000Z'), {
    username: 'cartomantegrande',
    addedAt: '2026-11-18T00:00:00.000Z',
    followerListSource: 'not_available_via_official_meta_api',
    followersIdentified: null,
    collectionStatus: 'not_implemented',
  });
});

test('não duplica referências e não confunde registro com seguidores identificados', () => {
  const one = addReference([], '@Referencia');
  assert.equal(one.inserted, true);
  assert.equal(one.references[0].followersIdentified, null);
  const twice = addReference(one.references, 'referencia');
  assert.equal(twice.inserted, false);
  assert.strictEqual(twice.references, one.references);
  assert.throws(() => addReference(one.references, 'https://instagram.com/algum'), /inválido/);
});

test('candidatos manuais NÃO são confirmados como seguidores da referência', () => {
  assert.deepEqual(validateManualReferenceCandidate('Interessado', '@Referencia'), {
    username: 'interessado',
    referenceUsername: 'referencia',
    relationship: 'unverified_manual_claim',
  });
  assert.throws(() => validateManualReferenceCandidate('referencia', '@Referencia'));
});

test('CLI de referências oferece cadastro/listagem e não tem scraping ou ação automática', () => {
  const base = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(base, '..', 'references-cli.mjs');
  const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /NÃO lê a lista de seguidores/);
  const invalid = spawnSync(process.execPath, [cli, 'scrape', 'referencia'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Comando desconhecido/);
});
