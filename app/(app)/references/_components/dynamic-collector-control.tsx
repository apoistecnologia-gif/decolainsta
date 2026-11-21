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
  failureDiagnostic?:string|null;
  collectionLimited?:boolean;
  canRetryFailed?:boolean;retryReference?:string|null;
};
type Advance={status:string;reference?:string;observedNames?:number;
  providerStatus?:string;providerReason?:string;failureDiagnostic?:string|null;
  resultStatus?:'unavailable'|'unsupported';};
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
    'results-pending':'O PhantomBuster finalizou o contêiner, mas os resultados ainda não estão disponíveis. O sistema consultará o mesmo contêiner novamente, sem relançar.',
  };
  const failureExplanations:Record<string,string>={
    'session-invalid':'Indício de sessão Instagram expirada ou inválida no PhantomBuster.',
    'credentials-missing':'Indício de credenciais ou sessão ausentes no PhantomBuster.',
    'terms-update':'Indício de termos atualizados do Instagram aguardando aceite na conta.',
    'followers-load-failed':'Indício de falha ao carregar a lista de seguidores no Instagram.',
    'profile-load-failed':'Indício de falha ao abrir ou carregar o perfil de referência.',
    'no-matches':'Indício de entrada vazia, sem perfis ou sem resultados elegíveis.',
    'proxy-failure':'Indício de falha de conexão por proxy no PhantomBuster.',
    'login-challenge':'Indício de desafio de segurança ou verificação de login do Instagram.',
    'invalid-input':'Indício de entrada ou URL de referência inválida.',
    'private-target':'Indício de conta de referência privada ou inacessível.',
    'platform-limited':'Indício de limite ou restrição do Instagram.',
    'workspace-limit':'Indício de limite de créditos, armazenamento ou capacidade do PhantomBuster.',
    'execution-timeout':'Indício de tempo máximo, memória ou contexto de execução encerrado.',
    'runtime-error':'Indício de erro de execução do próprio coletor.',
    'unknown':'O log não apresenta uma causa reconhecível automaticamente.',
    'empty-output':'O contêiner não retornou log de execução.',
    'output-too-large':'O log excede o limite de leitura segura do painel.',
    'provider-unavailable':'O PhantomBuster não disponibilizou o log desse contêiner.',
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
  const advance=useCallback(async(operation:'advance'|'retry-failed'='advance')=>{
    if(lock.current)return;
    lock.current=true;
    try{
      const response=await fetch('/api/operator/phantombuster/dynamic-references',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation,confirmDynamicCollection:true}),
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
          const cause=info.failureDiagnostic&&failureExplanations[info.failureDiagnostic];
          setMessage((cause??(info.providerReason&&proofExplanations[info.providerReason]
            ?proofExplanations[info.providerReason]
            :'O contêiner terminou, mas sua origem não pôde ser comprovada.'))+
            ' Nenhum nome foi importado.');
        }else if(info.status==='import-unavailable'){
          const category=info.failureDiagnostic&&
            failureExplanations[info.failureDiagnostic];
          setMessage((category??(info.resultStatus==='unsupported'
            ?'O resultado deste contêiner não possui uma lista de perfis no formato esperado.'
            :'O PhantomBuster não disponibilizou os resultados desse contêiner.'))+
            ' Nenhum nome foi atribuído a esta referência. Não haverá nova coleta automática.');
        }else setMessage(info.status==='queue-complete'
          ?'Todas as referências elegíveis foram processadas.'
          :'Execução interrompida para revisão: '+info.status);
      }
      const updated=await read();
      setQueue(updated.value);
      setDiagnostic(updated.diagnostic);
      // Async provider response, not a synchronous React effect update:
      // the limit indicator pauses subsequent timer calls immediately.
      if(updated.value?.collectionLimited){
        setRunning(false);
        if(info.status==='queued'||info.status==='in-progress'||
           info.status==='provider-busy')
          setMessage('Acompanhamento pausado por limite do Instagram. Nenhuma nova coleta será iniciada.');
      }
    }catch{
      setRunning(false);
      setMessage('A execução não pôde ser confirmada; não será repetida automaticamente.');
    }finally{lock.current=false;}
  },[accountId,onIndexed,read]);
  useEffect(()=>{
    // Only resume a previously launched container; never auto-launch the
    // next reference on a fresh visit without a prior operator initiation.
    if(!resumedExisting.current&&!running&&queue?.enabled&&
      !queue.collectionLimited&&
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
      {queue.failureDiagnostic&&failureExplanations[queue.failureDiagnostic]&&
        <p role="status" className="text-sm text-muted-foreground">
          Indício no log da execução: {failureExplanations[queue.failureDiagnostic]}
        </p>}
      <div className="flex flex-wrap gap-2">
        {queue.canRetryFailed&&queue.retryReference
          ?<Button type="button" disabled={running}
            onClick={()=>{setRunning(true);void advance('retry-failed');}}>
            {running?'Verificando...':
              'Repetir coleta de @'+queue.retryReference+' após reconexão'}
          </Button>
          :<Button type="button" disabled={running||!queue.canAdvance}
            onClick={()=>{setRunning(true);void advance();}}>
            {running?'Verificando...':
              queue.collectionLimited?'Consultar resultado existente':
                queue.currentState==='finished-unverified'||queue.currentState==='launched'
                  ?'Rever contêiner existente':'Iniciar coletas'}
          </Button>}
        {running&&<Button type="button" variant="outline"
          onClick={()=>setRunning(false)}>Parar acompanhamento</Button>}
      </div>
    </> : <p role="status" className="text-sm text-muted-foreground">
      {diagnostic}
    </p>}
    {message&&<p role="status" aria-live="polite" className="text-sm">{message}</p>}
    <p className="text-xs text-muted-foreground">
      Esta função coleta candidatos, não executa ações de seguir nem de deixar de seguir.
      {queue?.collectionLimited
        ?' Há uma restrição indicada pelo Instagram; a consulta de resultados existentes é manual e não relança o coletor.'
        :' O avanço da fila depende da página aberta.'}
    </p>
  </div>;
}
