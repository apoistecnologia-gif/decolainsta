'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';

type ActorCheck={
  status:'listed'|'not-configured'|'not-found'|'unauthorized'|
    'rate-limited'|'metadata-mismatch'|'unavailable';
  permissions:'limited'|'full'|'unknown';
  users30Days:number|null;reviewCount:number|null;
  requiresInstagramCookie:true;realActionVerified:false;
};
type Readiness={
  combined:ActorCheck;follow:ActorCheck;unfollow:ActorCheck;
  verifiedFollows:0;verifiedUnfollows:0;actorRunsExecuted:0;
  instagramActionsExecuted:0;liveActionsEnabled:false;
};
const statusText:Record<ActorCheck['status'],string>={
  listed:'Disponível no catálogo',
  'not-configured':'Chave Apify não configurada',
  'not-found':'Actor não encontrado',
  unauthorized:'Acesso recusado pela Apify',
  'rate-limited':'Consulta limitada pela Apify',
  'metadata-mismatch':'Identificação do Actor não confere',
  unavailable:'Não foi possível verificar',
};
export function ApifySocialReadiness(){
  const [result,setResult]=useState<Readiness|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function check(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const response=await fetch('/api/operator/apify/social-readiness',{
        credentials:'same-origin',cache:'no-store',redirect:'error',
      });
      if(!response.ok)throw Error('Consulta restrita ao operador no Preview.');
      const data=await response.json() as Readiness;
      if(data.actorRunsExecuted!==0||data.instagramActionsExecuted!==0||
         data.liveActionsEnabled!==false)
        throw Error('Resposta inesperada. Ações reais continuam bloqueadas.');
      setResult(data);
    }catch(err){
      setError(err instanceof Error?err.message:'Falha ao consultar executores.');
    }finally{setBusy(false);}
  }
  return <section className="rounded-lg border p-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold">Seguir e deixar de seguir — executores Apify</h3>
        <p className="text-xs text-muted-foreground">
          Consulta o catálogo, não executa ações no Instagram.
        </p>
      </div>
      <Button size="sm" variant="outline" type="button" disabled={busy}
        onClick={()=>void check()}>
        {busy?'Consultando...':'Verificar executores'}
      </Button>
    </div>
    {result&&<div className="space-y-2 text-xs">
      {([
        ['combined','Follow + unfollow (um Actor)'],
        ['follow','Somente follow'],
        ['unfollow','Somente unfollow'],
      ] as const).map(([key,label])=><div key={key}
        className="flex flex-wrap justify-between gap-2 border-b pb-2 last:border-0">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {statusText[result[key].status]}
          {result[key].permissions==='full'?' · Permissões completas':''}
          {result[key].permissions==='limited'?' · Permissões limitadas':''}
        </span>
      </div>)}
      <p className="text-muted-foreground">
        Todos os Actors avaliados exigem cookie de sessão do Instagram.
        Disponível no catálogo não significa ação comprovada.
        Follows e unfollows reais verificados: 0.
      </p>
    </div>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
