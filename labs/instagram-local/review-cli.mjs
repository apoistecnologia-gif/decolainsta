#!/usr/bin/env node
/** Manual-only review of verified single-action laboratory events. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildManualReviewQueue } from './review-plan.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
async function run(){
  const args=process.argv.slice(2);
  if (args.length !== 1 || !['24','72'].includes(args[0])) {
    throw new Error('Uso: npm run review -- 24  (ou 72)');
  }
  const file=path.join(here,'results','activity.jsonl');
  let raw;
  try{raw=await readFile(file,'utf8');}
  catch(error){
    if(error.code==='ENOENT'){
      console.log('Nenhum follow real registrado no laboratório.');
      return;
    }
    throw error;
  }
  const events=[];let ignored=0;
  for(const line of raw.split(/\r?\n/)){
    if(!line.trim())continue;
    try{events.push(JSON.parse(line));}catch{ignored++;}
  }
  const hours=Number(args[0]);
  const queue=buildManualReviewQueue(events,hours);
  const due=queue.filter(item=>item.status==='review_due');
  console.log('ACOMPANHAMENTO MANUAL DE FOLLOW ('+hours+' horas)');
  console.log('Perfis aguardando revisão:',queue.length,'| revisão vencida:',due.length);
  for(const item of queue.slice(0,20)){
    console.log(' @'+item.username+' | follow observado: '+item.followObservedAt+
      ' | revisar em: '+item.reviewDueAt+' | '+item.status);
  }
  if(queue.length>20)console.log('Exibidos os primeiros 20, sem executar ações.');
  if(ignored)console.log('Linhas inválidas ignoradas:',ignored);
  console.log('Nenhuma ação agendada ou executada. Prazo é lembrete, NÃO permissão para desfazer follow.');
  console.log('Followback não verificado. Verifique manualmente antes de decidir qualquer unfollow.');
}
run().catch(error=>{console.error('Falha:',error.message);process.exitCode=1;});
