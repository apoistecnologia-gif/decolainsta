'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {SOCIAL_PILOT_FOLLOW_CONFIRMATION} from '@/lib/reference-social-pilot';

type Ready={
  enabled:boolean;configured:boolean;accountRegistered:boolean;
  ownerConnectedByMeta:boolean;providerSessionOwnerConfirmed:boolean;
  referenceRegistered:boolean;
  candidateIndexed:boolean;candidateExcluded:boolean;previousAttempts:number;
  liveActionReady:boolean;oneTestActionOnly:true;unfollowEnabled:false;
};
export function SocialPilotPanel(){
  const [ready,setReady]=useState<Ready|null>(null);
  const [busy,setBusy]=useState(false);
  const [approved,setApproved]=useState(false);
  const [notice,setNotice]=useState('');
  async function check(){
    if(busy)return;
    setBusy(true);setNotice('');
    try{
      const r=await fetch('/api/operator/social-pilot',{
        method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error'});
      if(!r.ok)throw Error('diagnóstico');
      setReady(await r.json() as Ready);
    }catch{setNotice('Não foi possível consultar o preparo da conta de teste.');}
    finally{setBusy(false);}
  }
  async function launch(){
    if(busy||!approved||!ready?.liveActionReady)return;
    setBusy(true);setNotice('');
    try{
      const r=await fetch('/api/operator/social-pilot',{
        method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({operation:'launch-one-follow',
          confirm:SOCIAL_PILOT_FOLLOW_CONFIRMATION}),
      });
      const status=await r.json() as {status?:string};
      setNotice(r.status===202&&status.status==='launch-request-accepted'
        ? 'A execução foi solicitada. Ainda é necessário confirmar o resultado real no provedor.'
        : 'O lançamento não foi confirmado. Não repetir a tentativa automaticamente.');
      setReady(null);
    }catch{setNotice('Lançamento incerto. Não repetir automaticamente.');}
    finally{setBusy(false);}
  }
  return <section className="rounded-lg border p-4 space-y-3">
    <h2 className="text-sm font-semibold">Teste real isolado — seguir/deixar de seguir</h2>
    <p className="text-xs text-muted-foreground">
      Preparação de uma única ação com uma conta Instagram de teste separada.
      Usa uma automação PhantomBuster já configurada, nunca a conta de coleta
      atual. O teste não marca follow como concluído por receber HTTP 200.
      Não há execução automática de unfollow sem comprovação do follow e da
      relação entre as contas.
    </p>
    <Button type="button" variant="outline" disabled={busy} onClick={()=>void check()}>
      {busy?'Verificando...':'Verificar prontidão da conta de teste'}
    </Button>
    {ready&&<div role="status" className="text-xs space-y-1">
      <p>Ativação explícita: {ready.enabled?'sim':'pendente'}.
        Automação configurada: {ready.configured?'sim':'pendente'}.</p>
      <p>Conta cadastrada: {ready.accountRegistered?'sim':'pendente'}.
        Sessão da conta de teste conferida no PhantomBuster: {ready.providerSessionOwnerConfirmed?'sim':'pendente'}.</p>
      <p>Referência: {ready.referenceRegistered?'sim':'pendente'}.
        Candidato: {ready.candidateIndexed?'disponível':'pendente'}.
        Perfil excluído: {ready.candidateExcluded?'sim':'não'}.</p>
      <p>Tentativas anteriores: {ready.previousAttempts}.
        Início permitido: {ready.liveActionReady?'sim':'não'}.</p>
      {ready.liveActionReady&&<div className="space-y-2 pt-2">
        <label className="flex gap-2 items-start">
          <input type="checkbox" checked={approved}
            onChange={e=>setApproved(e.target.checked)} />
          <span>Autorizo exatamente UMA tentativa real de seguir, utilizando
            exclusivamente a conta de teste configurada.</span>
        </label>
        <Button type="button" disabled={busy||!approved} variant="outline"
          onClick={()=>void launch()}>Executar uma ação de teste</Button>
      </div>}
    </div>}
    {notice&&<p role="alert" className="text-sm">{notice}</p>}
  </section>;
}
