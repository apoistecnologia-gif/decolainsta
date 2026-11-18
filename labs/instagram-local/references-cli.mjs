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
import { getReferenceHistoryReport, saveDeclaredCheck, clearReferenceHistory } from './reference-history-store.mjs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

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
    console.log('     npm run refs -- inspect-visible perfil_referencia');
    console.log('     npm run refs -- inspect-track perfil_referencia');
    console.log('     npm run refs -- note perfil_referencia 5');
    console.log('     npm run refs -- report perfil_referencia');
    console.log('     npm run refs -- export-report perfil_referencia');
    console.log('     npm run refs -- forget perfil_referencia');
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
  if (['inspect', 'inspect-visible', 'inspect-track'].includes(command)) {
    if (args.length !== 1) throw new Error('Use: npm run refs -- ' + command + ' perfil_referencia');
    const username = validateUsername(args[0]).toLowerCase();
    const references = await load();
    if (!references.some(ref => ref.username === username)) {
      throw new Error('A referência não está cadastrada. Cadastre o @ antes de inspecionar.');
    }
    console.log('Inspeção de referência: @' + username);
    console.log(command === 'inspect-track'
      ? 'Inspeção de até 5 @ visíveis; só salva fingerprints após confirmação no PowerShell.'
      : command === 'inspect-visible'
        ? 'Diagnóstico: até 5 @ atualmente visíveis, apenas no terminal. Sem rolar, salvar ou seguir.'
        : 'Somente visualização. Sem coleta de perfis e sem follows.');
    const argsForInspection = [
      path.join(here, 'references-inspect.mjs'), username,
      ...(command === 'inspect-visible' ? ['--visible-sample'] : []),
      ...(command === 'inspect-track' ? ['--record-confirmed'] : []),
    ];
    const result = spawnSync(process.execPath, argsForInspection, {
      cwd: here, stdio: 'inherit', shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 2;
    return;
  }
  if (command === 'note') {
    if (args.length !== 2) {
      throw new Error('Use: npm run refs -- note perfil_referencia numero_entre_0_e_5');
    }
    const username = validateUsername(args[0]).toLowerCase();
    if (!/^[0-5]$/.test(args[1])) throw new Error('A contagem deve ser de 0 a 5.');
    const references = await load();
    if (!references.some(ref => ref.username === username)) {
      throw new Error('Cadastre a referência antes de registrar a verificação.');
    }
    const result = await saveDeclaredCheck(username, Number(args[1]));
    console.log('Anotação local salva: ' + result.visit.sampleSize + ' perfis conferidos manualmente.');
    console.log('Somente número informado: não foram guardados @ nem fingerprints.');
    console.log('Este registro NÃO comprova total de seguidores ou resultados de follow.');
    return;
  }
  if (command === 'report') {
    if (args.length !== 1) throw new Error('Use: npm run refs -- report perfil_referencia');
    const username = validateUsername(args[0]).toLowerCase();
    const references = await load();
    if (!references.some(ref => ref.username === username)) {
      throw new Error('Referência não cadastrada.');
    }
    const { summary, visits } = await getReferenceHistoryReport(username);
    console.log('HISTÓRICO LOCAL @' + username + ' (amostras manuais, NÃO lista completa)');
    console.log('Verificações registradas:', summary.inspections);
    console.log('Perfis distintos observados em amostras com HMAC:', summary.distinctObserved);
    console.log('Contagem declarada de testes passados (sem deduplicação):', summary.manuallyReported);
    console.log('Repetições reconhecidas nas amostras registradas:', summary.repeatedSeen);
    console.log('Última verificação:', summary.lastSeen ?? 'nenhuma');
    for (const visit of visits) {
      console.log('  ' + visit.observedAt + ' | ' +
        (visit.provenance === 'manual_report_from_previous_check'
          ? 'declarado manualmente: ' + visit.sampleSize
          : 'janela confirmada: ' + visit.sampleSize + ', novos: ' + visit.uniqueNew +
            ', repetidos: ' + visit.repeated +
            ', vistos em outras referências: ' + visit.crossReferenceOverlap));
    }
    console.log('Nenhum @ individual é exibido ou armazenado em texto claro.');
    console.log('Nenhum resultado de followback é inferido dessas verificações.');
    return;
  }
  if (command === 'export-report') {
    if (args.length !== 1) throw new Error('Uso: npm run refs -- export-report perfil_referencia');
    const username = validateUsername(args[0]).toLowerCase();
    const references = await load();
    if (!references.some(ref => ref.username === username)) throw new Error('Referência não cadastrada.');
    const { summary, visits } = await getReferenceHistoryReport(username);
    const payload = {
      format: 'decolainsta-reference-aggregate-v1',
      reference: username,
      generatedAt: new Date().toISOString(),
      source: 'manual_lab_aggregate',
      verifiedFollowerList: false,
      followbackVerified: false,
      summary: {
        inspections: summary.inspections,
        distinctObserved: summary.distinctObserved,
        manuallyReported: summary.manuallyReported,
        repeatedSeen: summary.repeatedSeen,
        lastSeen: summary.lastSeen,
      },
      visits: visits.map(v => ({
        observedAt: v.observedAt,
        source: v.provenance,
        sampleSize: v.sampleSize,
        uniqueNew: v.uniqueNew,
        repeated: v.repeated,
        crossReferenceOverlap: v.crossReferenceOverlap,
      })),
    };
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const reportName = 'resumo-' + username + '-' + randomUUID().slice(0,8) + '.json';
    const destination = path.join(dir, reportName);
    await writeFile(destination, JSON.stringify(payload, null, 2) + '\n', {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    console.log('Relatório agregado exportado:', destination);
    console.log('Não contém seguidores individuais, fingerprints HMAC, cookies ou senhas.');
    console.log('Importe este arquivo manualmente no painel de referências do Preview.');
    return;
  }
  if (command === 'forget') {
    if (args.length !== 1) throw new Error('Use: npm run refs -- forget perfil_referencia');
    const username = validateUsername(args[0]).toLowerCase();
    const rl = createInterface({ input, output });
    let answer;
    try {
      answer = await rl.question('Para APAGAR todo histórico da referência @' + username +
        ' (sem excluir o cadastro), digite exatamente "APAGAR @' + username + '": ');
    } finally {
      rl.close();
    }
    if (answer.trim() !== 'APAGAR @' + username) {
      console.log('Cancelado. Nenhuma alteração realizada.');
      return;
    }
    const deleted = await clearReferenceHistory(username);
    console.log(deleted ? 'Histórico local apagado.' : 'Nenhum histórico local encontrado.');
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
