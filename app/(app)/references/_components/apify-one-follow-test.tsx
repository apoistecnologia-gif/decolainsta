'use client';

import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type Readiness={
  status:string;account:string;target:null;
  invalidLegacyTarget:boolean;legacyTargetUsername:string|null;
  legacyConfigurationError:string|null;
  configured:boolean;cookieConfigured:boolean;accountReady:boolean;
  dryMode:boolean;
  referenceReadiness:{
    total:number;enabled:number;eligibleCandidates:number;
    nextCandidateSelected:boolean;bounded:boolean;blockedReasons:string[];
  };
  canLaunch:boolean;canInspect:boolean;
  providerReportedFollow:boolean;followIndependentlyVerified:false;
  unfollowEnabled:false;unfollowScheduled:false;
  maxActionsPerRun:1;maxTotalChargeUsd:number;costUsd:number|null;
};
const messages:Record<string,string>={
  'not-started':'Nenhuma ação real da Apify foi solicitada.',
  reserved:'Tentativa reservada. Não repetir a solicitação.',
  launched:'Execução original enviada. Consulte o resultado; o alvo corresponde ao antigo usuário da própria conta.',
  unconfirmed:'Lançamento incerto. Não repetir automaticamente.',
  rejected:'A Apify recusou o lançamento. Nenhuma nova tentativa será feita.',
  'provider-reported':'O Actor informou sucesso para a própria conta. Isso NÃO é considerado follow válido.',
  'provider-rejected':'O Actor informou que não realizou o follow.',
  'provider-blocked':'O Actor informou bloqueio ou problema de autenticação. Não repetir.',
  failed:'A execução falhou. Não repetir automaticamente.',
  ambiguous:'Resultado ambíguo. Conferência manual necessária.',
  running:'A execução ainda está em andamento.',
  unavailable:'Consulta temporariamente indisponível. Não iniciar outra ação.',
  'launch-request-accepted':'Pedido de execução aceito. Verifique o resultado depois.',
};
export function ApifyOneFollowTest(){
  const [state,setState]=useState<Readiness|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const read=useCallback(async()=>{
    const response=await fetch('/api/operator/apify/one-follow',{
      credentials:'same-origin',cache:'no-store',
    });
    if(!response.ok)throw Error('Diagnóstico disponível somente no Preview para operador.');
    const data=await response.json() as Readiness;
    if(data.maxActionsPerRun!==1||data.unfollowEnabled!==false||
       data.followIndependentlyVerified!==false)
      throw Error('Resposta incompatível com o teste de uma ação.');
    setState(data);
    return data;
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/operator/apify/one-follow',{
      credentials:'same-origin',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      if(!response.ok)throw Error('Diagnóstico disponível somente no Preview para operador.');
      return await response.json() as Readiness;
    }).then(data=>{
      if(controller.signal.aborted)return;
      if(data.maxActionsPerRun!==1||data.unfollowEnabled!==false||
         data.followIndependentlyVerified!==false)
        throw Error('Resposta incompatível com o teste de uma ação.');
      setState(data);
    }).catch(err=>{
      if(!controller.signal.aborted)
        setError(err instanceof Error?err.message:'Falha ao carregar');
    });
    return()=>controller.abort();
  },[]);
  const inspect=async()=>{
    if(busy)return;
    setBusy(true);setMessage('');setError('');
    try{
      const response=await fetch('/api/operator/apify/one-follow',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        redirect:'error',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'inspect'}),
      });
      const result=await response.json() as {status?:string;error?:string};
      if(!response.ok)throw Error(result.error??'Consulta não autorizada');
      setMessage(messages[result.status??'']??'Consulta registrada.');
      await read();
    }catch(err){
      setError(err instanceof Error?err.message:'Falha de comunicação');
      await read().catch(()=>undefined);
    }finally{setBusy(false);}
  };
  return <section className="rounded-lg border p-3 space-y-3">
    <h3 className="text-sm font-semibold">
      Auditoria do teste Apify — nenhum novo follow
    </h3>
    <p className="text-xs text-muted-foreground">
      Conta atual: @{state?.account??'apoistecnologia'}.
      @contateste6699 é o nome anterior da MESMA conta, não um destino válido.
      Novos follows e unfollows permanecem desativados.
    </p>
    {state&&<div className="space-y-1 text-xs">
      <p>Execução original: {messages[state.status]??state.status}</p>
      {state.referenceReadiness&&<>
        <p>Referências cadastradas: {state.referenceReadiness.total};
          ativas: {state.referenceReadiness.enabled}.</p>
        <p>Candidatos das referências cadastradas, após exclusões:
          {state.referenceReadiness.eligibleCandidates}.</p>
        <p>Conta apta: {state.accountReady?'Sim':'Não'}.
          Simulação: {state.dryMode?'Ligada':'Desligada'}.</p>
        {state.referenceReadiness.blockedReasons.length>0&&
          <p role="status" className="font-medium">
            Validação real pendente: {state.referenceReadiness.blockedReasons
              .map(reason=>({
                'instagram-account-inactive':'conta Instagram inativa',
                'simulation-mode':'modo simulação ligado',
                'instagram-cookies-not-configured':'cookies não configurados',
                'pilot-flag-disabled':'teste real ainda desabilitado',
                'no-registered-references':'nenhuma referência cadastrada',
                'no-eligible-candidates':'nenhum candidato elegível de referência ativa',
                'historical-run-unresolved':'resultado anterior não esclarecido',
                'queue-capacity-unverified':'fila acima do limite de verificação',
              } as Record<string,string>)[reason]??'verificação pendente')
              .join('; ')}.
          </p>}
      </>}
      {state.invalidLegacyTarget&&<p role="alert" className="font-medium text-destructive">
        Erro de configuração registrado: tentativa apontou para a própria conta.
        Nenhum sucesso do Actor será contado como follow válido.
      </p>}
      <p>Chave de sessão: {state.cookieConfigured?'Configurada':'Não configurada'}.
        Limite: {state.maxActionsPerRun} follow · Teto Apify:
        US$ {state.maxTotalChargeUsd.toFixed(2)}.
      </p>
      {state.costUsd!==null&&<p>
        Custo informado: US$ {state.costUsd.toFixed(4)}.
      </p>}
      {state.providerReportedFollow&&<p className="font-medium">
        Resultado informado pelo Actor é inválido para crescimento: destino é a própria conta.
      </p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled type="button">
        Novo follow bloqueado
      </Button>
      <Button size="sm" variant="outline" disabled={!state?.canInspect||busy}
        type="button" onClick={()=>void inspect()}>
        Consultar resultado
      </Button>
      <Button size="sm" variant="outline" disabled={busy} type="button"
        onClick={()=>{void read().catch(()=>setError('Verificação indisponível'));}}>
        Atualizar estado
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">
      Este teste não comprova que o Instagram removeu restrições.
      Se aparecer bloqueio, desafio de login ou resultado incerto,
      nenhuma segunda ação será lançada.
    </p>
    {message&&<p role="status" className="text-sm">{message}</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
