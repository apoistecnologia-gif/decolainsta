#!/usr/bin/env node
/**
 * Reference accounts are labels chosen by the user, NOT a follower scraping API.
 * Operates locally. Can launch a read-only, manual Chrome inspection; never starts follow/unfollow.
 */
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateUsername } from './guard.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addReference } from './references.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '.data');
const file = path.join(dir, 'references.json');
const FORMAT = 'decolainsta-references-v1';

async function load() {
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (data.format !== FORMAT || !Array.isArray(data.references) ||
      data.references.some(r => !r || typeof r.username !== 'string' ||
          r.collectionStatus !== 'not_implemented')) {
    throw new Error('Arquivo de referências inválido. Nenhuma alteração foi efetuada.');
  }
  return data.references;
}

async function save(references) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, 'references.' + randomUUID() + '.tmp');
  try {
    await writeFile(temp, JSON.stringify({ format: FORMAT, references }, null, 2) + '\n', {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help') {
    console.log('Uso: npm run refs -- add perfil_referencia');
    console.log('     npm run refs -- list');
    console.log('     npm run refs -- inspect perfil_referencia');
    console.log('Este módulo NÃO lê a lista de seguidores e não executa ações.');
    return;
  }
  if (command === 'add') {
    if (args.length !== 1) throw new Error('Use: npm run refs -- add perfil_referencia');
    const original = await load();
    const result = addReference(original, args[0]);
    if (result.inserted) await save(result.references);
    console.log(result.inserted ? 'Referência cadastrada.' : 'Referência já cadastrada.');
    console.log('Perfil:', '@' + args[0].replace(/^@/, '').toLowerCase());
    console.log('Seguidores da referência: NÃO identificados.');
    console.log('A API oficial da Meta não fornece a lista de seguidores de outras contas.');
    return;
  }
  if (command === 'inspect') {
    if (args.length !== 1) throw new Error('Use: npm run refs -- inspect perfil_referencia');
    const username = validateUsername(args[0]).toLowerCase();
    const references = await load();
    if (!references.some(ref => ref.username === username)) {
      throw new Error('A referência não está cadastrada. Cadastre o @ antes de inspecionar.');
    }
    console.log('Inspeção de referência: @' + username);
    console.log('Somente visualização. Sem coleta de perfis e sem follows.');
    const result = spawnSync(process.execPath, [path.join(here, 'references-inspect.mjs'), username], {
      cwd: here, stdio: 'inherit', shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 2;
    return;
  }
  if (command === 'list') {
    if (args.length !== 0) throw new Error('list não aceita argumentos.');
    const references = await load();
    console.log('Contas de referência cadastradas:', references.length);
    for (const ref of references) {
      console.log('  @' + ref.username + ' | coleta de seguidores: não implementada');
    }
    return;
  }
  throw new Error('Comando desconhecido. Execute: npm run refs -- help');
}

main().catch(err => {
  console.error('Erro nas referências:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
