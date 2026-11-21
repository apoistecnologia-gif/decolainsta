'use client';

import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';

type MetaReadiness={
  integrationEnabled:boolean;oauthConfigured:boolean;
  webhookConfigured:boolean;migrationReady:boolean;
  messagingConnected:boolean;accountRegistered:boolean;
  accountId?:string|null;nextStep:string;
  existingFacebookLoginConfigured:boolean;
  sameMetaAppCanSupportInstagramProduct:boolean;
  facebookMessagingPermissionsVerified:boolean;
  facebookMessagingPageTokenConfigured:boolean;
};
type UnfollowReadiness={
  linked:boolean;verification:string;
  providerProtectsFollowBack:boolean;
  safeToExecuteAutomatically:false;actionEnabled:false;
};
const steps:Record<string,string>={
  autorizar_configuracao_separada:
    'Integração desativada: autorização e configuração separada da Meta necessárias.',
  aplicar_migracao_isolada:
    'Preparar banco isolado de testes e aplicar migração após autorização.',
  configurar_instagram_login:
    'Configurar Instagram Login da Meta com permissões de mensagens.',
  configurar_webhook_assinado:
    'Configurar e validar o webhook assinado da Meta.',
  conectar_conta_profissional:
    'Conectar conta profissional pela autorização oficial do Instagram.',
  validar_assinatura_e_permissoes:
    'Testar recebimento de DM autorizada e permissões de perfil na Meta.',
};

export function RelationshipIntegrationsPanel(){
  const [meta,setMeta]=useState<MetaReadiness|null>(null);
  const [unfollow,setUnfollow]=useState<UnfollowReadiness|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const reload=useCallback(async()=>{
    setBusy(true);setError('');
    try{
      const [a,b]=await Promise.all([
        fetch('/api/operator/instagram-messaging/readiness',{
          cache:'no-store',credentials:'same-origin',
        }),
        fetch('/api/operator/phantombuster-unfollow-readiness',{
          cache:'no-store',credentials:'same-origin',
        }),
      ]);
      if(!a.ok||!b.ok)throw new Error('Consulta indisponível');
      setMeta(await a.json() as MetaReadiness);
      setUnfollow(await b.json() as UnfollowReadiness);
    }catch{setError('Não foi possível consultar os requisitos');}
    finally{setBusy(false);}
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    const options={cache:'no-store' as const,credentials:'same-origin' as const,
      signal:controller.signal};
    void Promise.all([
      fetch('/api/operator/instagram-messaging/readiness',options),
      fetch('/api/operator/phantombuster-unfollow-readiness',options),
    ]).then(async ([a,b])=>{
      if(!a.ok||!b.ok)throw Error('unavailable');
      const [m,u]=await Promise.all([
        a.json() as Promise<MetaReadiness>,
        b.json() as Promise<UnfollowReadiness>,
      ]);
      if(!controller.signal.aborted){setMeta(m);setUnfollow(u);}
    }).catch(()=>{
      if(!controller.signal.aborted)
        setError('Não foi possível consultar os requisitos');
    });
    return ()=>controller.abort();
  },[]);
  const readyToConnect=Boolean(meta?.integrationEnabled&&meta?.migrationReady&&
    meta?.oauthConfigured&&meta?.webhookConfigured&&meta?.accountId);
  return <div className="space-y-3 pt-3 text-sm">
    <p>Verificações de leitura apenas. Não criam agentes, não enviam
      mensagens e não executam follow ou unfollow.</p>
    <button type="button" onClick={()=>void reload()} disabled={busy}
      className="rounded border px-3 py-2">
      {busy?'Conferindo...':'Conferir integrações'}
    </button>
    {error&&<p role="alert">{error}</p>}
    {meta&&<div className="space-y-1">
      <p className="font-medium">Meta — verificação oficial por mensagem</p>
      <p>Aplicativo empresarial já configurado: {
        meta.existingFacebookLoginConfigured?'sim':'não confirmado'}.
        É possível acrescentar o produto Instagram ao aplicativo existente,
        sem substituir a integração empresarial.</p>
      <p>Alternativa pelo Facebook Login: requer permissões de mensagens e
        token autorizado de Página. Permissões verificadas: {
          meta.facebookMessagingPermissionsVerified?'sim':'não'}.
        Token de Página: {
          meta.facebookMessagingPageTokenConfigured?'configurado':'não configurado'}.
        O token empresarial atual não deve ser tratado como token de Página.</p>
      <p>Conexão: {meta.messagingConnected?'conectada':'não conectada'}.
        Banco de testes: {meta.migrationReady?'preparado':'não confirmado'}.
        OAuth: {meta.oauthConfigured?'configurado':'pendente'}.
        Webhook assinado: {meta.webhookConfigured?'configurado':'pendente'}.</p>
      <p>{steps[meta.nextStep]??'Permissões e sessão precisam ser validadas.'}</p>
      {readyToConnect&&<Link className="underline"
        href={'/api/instagram/messaging/connect?accountId='+
          encodeURIComponent(meta.accountId!)}>
        Autorizar conexão de mensagens da conta de teste
      </Link>}
    </div>}
    {unfollow&&<div className="space-y-1">
      <p className="font-medium">PhantomBuster — Auto Unfollow</p>
      <p>Agente existente: {unfollow.linked?'vinculado':'não vinculado'}.
        Proteção de follow-back: {unfollow.providerProtectsFollowBack
          ?'configuração identificada':'não comprovada'}.
        Execução automática: desativada.</p>
      <p>Não será usado na solicitação pendente original.</p>
    </div>}
  </div>;
}
