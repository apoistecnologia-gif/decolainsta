'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';

/**
 * Account-scoped pilot control. No PhantomBuster agent ID, session cookie, URL
 * or follower is supplied by the browser. The server selects registered refs.
 * A user authorizes the first run with one click; subsequent runs advance
 * sequentially while the page remains open.
 */
type Queue={
  enabled:boolean;accountId:string;total:number;attempted:number;
  completed:number;unverified:number;nextReference:string|null;
  unresolved:boolean;currentState:string;
  canAdvance:boolean;blocker:string|null;providerStatus:string|null;
  activeContainerStatus?:string|null;activeContainerReason?:string|null;
};
type Advance={status:string;reference?:string;observedNames?:number;providerStatus?:string;providerReason?:string};
export function DynamicCollectorControl({accountId,onIndexed}:{
  accountId:string;onIndexed?:()=>void;
}){
  const [queue,setQueue]=useState<Queue|null>(null);
  const [running,setRunning]=useState(false);
  const [message,setMessage]=useState('');
  const [diagnostic,setDiagnostic]=useState('Verificando disponibilidade da coleta...');
  const proofExplanations:Record<string,string>={
    'still-running':'O contêiner está em execução no PhantomBuster.',
    'invalid-input':'Identificadores inconsistentes; revisão técnica necessária.',
    'container-unavailable':'O PhantomBuster não respondeu à consulta deste contêiner.',
    'wrong-container':'O PhantomBuster retornou outro identificador de contêiner.',
    'wrong-agent':'O contêiner pertence a outro agente do PhantomBuster.',
    'agent-history-unavailable':'Não foi possível confirmar o histórico de execuções do agente.',
    'agent-history-missing':'O contêiner não apareceu no histórico do agente.',
    'unknown-status':'O PhantomBuster retornou um estado ainda não reconhecido.',
    'failed-run':'A execução terminou com falha ou código de saída diferente de zero.',
    'missing-completion-time':'O PhantomBuster não forneceu um horário válido de conclusão.',
    'missing-claim':'A resposta apresentou metadados sem o identificador do lançamento.',
    'wrong-claim':'O identificador de lançamento retornado não corresponde ao registro salvo.',
    'wrong-reference':'A referência associada à execução não corresponde à referência cadastrada.',
  };
  const lock=useRef(false);
  const resumedExisting=useRef(false);
  // No state mutations in the fetch helper: React effects update state
  // only after its asynchronous result is delivered.
  const read=useCallback(async():Promise<{value:Queue|null;diagnostic:string}>=>{
    try{
      const response=await fetch('/api/operator/phantombuster/dynamic-references',{
        credentials:'same-origin',cache:'no-store',
      });
      if(!response.ok){
        const detail:Record<number,string>={
          401:'A sessão do DECOLA INSTA expirou. Entre novamente no painel.',
          403:'A coleta experimental está restrita ao operador do Preview.',
          409:'O coletor do PhantomBuster precisa de verificação.',
          503:'A fila de referências está indisponível ou exige revisão.',
        };
        const payload=await response.json().catch(()=>null) as {error?:unknown}|null;
        const safeExplanation=typeof payload?.error==='string'&&payload.error.length<230
          ?payload.error:null;
        return {value:null,diagnostic:safeExplanation??detail[response.status]??
          'Não foi possível consultar a coleta automática.'};
      }
      const value=await response.json() as Queue;
      if(value.accountId!==accountId){
        return {value:null,diagnostic:
          'Esta conta não corresponde à conta autorizada para o coletor piloto.'};
      }
      if(!value.enabled){
        return {value:null,diagnostic:'A coleta está desativada na configuração deste Preview.'};
      }
      return {value,diagnostic:''};
    }catch{
      return {value:null,diagnostic:'Não foi possível consultar a integração com o PhantomBuster.'};
    }
  },[accountId]);
  useEffect(()=>{
    let cancelled=false;
    void read().then(result=>{
      if(cancelled)return;
      setQueue(result.value);
      setDiagnostic(result.diagnostic);
    });
    return ()=>{cancelled=true;};
  },[read]);
  const advance=useCallback(async()=>{
    if(lock.current)return;
    lock.current=true;
    try{
      const response=await fetch('/api/operator/phantombuster/dynamic-references',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'advance',confirmDynamicCollection:true}),
      });
      if(!response.ok){
        // The server deliberately sends an allowlisted Portuguese reason,
        // not provider logs, credentials, cookies or raw API output.
        const failure=await response.json().catch(()=>null) as {error?:unknown}|null;
        const reason=typeof failure?.error==='string'&&failure.error.length<230
          ?failure.error:'Não foi possível confirmar a solicitação no servidor.';
        setRunning(false);
        setMessage(reason+' (HTTP '+response.status+').');
        const current=await read();
        setQueue(current.value);
        setDiagnostic(current.diagnostic);
        return;
      }
      const info=await response.json() as Advance;
      if(info.status==='queued')
        setMessage('Coleta iniciada para @'+(info.reference??'referência')+'.');
      else if(info.status==='in-progress'||info.status==='provider-busy')
        setMessage(info.providerReason&&proofExplanations[info.providerReason]
          ?proofExplanations[info.providerReason]
          :info.providerStatus==='unavailable'
            ?'Consulta do contêiner indisponível; nenhuma coleta será repetida.'
            :'O contêiner existente continua em execução.');
      else if(info.status==='finished'){
        setMessage('Coleta de @'+(info.reference??'referência')+
          ' finalizada. Nomes observados: '+(info.observedNames??0)+'.');
        // The server committed the saved snapshots and candidate index in
        // the same transaction; no second browser-side POST is required.
        onIndexed?.();
      }else{
        setRunning(false);
        if(info.status==='finished-without-input-proof'){
          setMessage((info.providerReason&&proofExplanations[info.providerReason]
            ?proofExplanations[info.providerReason]
            :'O contêiner terminou, mas sua origem não pôde ser comprovada.')+
            ' Nenhum nome foi importado.');
        }else setMessage(info.status==='queue-complete'
          ?'Todas as referências elegíveis foram processadas.'
          :'Execução interrompida para revisão: '+info.status);
      }
      const updated=await read();
      setQueue(updated.value);
      setDiagnostic(updated.diagnostic);
    }catch{
      setRunning(false);
      setMessage('A execução não pôde ser confirmada; não será repetida automaticamente.');
    }finally{lock.current=false;}
  },[accountId,onIndexed,read]);
  useEffect(()=>{
    // Only resume a previously launched container; never auto-launch the
    // next reference on a fresh visit without a prior operator initiation.
    if(!resumedExisting.current&&!running&&queue?.enabled&&
      (queue.currentState==='launched'||
       queue.currentState==='finished-unverified')&&queue.canAdvance){
      resumedExisting.current=true;
      setRunning(true);
      void advance();
    }
  },[queue,running,advance]);
  useEffect(()=>{
    if(!running)return;
    const timer=setInterval(()=>{void advance();},20000);
    return ()=>clearInterval(timer);
  },[advance,running]);
  return <div className="rounded-lg border bg-card p-4 space-y-2">
    <p className="text-sm font-semibold">Coleta automática de referências</p>
    <p className="text-xs text-muted-foreground">
      Um coletor existente recebe cada referência cadastrada diretamente do
      DECOLA INSTA. Nenhuma URL precisa ser alterada no PhantomBuster.
    </p>
    {queue ? <>
      <p className="text-sm">
        Referências: {queue.total}. Iniciadas: {queue.attempted}.
        Finalizadas: {queue.completed}.
        {queue.unverified>0&&' Sem origem confirmada: '+queue.unverified+'.'}
      </p>
      {queue.currentState!=='finished-unverified'&&queue.currentState!=='launched'&&
        queue.nextReference&&<p className="text-xs text-muted-foreground">
        Próxima: @{queue.nextReference}
      </p>}
      {queue.blocker&&<p role="status" className="text-sm text-muted-foreground">
        {queue.blocker}
      </p>}
      {queue.activeContainerReason&&proofExplanations[queue.activeContainerReason]&&
        <p role="status" className="text-sm text-muted-foreground">
          Diagnóstico: {proofExplanations[queue.activeContainerReason]}
        </p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={running||!queue.canAdvance}
          onClick={()=>{setRunning(true);void advance();}}>
          {running?'Verificando...':
            queue.currentState==='finished-unverified'||queue.currentState==='launched'
              ?'Rever contêiner existente':'Iniciar coletas'}
        </Button>
        {running&&<Button type="button" variant="outline"
          onClick={()=>setRunning(false)}>Parar acompanhamento</Button>}
      </div>
    </> : <p role="status" className="text-sm text-muted-foreground">
      {diagnostic}
    </p>}
    {message&&<p role="status" aria-live="polite" className="text-sm">{message}</p>}
    <p className="text-xs text-muted-foreground">
      As próximas execuções são solicitadas enquanto esta página estiver aberta.
      Isso não inicia follows nem garante que pessoas seguirão sua conta.
    </p>
  </div>;
}
