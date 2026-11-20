'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {FOLLOWERS_TRIAL_APPROVAL} from '@/lib/reference-followers-trial';

type Inspection={
  accountRegistered:boolean;referenceRegistered:boolean;agentConfigured:boolean;
  providerCheck:string;oneFollowPerLaunchVerified:boolean;agentLaunchEnabled:false;
};
type Attempt={
  stage:string;requestedAt:string|null;followConfirmed:false;
  recipientKnown:false;mayRetryAutomatically:false;
};
type Trial={
  enabled:boolean;accountName:string;referenceRegistered:boolean;
  attempted:boolean;attempt:Attempt|null;
  sessionOwnerVerifiedByProvider:false;followConfirmed:false;unfollowEnabled:false;
};
export function SocialPilotPanel(){
  const [inspection,setInspection]=useState<Inspection|null>(null);
  const [trial,setTrial]=useState<Trial|null>(null);
  const [approved,setApproved]=useState(false);
  const [typedName,setTypedName]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  async function check(){
    if(busy)return;setBusy(true);setNotice('');
    try{
      const [a,b]=await Promise.all([
        fetch('/api/operator/followers-auto-follow-readiness',{
          method:'GET',credentials:'same-origin',cache:'no-store'}),
        fetch('/api/operator/followers-auto-follow-run',{
          method:'GET',credentials:'same-origin',cache:'no-store'}),
      ]);
      if(!a.ok||!b.ok)throw Error('Consulta recusada');
      setInspection(await a.json() as Inspection);
      setTrial(await b.json() as Trial);
    }catch{setNotice('Não foi possível conferir a preparação do teste.');}
    finally{setBusy(false);}
  }
  async function send(operation:'launch-one'|'check-result'){
    if(busy)return;
    if(operation==='launch-one' &&
        (!approved||!trial?.enabled||typedName!==trial.accountName||
         inspection?.providerCheck!=='matched'||trial.attempted))return;
    setBusy(true);setNotice('');
    try{
      const payload=operation==='launch-one'?
        {operation,approval:FOLLOWERS_TRIAL_APPROVAL,accountConfirmation:typedName}:
        {operation};
      const response=await fetch('/api/operator/followers-auto-follow-run',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
      });
      const result=await response.json() as {status?:string;containerStatus?:string};
      setNotice(response.ok?
        operation==='launch-one'
          ?'Lançamento solicitado. Isso não comprova que o Instagram seguiu alguém.'
          :'Consulta concluída: '+(result.containerStatus??'resultado registrado')+
            '. Ainda não há confirmação de follow.':
        'Resultado não confirmado. Não repita a execução automaticamente.');
      setApproved(false);setTypedName('');
      const state=await fetch('/api/operator/followers-auto-follow-run',{
        method:'GET',credentials:'same-origin',cache:'no-store'});
      if(state.ok)setTrial(await state.json() as Trial);
    }catch{setNotice('Resposta incerta; nenhuma repetição automática será feita.');}
    finally{setBusy(false);}
  }
  const launchReady=Boolean(inspection?.providerCheck==='matched'&&
    trial?.enabled&&!trial.attempted&&approved&&typedName===trial.accountName);
  return <section className="rounded-lg border p-4 space-y-3">
    <h2 className="text-sm font-semibold">Teste real isolado — Followers Auto Follow</h2>
    <p className="text-xs text-muted-foreground">
      Conta de teste: @contateste6699. Referência: @mameto_lueji.
      Um único lançamento, sem agendamento e sem unfollow automático.
      O PhantomBuster escolhe o seguidor: não podemos verificar a lista de exclusões
      antecipadamente. O resultado do contêiner não comprova um follow.
    </p>
    <Button type="button" variant="outline" disabled={busy}
      onClick={()=>void check()}>
      {busy?'Verificando...':'Conferir agente e estado do teste'}
    </Button>
    {inspection&&trial&&<div role="status" className="text-xs space-y-2">
      <p>Agente: {inspection.providerCheck}.
        Um perfil por lançamento: {inspection.oneFollowPerLaunchVerified?'confirmado':'não confirmado'}.</p>
      <p>Conta registrada: {inspection.accountRegistered?'sim':'não'}.
        Referência: {inspection.referenceRegistered?'sim':'não'}.</p>
      <p>Lançamento real: {trial.enabled?'habilitado para confirmação manual':'bloqueado no Preview'}.
        Tentativa anterior: {trial.attempt?.stage??'nenhuma'}.</p>
      <p>A sessão foi informada como @contateste6699 pelo titular,
        mas sua identidade não é comprovada pela API do PhantomBuster.</p>
      {trial.enabled&&!trial.attempted&&inspection.providerCheck==='matched'&&
        <div className="border-t pt-2 space-y-2">
          <label className="flex gap-2 items-start">
            <input type="checkbox" checked={approved} disabled={busy}
              onChange={e=>setApproved(e.target.checked)} />
            <span>Confirmo que a sessão ativa é de @contateste6699.
              Autorizo apenas um lançamento real que pode seguir um seguidor
              escolhido pelo PhantomBuster.</span>
          </label>
          <label className="block" htmlFor="trial-account-name">
            Digite o nome da conta de teste para confirmar
          </label>
          <input id="trial-account-name" value={typedName}
            onChange={e=>setTypedName(e.target.value)}
            className="rounded border px-2 py-1" autoComplete="off" />
          <Button type="button" variant="outline" disabled={!launchReady||busy}
            onClick={()=>void send('launch-one')}>Autorizar uma execução real</Button>
        </div>}
      {trial.attempt&&
        ['launch-accepted','container-finished','container-failed'].includes(
          trial.attempt.stage)&&
        <Button type="button" variant="outline" disabled={busy}
          onClick={()=>void send('check-result')}>Consultar execução registrada</Button>}
      {trial.attempt&&['reserved','uncertain'].includes(trial.attempt.stage)&&
        <p>A tentativa não tem contêiner confirmado. Não repita o lançamento;
          confira diretamente o histórico do agente no PhantomBuster.</p>}
      <p>Follows confirmados: 0. Unfollow automático: desativado.</p>
    </div>}
    {notice&&<p role="alert" className="text-sm">{notice}</p>}
  </section>;
}
