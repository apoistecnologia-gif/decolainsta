'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';

type Readiness={
  status:'connected'|'not-configured'|'invalid-token'|'rate-limited'|'unavailable';
  authenticationChecked:boolean;actorRunsExecuted:0;
  instagramActionsExecuted:0;collectionEnabled:false;
};
const labels:Record<Readiness['status'],string>={
  connected:'Chave Apify válida. Nenhuma coleta foi iniciada.',
  'not-configured':'Falta cadastrar APIFY_API_TOKEN no Preview da Vercel.',
  'invalid-token':'A Apify não aceitou a chave cadastrada.',
  'rate-limited':'Apify limitou a verificação. Nenhuma coleta foi iniciada.',
  unavailable:'Apify não respondeu à verificação de conexão.',
};

export function ApifyPilotConnection(){
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  async function check(){
    if(busy)return;
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/operator/apify/readiness',{
        credentials:'same-origin',cache:'no-store',redirect:'error',
      });
      if(!response.ok){
        setMessage('Verificação restrita ao operador no Preview.');
        return;
      }
      const result=await response.json() as Readiness;
      if(result.actorRunsExecuted!==0||result.instagramActionsExecuted!==0||
        result.collectionEnabled!==false||!Object.prototype.hasOwnProperty.call(labels,result.status)){
        setMessage('Resposta inesperada. Nenhuma coleta autorizada.');
        return;
      }
      setMessage(labels[result.status]);
    }catch{
      setMessage('Não foi possível verificar a conexão com a Apify.');
    }finally{setBusy(false);}
  }
  return <div className="rounded-lg border p-3 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">Apify — conexão experimental</span>
      <Button type="button" size="sm" variant="outline" disabled={busy}
        onClick={()=>{void check();}}>
        {busy?'Verificando...':'Verificar conexão Apify'}
      </Button>
    </div>
    {message&&<p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <p className="text-xs text-muted-foreground">
      Diagnóstico de chave API apenas. Não coleta seguidores, não gera custo
      de execução e não segue nem deixa de seguir contas.
    </p>
  </div>;
}
