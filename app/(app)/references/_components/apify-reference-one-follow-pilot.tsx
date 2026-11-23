'use client';

import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type Readiness={
 status:string;account:string;targetUsername:string|null;
 candidateReference:string|null;readyCandidates:number;
 registeredReferences:number;collectorEnabledReferences:number;
 accountReady:boolean;cookieConfigured:boolean;tokenConfigured:boolean;
 historicalRunResolved:boolean;globallyInDryMode:boolean;
 canLaunch:boolean;canInspect:boolean;providerReportedFollow:boolean;
 followIndependentlyVerified:false;unfollowEnabled:false;
 maxActionsPerRun:1;maxTotalChargeUsd:number;costUsd:number|null;
};
const endpoint='/api/operator/apify/reference-one-follow-pilot';
const labels:Record<string,string>={
 'not-started':'Nenhum teste novo solicitado.',
 reserved:'Tentativa reservada. Não repetir automaticamente.',
 launched:'Execução enviada à Apify; o follow ainda não está comprovado.',
 rejected:'A Apify recusou o pedido.',
 unconfirmed:'Não foi possível confirmar a execução. Não repetir.',
 'provider-reported':'O Actor informou sucesso; verificar no Instagram.',
 'provider-rejected':'A Apify informou que não realizou o follow.',
 'provider-blocked':'Bloqueio/autenticação informado pelo Actor.',
 failed:'A execução falhou.',
 ambiguous:'O resultado não pôde ser confirmado.',
 running:'A Apify ainda está executando.',
 unavailable:'Consulta à Apify indisponível.',
};
export function ApifyReferenceOneFollowPilot(){
 const [data,setData]=useState<Readiness|null>(null);
 const [visible,setVisible]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  const response=await fetch(endpoint,{credentials:'same-origin',cache:'no-store'});
  if(response.status===403){setVisible(false);return;}
  if(!response.ok)throw Error('Diagnóstico do teste indisponível.');
  const value=await response.json() as Readiness;
  if(value.maxActionsPerRun!==1||value.unfollowEnabled!==false||
     value.followIndependentlyVerified!==false)
   throw Error('Contrato de segurança incompatível.');
  setVisible(true);setData(value);
 },[]);
 useEffect(()=>{void refresh().catch(()=>undefined);},[refresh]);
 const operate=async(operation:'launch-one'|'inspect')=>{
  if(busy)return;
  if(operation==='launch-one'&&!window.confirm(
    'Confirma UM follow real pelo @apoistecnologia? O sistema escolherá um único candidato das referências salvas. Pode haver cobrança Apify e restrição pelo Instagram.'
  ))return;
  setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch(endpoint,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    redirect:'error',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation,confirmRealInstagramAction:true}),
   });
   const result=await response.json() as {status?:string;error?:string};
   if(!response.ok)throw Error(result.error??'Operação recusada');
   setMessage(labels[result.status??'']??'Consulta concluída.');
  }catch(err){
   setError(err instanceof Error?err.message:'Falha de comunicação');
  }finally{
   await refresh().catch(()=>undefined);setBusy(false);
  }
 };
 if(!visible)return null;
 return <section className="rounded-lg border p-3 space-y-3">
  <h3 className="text-sm font-semibold">Teste real isolado — 1 follow no máximo</h3>
  <p className="text-xs text-muted-foreground">
   Utiliza um seguidor já coletado de uma referência cadastrada.
   Não exige escolher seguidores nem reativar coletores. O modo global
   de simulação permanece ligado; apenas este teste poderá solicitar
   uma ação, quando a conta estiver apta.
  </p>
  {data&&<div className="space-y-1 text-xs">
   <p>Referências cadastradas: {data.registeredReferences}.
    Candidatos disponíveis para análise: {data.readyCandidates}.</p>
   <p>Origem prevista: {data.candidateReference
    ?'@'+data.candidateReference:'nenhuma referência disponível'}.</p>
   <p>Conta Instagram: {data.accountReady?'ativa':'inativa ou não validada'}.
    Configuração da sessão Apify: {data.cookieConfigured?'presente':'ausente'}.
   </p>
   <p>Resultado anterior: {data.historicalRunResolved?'resolvido':'pendente'}.
    Estado do novo teste: {labels[data.status]??data.status}</p>
   {data.targetUsername&&<p>
     Destino da tentativa:
     {' '}<a className="underline" target="_blank" rel="noopener noreferrer"
      href={'https://www.instagram.com/'+data.targetUsername+'/'}>
      @{data.targetUsername}
     </a>. Confira diretamente no Instagram; o relatório do Actor não é prova independente.
    </p>}
   {data.costUsd!==null&&<p>Custo informado: US$ {data.costUsd.toFixed(5)}.</p>}
   {!data.accountReady&&<p role="status">
     Para permitir o teste, a conexão da conta precisa ser validada como ativa.
     Não vamos alterar esse estado artificialmente no banco.
    </p>}
   {data.providerReportedFollow&&<p>
     Sucesso informado pelo Actor ainda exige confirmação independente.
    </p>}
  </div>}
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" disabled={!data?.canLaunch||busy}
    onClick={()=>void operate('launch-one')}>
    Testar 1 follow real
   </Button>
   <Button type="button" size="sm" variant="outline"
    disabled={!data?.canInspect||busy}
    onClick={()=>void operate('inspect')}>
    Consultar execução
   </Button>
   <Button type="button" size="sm" variant="outline" disabled={busy}
    onClick={()=>void refresh().catch(()=>setError('Atualização indisponível'))}>
    Atualizar diagnóstico
   </Button>
  </div>
  <p className="text-xs text-muted-foreground">
   Sem lançamento automático, sem segunda tentativa, sem unfollow habilitado.
   O limite de cobrança configurado na Apify é US$ 0,25.
  </p>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </section>;
}
