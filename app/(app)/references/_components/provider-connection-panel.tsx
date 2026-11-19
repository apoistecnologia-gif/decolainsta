'use client';

import { useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type ProviderStatus =
  | 'verified' | 'not-configured' | 'disabled' | 'invalid-key'
  | 'limited' | 'unavailable' | 'unexpected-response' | 'agent-not-found';

type ProviderResult = {
  status: ProviderStatus;
  workspaceAgentCount?: number;
  pilotAgentFound?: boolean;
  instagramConnectionVerified: false;
  actionsEnabled: false;
};

const MESSAGES: Record<ProviderStatus, string> = {
  verified: 'A API da PhantomBuster respondeu com sucesso. Isso NÃO comprova que o Instagram aceita a sessão.',
  'agent-not-found': 'A API foi acessada, mas a automação de teste não foi encontrada nessa workspace.',
  'not-configured': 'Nenhuma chave foi configurada no servidor. Você pode fazer uma consulta única com a sua chave abaixo.',
  disabled: 'Integração bloqueada para esta conta. Use apenas a conta de teste cadastrada.',
  'invalid-key': 'A chave não foi autorizada pela PhantomBuster. Não compartilhe a chave em mensagens.',
  limited: 'O provedor indicou um limite de acesso. Não vamos repetir automaticamente.',
  unavailable: 'Não foi possível verificar a workspace agora. Nenhuma ação no Instagram foi realizada.',
  'unexpected-response': 'A API devolveu dados inesperados. A verificação não foi confirmada.',
};

export function ProviderConnectionPanel({ accountId }: { accountId: string }) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<ProviderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function check() {
    if (!accountId || busy) return;
    const key = apiKey.trim();
    setBusy(true);
    setMessage('');
    setStatus(null);
    setApiKey(''); // Clear the UI immediately: no persistent local/browser storage.
    try {
      const response = await fetch(key ? '/api/provider/phantombuster' :
        `/api/provider/phantombuster?accountId=${encodeURIComponent(accountId)}`, {
        method: key ? 'POST' : 'GET',
        headers: key ? { 'Content-Type': 'application/json' } : undefined,
        body: key ? JSON.stringify({ accountId, apiKey: key }) : undefined,
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const error = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Falha na verificação';
        throw new Error(error);
      }
      const result = data as ProviderResult;
      if (!Object.prototype.hasOwnProperty.call(MESSAGES, result.status)) {
        throw new Error('Resposta não reconhecida');
      }
      setStatus(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível verificar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" /> PhantomBuster — conexão experimental
        </CardTitle>
        <CardDescription>
          Verificação somente leitura da workspace e da automação de teste.
          Não executa follows, unfollows ou login no Instagram.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          A API pode ser testada no plano gratuito e no período de avaliação, com limites de utilização.
          A conexão do Instagram deve ser conferida separadamente na própria PhantomBuster.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="https://phantombuster.com/" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline">
            Abrir PhantomBuster <ExternalLink className="h-3 w-3" />
          </a>
          <a href="https://support.phantombuster.com/hc/en-us/articles/4401916698130-How-to-Get-Started-with-the-PhantomBuster-API"
            target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
            Onde criar a chave API <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <label htmlFor="pilot-provider-api-key" className="block font-medium">
          Chave API da PhantomBuster (não é senha nem cookie do Instagram)
        </label>
        <Input id="pilot-provider-api-key" type="password" autoComplete="off"
          spellCheck={false} value={apiKey} maxLength={512}
          onChange={event => setApiKey(event.target.value)}
          placeholder="Cole aqui somente para verificar uma vez" />
        <p className="text-xs text-muted-foreground">
          A chave será enviada por HTTPS exclusivamente ao servidor do seu Preview para uma
          consulta de leitura e será apagada do campo em seguida. Não será guardada no banco
          ou no navegador. Quem tiver essa chave pode acessar a sua workspace;
          use uma chave exclusiva para testes e revogue-a depois.
        </p>
        <Button type="button" variant="outline" disabled={!accountId || busy} onClick={check}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {busy ? 'Verificando...' : 'Verificar acesso à PhantomBuster (sem executar)'}
        </Button>
        {!accountId && <p>Escolha uma conta de teste no painel acima.</p>}
        {status && <p role="status">{MESSAGES[status.status]}</p>}
        {status?.status === 'verified' && (
          <p className="text-muted-foreground">
            Agentes retornados: {status.workspaceAgentCount ?? 'desconhecido'}.
            Agente de teste: {status.pilotAgentFound === true ? 'encontrado' : 'não verificado'}.
            Instagram: não verificado. Ações automáticas: desativadas.
          </p>
        )}
        {message && <p role="alert" className="text-destructive">{message}</p>}
        <p className="text-muted-foreground text-xs">
          Nunca envie sua chave API ou cookie por mensagem ou captura de tela.
          Mesmo com a API conectada, nenhuma execução de follow/unfollow será iniciada.
        </p>
      </CardContent>
    </Card>
  );
}
