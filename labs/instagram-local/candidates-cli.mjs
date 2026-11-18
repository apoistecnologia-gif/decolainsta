#!/usr/bin/env node
/**
 * Local niche candidate management. No Instagram requests, clicks, scraping,
 * scheduling or automatic follows. Does not communicate with Vercel/Neon.
 */
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateUsername } from './guard.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCandidateCSV, importCandidates, reviewCandidates, reconcileObservations,
} from './candidates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.join(here, '.data');
const queuePath = path.join(dbDir, 'candidates.json');
const activityPath = path.join(here, 'results', 'activity.jsonl');
const FORMAT = 'decolainsta-candidates-v1';

async function loadQueue() {
  let text;
  try { text = await readFile(queuePath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const data = JSON.parse(text);
  if (data.format !== FORMAT || !Array.isArray(data.candidates) ||
      data.candidates.some(item => !item || typeof item.username !== 'string' ||
        !Array.isArray(item.history) || typeof item.status !== 'string')) {
    throw new Error('Fila local inválida. Verifique o arquivo .data/candidates.json.');
  }
  return data.candidates;
}

async function saveQueue(candidates) {
  await mkdir(dbDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dbDir, 'candidates.' + randomUUID() + '.tmp');
  try {
    await writeFile(tmp, JSON.stringify({ format: FORMAT, candidates }, null, 2) + '\n', {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    await rename(tmp, queuePath);
  } catch (error) {
    const { rm } = await import('node:fs/promises');
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function usage() {
  console.log('Uso (no laboratório local):');
  console.log('  npm run queue -- import caminho/arquivo.csv [--exclude seu_usuario]');
  console.log('  npm run queue -- add nome_do_perfil "Nicho" [perfil_referencia]');
  console.log('  npm run queue -- list [nicho]');
  console.log('  npm run queue -- next [nicho]');
  console.log('  npm run queue -- inspect-one [nicho]');
  console.log('  npm run queue -- follow-one [nicho]  (1 ação após confirmação)');
  console.log('  npm run queue -- sync');
  console.log('Importe candidatos fornecidos manualmente: username;nicho;origem.');
  console.log('Nenhum comando desta fila acessa ou modifica contas do Instagram.');
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help') { usage(); return; }
  const current = await loadQueue();
  if (command === 'import') {
    const [filename, ...options] = args;
    if (!filename) throw new Error('Informe o arquivo CSV.');
    const excluded = [];
    if (options.length) {
      if (options.length !== 2 || options[0] !== '--exclude') {
        throw new Error('Use apenas --exclude usuario, se necessário.');
      }
      excluded.push(options[1]);
    }
    const rows = parseCandidateCSV(await readFile(path.resolve(process.cwd(), filename), 'utf8'));
    const result = importCandidates(current, rows, excluded);
    if (result.inserted) await saveQueue(result.candidates);
    console.log('Importação local:', result.inserted, 'novos,', result.duplicate,
      'duplicados,', result.excluded, 'excluídos. Total:', result.candidates.length);
    console.log('A origem é referência informada por você; não prova que a conta segue aquele perfil.');
    return;
  }
  if (command === 'add') {
    if (args.length < 2 || args.length > 3) {
      throw new Error('Uso: npm run queue -- add nome_do_perfil "Nicho" [perfil_referencia]');
    }
    const [username, niche, source = ''] = args;
    const result = importCandidates(current, [{ username, nicho: niche, origem: source }]);
    if (result.inserted) await saveQueue(result.candidates);
    console.log('Cadastro local:', result.inserted ? 'perfil adicionado' : 'perfil já existente');
    console.log('A origem é referência manual; nenhum dado foi coletado do Instagram.');
    return;
  }
  if (command === 'inspect-one' || command === 'follow-one') {
    if (args.length > 1) throw new Error('Informe no máximo um nicho.');
    const candidate = reviewCandidates(current, args[0])[0];
    if (!candidate) { console.log('Nenhum candidato pendente para esse nicho.'); return; }
    const username = validateUsername(candidate.username);
    const operation = command === 'inspect-one' ? 'inspect' : 'follow';
    console.log('Candidato selecionado: @' + username + ' | nicho: ' + candidate.niche);
    console.log('Origem apenas informada, não verificada: ' + (candidate.source || '(nenhuma)'));
    console.log('Será executada no máximo UMA operação do laboratório local.');
    const result = spawnSync(process.execPath, [path.join(here, 'cli.mjs'), operation, username], {
      cwd: here, stdio: 'inherit', shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 2;
      console.log('Operação não confirmada. A fila não foi alterada.');
      return;
    }
    console.log('Verifique o Instagram. Para conciliar observações: npm run queue -- sync');
    return;
  }
  if (command === 'list' || command === 'next') {
    if (args.length > 1) throw new Error('Informe no máximo um nicho.');
    const pending = reviewCandidates(current, args[0]);
    console.log('Pendentes no nicho:', pending.length);
    const selected = command === 'next' ? pending.slice(0, 1) : pending.slice(0, 20);
    for (const item of selected) {
      console.log('  @' + item.username + ' | nicho: ' + item.niche +
        ' | origem informada: ' + (item.source ? '@' + item.source : 'não indicada'));
    }
    if (command === 'list' && pending.length > 20) console.log('Exibidos os primeiros 20.');
    if (command === 'next') console.log('Inspeção somente: npm run inspect -- nome_do_usuario');
    console.log('O comando não executou follow.');
    return;
  }
  if (command === 'sync') {
    if (args.length) throw new Error('sync não aceita argumentos.');
    let activity;
    try { activity = await readFile(activityPath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Nenhum histórico de laboratório encontrado.');
        return;
      }
      throw error;
    }
    const events = [];
    let malformed = 0;
    for (const line of activity.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        event.eventId = createHash('sha256').update(line).digest('hex');
        events.push(event);
      } catch { malformed++; }
    }
    const result = reconcileObservations(current, events);
    if (result.applied) await saveQueue(result.candidates);
    console.log('Histórico da interface importado:', result.applied,
      'novos registros,', result.ignored, 'ignorados,', malformed, 'linhas malformadas.');
    console.log('Esses registros não comprovam ganho de seguidores nem atribuição causal.');
    return;
  }
  throw new Error('Comando desconhecido. Use: npm run queue -- help');
}

run().catch(error => {
  console.error('Erro na fila local:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
