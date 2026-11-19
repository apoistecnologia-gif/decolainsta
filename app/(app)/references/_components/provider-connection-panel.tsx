'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ProviderStatus =
  | 'verified' | 'not-configured' | 'disabled' | 'invalid-key'
  | 'limited' | 'unavailable' | 'unexpected-response';

type ProviderResult = {
  status: ProviderStatus;
  workspaceAgentCount?: number;
  instagramConnectionVerified: false;
  actionsEnabled: false;
};

const MESSAGES: Record<ProviderStatus, string> = {
  verified: 'A chave de API foi aceita e conseguimos ler a lista de agentes da workspace. Isso NÃO comprova login no Instagram.',
  'not-configured': 'Falta a chave de API da PhantomBuster no ambiente de teste. Nenhuma solicitação foi enviada ao provedor.',
  disabled: 'Integração em modo bloqueado. Falta habilitar esta conta específica no ambiente experimental.',
  'invalid-key': 'A PhantomBuster não autorizou a chave da API. Verifique a configuração no cofre; não envie a chave aqui.',
  limited: 'A API da PhantomBuster indicou limite de requisições. Não tente repetidamente.',
  unavailable: 'Não foi possível verificar a workspace neste momento. Nenhuma ação no Instagram foi executada.',
  'unexpected-response': 'A API respondeu em um formato inesperado; é necessário revisar a integração antes de prosseguir.',
};

export function ProviderConnectionPanel({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<ProviderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setStatus(null);
    setMessage('');
  }, [accountId]);

  async function check() {
    if (!accountId || busy) return;
    setBusy(true);
    setMessage('');
    setStatus(null);
    try {
      const response = await fetch(
        `/api/provider/phantombuster?accountId=${encodeURIComponent(accountId)}`,
        { method: 'GET', cache: 'no-store' },
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        const error = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Falha na consulta de integração';
        throw new Error(error);
      }
      const result = data as ProviderResult;
      if (!Object.prototype.hasOwnProperty.call(MESSAGES, result.status)) throw new Error('Resposta não reconhecida');
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
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Integração com a PhantomBuster — piloto</CardTitle>
        <CardDescription>
          Verificação somente leitura da workspace do provedor. Não é uma conexão OAuth do Instagram,
          não extrai sessões e não inicia nenhuma automação de seguir ou deixar de seguir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Primeiro conecte a conta de TESTE do Instagram pela extensão oficial na PhantomBuster. Uma sessão conectada
          concede acesso à conta ao terceiro e pode sofrer restrições. A API do provedor requer um plano pago.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href="https://phantombuster.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
            Abrir PhantomBuster <ExternalLink className="h-3 w-3" />
          </a>
          <a href="https://support.phantombuster.com/hc/en-us/articles/4401916698130-How-to-Get-Started-with-the-PhantomBuster-API"
            target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
            Guia oficial da API <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Button type="button" variant="outline" disabled={!accountId || busy} onClick={check}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {busy ? 'Verificando...' : 'Verificar conexão com a workspace'}
        </Button>
        {!accountId && <p>Escolha uma conta acima para habilitar a verificação.</p>}
        {status && <p role="status">{MESSAGES[status.status]}</p>}
        {status?.status === 'verified' && (
          <p className="text-muted-foreground">
            Agentes na workspace: {status.workspaceAgentCount ?? 'desconhecido'}. Estado do Instagram: não verificado.
            Ações automáticas: desativadas.
          </p>
        )}
        {message && <p role="alert" className="text-destructive">{message}</p>}
        <p className="text-muted-foreground text-xs">
          Não cole chave API, senha ou cookie do Instagram neste painel ou no chat.
          O DECOLA INSTA não envia comandos de follow/unfollow por esta integração.
        </p>
      </CardContent>
    </Card>
  );
}
