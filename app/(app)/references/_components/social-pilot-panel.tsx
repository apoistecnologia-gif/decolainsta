'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {FOLLOWERS_TRIAL_APPROVAL} from '@/lib/reference-followers-trial';

type Inspection={
  accountRegistered:boolean;referenceRegistered:boolean;agentConfigured:boolean;
  providerCheck:string;oneFollowPerLaunchVerified:boolean;agentLaunchEnabled:false;
  privateExclusionRequested:boolean;privateExclusionStatus:string;
  privateExclusionVerified:boolean;
};
type Attempt={
  stage:string;requestedAt:string|null;followConfirmed:false;
  recipientKnown:false;mayRetryAutomatically:false;
  providerReportedUsername?:string|null;providerReportedCount?:number;
  relationshipObservation?:'requested'|'following'|'none'|'unknown';
  relationshipObservedAt?:string|null;
  providerReportedPrivate?:boolean|null;
  providerPrivacyReadAt?:string|null;
  unfollowEligibleAt?:null;
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
  const [observedStatus,setObservedStatus]=useState<'requested'|'following'|'none'>(
    'requested');
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
  async function send(operation:'launch-one'|'check-result'|
    'check-provider-report'|'record-relationship'|'check-profile-privacy'){
    if(busy)return;
    if(operation==='launch-one' &&
        (!approved||!trial?.enabled||typedName!==trial.accountName||
         inspection?.providerCheck!=='matched'||
         !inspection.privateExclusionVerified||trial.attempted))return;
    setBusy(true);setNotice('');
    try{
      const payload=operation==='launch-one'?
        {operation,approval:FOLLOWERS_TRIAL_APPROVAL,accountConfirmation:typedName}:
        operation==='record-relationship'?
          {operation,observedStatus}:{operation};
      const response=await fetch('/api/operator/followers-auto-follow-run',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
      });
      const result=await response.json() as {
        status?:string;containerStatus?:string;providerStatus?:string;
        providerReportedUsername?:string|null;relationshipObservation?:string;
        providerPrivacyStatus?:string;
      };
      setNotice(response.ok?
        operation==='launch-one'
          ?'Lançamento solicitado. Isso não comprova que o Instagram seguiu alguém.'
          :operation==='record-relationship'
            ?'Situação observada no aplicativo registrada: '+
              (result.relationshipObservation??'sem confirmação')+
              '. O prazo de 48 horas não foi iniciado.'
          :operation==='check-profile-privacy'
            ?result.providerPrivacyStatus==='private'
              ?'O PhantomBuster informou que o perfil é privado. A solicitação pendente continua sem follow confirmado.'
              :result.providerPrivacyStatus==='public'
                ?'O PhantomBuster informou que o perfil é público. Isso não comprova relacionamento.'
                :'Privacidade não comprovada pelo resultado salvo: '+
                  (result.providerPrivacyStatus??'indisponível')+'.'
          :operation==='check-provider-report'
            ?result.providerStatus==='provider-reported'
              ?'O PhantomBuster reportou 1 perfil seguido: @'+
                result.providerReportedUsername+
                '. Verificação independente no Instagram ainda pendente.'
              :'Resultado do provedor: '+(result.providerStatus??'indisponível')+
                '. A conclusão do contêiner continua preservada.'
            :'Consulta concluída: '+(result.containerStatus??'resultado registrado')+
              '. Ainda não há confirmação independente do follow.':
        'Resultado não confirmado. Não repita a execução automaticamente.');
      setApproved(false);setTypedName('');
      const state=await fetch('/api/operator/followers-auto-follow-run',{
        method:'GET',credentials:'same-origin',cache:'no-store'});
      if(state.ok)setTrial(await state.json() as Trial);
    }catch{setNotice('Resposta incerta; nenhuma repetição automática será feita.');}
    finally{setBusy(false);}
  }
  const launchReady=Boolean(inspection?.privateExclusionVerified&&
    inspection?.providerCheck==='matched'&&
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
      <p>Filtro de perfis privados: <strong>{
        inspection.privateExclusionStatus==='enabled'?'habilitado (manifesto e argumento)':
        inspection.privateExclusionStatus==='disabled'?'desabilitado':
        'não verificado'}</strong>.
        Preferência da conta: {inspection.privateExclusionRequested
          ?'excluir privados':'não exige exclusão'}.</p>
      <p>Conta registrada: {inspection.accountRegistered?'sim':'não'}.
        Referência: {inspection.referenceRegistered?'sim':'não'}.</p>
      <p>Lançamento real: {trial.enabled?'habilitado para confirmação manual':'bloqueado no Preview'}.
        Tentativa anterior: {trial.attempt?.stage??'nenhuma'}.</p>
      <p>A sessão foi informada como @contateste6699 pelo titular,
        mas sua identidade não é comprovada pela API do PhantomBuster.</p>
      {trial.enabled&&!trial.attempted&&inspection.providerCheck==='matched'&&
        inspection.privateExclusionVerified&&
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
      {trial.attempt&&['container-finished','provider-reported'].includes(
        trial.attempt.stage)&&
        <Button type="button" variant="outline" disabled={busy}
          onClick={()=>void send('check-provider-report')}>
          Importar resultado desta execução
        </Button>}
      {trial.attempt?.providerReportedUsername&&
        <div className="space-y-2">
          <p>PhantomBuster reportou uma ação para
            <strong> @{trial.attempt.providerReportedUsername}</strong>.
            Isso pode ser só uma solicitação para perfil privado.</p>
          <p>Privacidade informada pelo PhantomBuster: <strong>{
            trial.attempt.providerReportedPrivate===true?'privado':
              trial.attempt.providerReportedPrivate===false?'público':
                'não informada'}</strong>. Não comprova follow.</p>
          {trial.attempt.providerReportedPrivate==null&&
            <Button type="button" variant="outline" disabled={busy}
              onClick={()=>void send('check-profile-privacy')}>
              Consultar privacidade da execução salva
            </Button>}
          <p>Situação observada no Instagram:
            <strong> {trial.attempt.relationshipObservation==='requested'
              ?'Solicitado — aguardando aprovação'
              :trial.attempt.relationshipObservation==='following'
                ?'Seguindo — informado pelo titular'
                :trial.attempt.relationshipObservation==='none'
                  ?'Sem solicitação ou follow ativo'
                  :'Ainda não registrada'}</strong>.</p>
          <label htmlFor="observed-relationship" className="block">
            Após conferir o perfil no aplicativo, registre a situação
          </label>
          <select id="observed-relationship" value={observedStatus}
            disabled={busy} onChange={e=>setObservedStatus(
              e.target.value as 'requested'|'following'|'none')}
            className="rounded border px-2 py-1">
            <option value="requested">Solicitado (aguardando aprovação)</option>
            <option value="following">Seguindo (aprovado)</option>
            <option value="none">Não está seguindo / sem pedido</option>
          </select>
          <Button type="button" variant="outline" disabled={busy}
            onClick={()=>void send('record-relationship')}>
            Salvar situação conferida
          </Button>
          <p>Esta informação é uma observação do titular. Não ativa ações,
            não confirma follow por API e não inicia o prazo de 48 horas.</p>
        </div>}
      {trial.attempt&&['reserved','uncertain'].includes(trial.attempt.stage)&&
        <p>A tentativa não tem contêiner confirmado. Não repita o lançamento;
          confira diretamente o histórico do agente no PhantomBuster.</p>}
      <p>Ações reportadas pelo PhantomBuster: {trial.attempt?.providerReportedCount??0}.
        Pedidos pendentes observados: {trial.attempt?.relationshipObservation==='requested'?1:0}.
        Follows comprovados tecnicamente: 0.
        Unfollow automático: desativado.</p>
    </div>}
    {notice&&<p role="alert" className="text-sm">{notice}</p>}
  </section>;
}
