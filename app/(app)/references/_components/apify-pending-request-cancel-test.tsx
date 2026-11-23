'use client';

import {useCallback,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';

type State={
 status:string;
 targetUsername:string|null;
 accountUsername:string;
 pendingRequestObserved:boolean;
 metaIdentityVerified:boolean;
 configured:boolean;
 canLaunch:boolean;
 canInspect:boolean;
 maxActionsPerRun:1;maxTotalChargeUsd:number;
 costUsd:number|null;providerReportedUnfollow:boolean;
 requestCancellationConfirmed:false;automatedUnfollowEnabled:false;
};
const endpoint='/api/operator/apify/pending-request-cancel-test';
const messages:Record<string,string>={
 'not-started':'Nenhuma tentativa de cancelamento executada.',
 reserved:'Tentativa reservada. Não repetir.',
 launched:'O Actor recebeu uma ação unfollow; verificar resultado.',
 unconfirmed:'Envio incerto: não repetir.',
 rejected:'O Actor recusou a solicitação.',
 'provider-reported':'O Actor informou unfollow; verificar se o botão voltou a “Seguir”.',
 'provider-rejected':'O Actor não conseguiu executar o unfollow.',
 'provider-blocked':'O Actor encontrou restrição de ação ou sessão.',
 failed:'A execução falhou.',
 ambiguous:'Resultado ambíguo; não repetir.',
 running:'Execução em andamento.',
 unavailable:'Consulta à Apify indisponível.',
};
export function ApifyPendingRequestCancelTest(){
 const [data,setData]=useState<State|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const refresh=useCallback(async()=>{
  const response=await fetch(endpoint,{
   credentials:'same-origin',cache:'no-store',
  });
  if(!response.ok)throw Error('Teste de cancelamento indisponível.');
  const value=await response.json() as State;
  if(value.maxActionsPerRun!==1||
     value.requestCancellationConfirmed!==false||
     value.automatedUnfollowEnabled!==false)
   throw Error('Contrato de segurança incompatível.');
  setData(value);
 },[]);
 useEffect(()=>{
  void refresh().catch(()=>undefined);
 },[refresh]);
 const run=async(operation:'cancel-one'|'inspect')=>{
  if(busy)return;
  if(operation==='cancel-one'&&!window.confirm(
   'Confirma um teste real do comando UNFOLLOW para a solicitação pendente? A Apify pode cobrar e o Actor pode não saber cancelar pedidos pendentes. Uma única execução, sem repetição automática.'
  ))return;
  setBusy(true);setError('');setMessage('');
  try{
   const response=await fetch(endpoint,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    redirect:'error',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({operation,confirmRealInstagramAction:true}),
   });
   const value=await response.json() as {status?:string;error?:string};
   if(!response.ok)throw Error(value.error??'Operação recusada');
   setMessage(messages[value.status??'']??'Consulta concluída.');
  }catch(e){
   setError(e instanceof Error?e.message:'Falha no teste');
  }finally{
   await refresh().catch(()=>undefined);setBusy(false);
  }
 };
 if(!data?.pendingRequestObserved)return null;
 return <section className="rounded-lg border p-3 space-y-3">
  <h3 className="text-sm font-semibold">
   Piloto de cancelamento — pedido pendente
  </h3>
  <p className="text-xs text-muted-foreground">
   A solicitação para @{data.targetUsername} foi observada como “Solicitado”.
   O Actor documenta “unfollow”, mas não garante que esse comando
   cancele solicitações pendentes. Este teste isolado exige confirmação
   e não autoriza novas solicitações nem automação em massa.
  </p>
  <div className="space-y-1 text-xs">
   <p>Identidade Meta: {data.metaIdentityVerified?'verificada':'não verificada'}.
    Teste: {data.configured?'configurado':'não habilitado'}.</p>
   <p>Estado: {messages[data.status]??data.status}</p>
   {data.costUsd!==null&&<p>
    Custo informado pela Apify: US$ {data.costUsd.toFixed(5)}.
   </p>}
   {data.providerReportedUnfollow&&<p role="status">
    O Actor informou execução; isso não comprova que o pedido foi cancelado.
    Verifique no perfil se o botão mudou de “Solicitado” para “Seguir”.
   </p>}
  </div>
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" disabled={!data.canLaunch||busy}
    onClick={()=>void run('cancel-one')}>
    Testar 1 cancelamento
   </Button>
   <Button type="button" size="sm" variant="outline"
    disabled={!data.canInspect||busy} onClick={()=>void run('inspect')}>
    Consultar resultado
   </Button>
   <Button type="button" size="sm" variant="outline"
    disabled={busy}
    onClick={()=>void refresh().catch(()=>setError('Consulta indisponível'))}>
    Atualizar estado
   </Button>
  </div>
  <p className="text-xs text-muted-foreground">
   Sem nova tentativa automática, sem novos follows, sem
   ativação do motor geral. Custo máximo configurado por Actor:
   US$ 0,25.
  </p>
  {message&&<p role="status" className="text-sm">{message}</p>}
  {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
 </section>;
}
