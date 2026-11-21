'use client';

import {useCallback,useEffect,useState} from 'react';
import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import type {FollowPreviewOperation,FollowPreviewState} from
  '@/lib/reference-follow-preview-control';

type FollowView={
  accountId:string;state:FollowPreviewState;
  candidateCount:number;eligibleCount:number;excludedCount:number;
  lastChangedAt:string|null;mode:'simulation';
  liveFollowAvailable:false;realFollowsEnabled:false;realUnfollowsEnabled:false;
  instagramActionsExecuted:0;blocker:string;
};
const labels:Record<FollowPreviewState,string>={
  idle:'Teste não iniciado',
  simulating:'Modo de teste iniciado — nenhum follow real',
  paused:'Modo de teste pausado',
  stopped:'Modo de teste encerrado',
};
type Props={accountId:string};

export function FollowPreviewControls({accountId}:Props){
  const [view,setView]=useState<FollowView|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [unavailable,setUnavailable]=useState(false);

  const read=useCallback(async(signal?:AbortSignal)=>{
    const response=await fetch('/api/operator/reference-follow-preview?accountId='+
      encodeURIComponent(accountId),{
      credentials:'same-origin',cache:'no-store',signal,
    });
    if(response.status===403)return null;
    if(!response.ok)throw new Error('Não foi possível consultar o controle de teste');
    return await response.json() as FollowView;
  },[accountId]);
  useEffect(()=>{
    const controller=new AbortController();
    void read(controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      setUnavailable(value===null);
      setView(value);
    }).catch(()=>{
      if(!controller.signal.aborted)setError('Não foi possível carregar o controle de seguir');
    });
    return ()=>controller.abort();
  },[read]);

  const action=useCallback(async(operation:FollowPreviewOperation)=>{
    if(busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/operator/reference-follow-preview',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({accountId,operation}),
      });
      const result=await response.json() as {error?:string;status?:string};
      if(!response.ok)throw new Error(result.error??'Não foi possível alterar o teste');
      const updated=await read();
      if(updated)setView(updated);
      const messages:Record<FollowPreviewOperation,string>={
        start:'Modo de teste iniciado. Nenhum follow foi enviado ao Instagram.',
        pause:'Modo de teste pausado.',
        resume:'Modo de teste retomado, sem ações reais.',
        stop:'Modo de teste encerrado.',
      };
      setNotice(messages[operation]);
    }catch(err){setError(err instanceof Error?err.message:'Falha no controle');}
    finally{setBusy(false);}
  },[accountId,busy,read]);

  if(unavailable||!accountId)return null;
  const ready=view?.accountId===accountId;
  const state=ready?view.state:'idle';
  const canStart=ready&&(view.eligibleCount>0)&&!busy;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Começar a seguir</h3>
          <p className="text-xs text-muted-foreground">
            Controles em modo de teste. Nenhum perfil será seguido enquanto
            a integração real e a liberação do Instagram não forem validadas.
          </p>
        </div>
        <p role="status" className="text-sm">
          {ready?labels[state]:'Carregando controle de teste...'}
        </p>
        {ready&&<p className="text-xs text-muted-foreground">
          Candidatos salvos: {view.candidateCount}.
          Elegíveis para avaliação: {view.eligibleCount}.
          Excluídos por proteção ou histórico: {view.excludedCount}.
        </p>}
        <div className="flex flex-wrap gap-2">
          {(state==='idle'||state==='stopped')&&
            <Button type="button" disabled={!canStart}
              onClick={()=>void action('start')}>Iniciar teste de seguir</Button>}
          {state==='simulating'&&
            <Button type="button" disabled={busy}
              onClick={()=>void action('pause')}>Pausar teste</Button>}
          {state==='paused'&&
            <Button type="button" disabled={busy||!canStart}
              onClick={()=>void action('resume')}>Retomar teste</Button>}
          {(state==='simulating'||state==='paused')&&
            <Button type="button" variant="outline" disabled={busy}
              onClick={()=>void action('stop')}>Parar teste</Button>}
          <Button type="button" variant="outline" disabled
            title="Requer integração de follow validada e ausência de restrição do Instagram">
            Começar a seguir de verdade
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Iniciar o teste apenas registra e controla o modo de simulação.
          Não executa ações, não inicia o PhantomBuster e não agenda follows.
        </p>
        {view?.blocker&&
          <p className="text-xs text-muted-foreground">
            Ação real bloqueada: {view.blocker}
          </p>}
        {notice&&<p role="status" className="text-sm">{notice}</p>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
