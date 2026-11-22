'use client';

import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type Readiness={
  status:string;account:'apoistecnologia';target:'contateste6699';
  configured:boolean;cookieConfigured:boolean;accountReady:boolean;
  canLaunch:boolean;canInspect:boolean;
  providerReportedFollow:boolean;followIndependentlyVerified:false;
  unfollowEnabled:false;unfollowScheduled:false;
  maxActionsPerRun:1;maxTotalChargeUsd:number;costUsd:number|null;
};
const messages:Record<string,string>={
  'not-started':'Nenhuma ação real da Apify foi solicitada.',
  reserved:'Tentativa reservada. Não repetir a solicitação.',
  launched:'Execução iniciada. Consulte o resultado antes de prosseguir.',
  unconfirmed:'Lançamento incerto. Não repetir automaticamente.',
  rejected:'A Apify recusou o lançamento. Nenhuma nova tentativa será feita.',
  'provider-reported':'O Actor informou follow realizado. Ainda precisa de conferência no Instagram.',
  'provider-rejected':'O Actor informou que não realizou o follow.',
  'provider-blocked':'O Actor informou bloqueio ou problema de autenticação. Não repetir.',
  failed:'A execução falhou. Não repetir automaticamente.',
  ambiguous:'Resultado ambíguo. Conferência manual necessária.',
  running:'A execução ainda está em andamento.',
  unavailable:'Consulta temporariamente indisponível. Não iniciar outra ação.',
  'launch-request-accepted':'Pedido de execução aceito. Verifique o resultado depois.',
};
const approved='CONFIRMO UM FOLLOW REAL NO INSTAGRAM';
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
  const act=async(operation:'launch-one'|'inspect')=>{
    if(busy)return;
    if(operation==='launch-one'&&
       !window.confirm(
        'Autoriza compartilhar apenas os cookies de sessão necessários de @apoistecnologia com o Actor dead00 na Apify para tentar seguir @contateste6699 UMA VEZ?\n\nA conta pode sofrer restrição. Não haverá follow automático posterior nem unfollow agendado.'
       ))return;
    setBusy(true);setMessage('');setError('');
    try{
      const payload=operation==='launch-one'
        ?{operation,accountConfirmation:'apoistecnologia',approval:approved}
        :{operation};
      const response=await fetch('/api/operator/apify/one-follow',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        redirect:'error',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),
      });
      const result=await response.json() as {status?:string;error?:string};
      if(!response.ok)throw Error(result.error??'Operação não autorizada');
      setMessage(messages[result.status??'']??'Solicitação registrada.');
      await read();
    }catch(err){
      setError(err instanceof Error?err.message:'Falha de comunicação');
      await read().catch(()=>undefined);
    }finally{setBusy(false);}
  };
  return <section className="rounded-lg border p-3 space-y-3">
    <h3 className="text-sm font-semibold">
      Teste real de seguir — Apify (somente uma ação)
    </h3>
    <p className="text-xs text-muted-foreground">
      Conta: @apoistecnologia · Destino de teste: @contateste6699.
      Nenhum unfollow será executado ou agendado automaticamente.
    </p>
    {state&&<div className="space-y-1 text-xs">
      <p>Execução: {messages[state.status]??state.status}</p>
      <p>Chave de sessão: {state.cookieConfigured?'Configurada':'Não configurada'}.
        Limite: {state.maxActionsPerRun} follow · Teto Apify:
        US$ {state.maxTotalChargeUsd.toFixed(2)}.
      </p>
      {state.costUsd!==null&&<p>
        Custo informado: US$ {state.costUsd.toFixed(4)}.
      </p>}
      {state.providerReportedFollow&&<p className="font-medium">
        O Actor informou sucesso, mas o Instagram ainda não foi verificado.
      </p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!state?.canLaunch||busy}
        type="button" onClick={()=>void act('launch-one')}>
        {busy?'Processando...':'Testar 1 follow real'}
      </Button>
      <Button size="sm" variant="outline" disabled={!state?.canInspect||busy}
        type="button" onClick={()=>void act('inspect')}>
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
