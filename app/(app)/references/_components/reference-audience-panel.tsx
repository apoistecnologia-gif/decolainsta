'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, ExternalLink } from 'lucide-react';

type Reference = { id: string; username: string };
type PreviewStatus = 'found' | 'no-run' | 'no-results' | 'unsupported-result'
  | 'invalid-key' | 'rate-limited' | 'unavailable';
type Preview = {
  status: PreviewStatus;
  usernames: string[];
  referenceUsername: string;
  referenceVerified: false;
  source: 'operator_assigned_collector_result';
  savedToDatabase: false;
  actionsEnabled: false;
};

const MESSAGES: Record<PreviewStatus, string> = {
  found: 'A API retornou nomes do resultado anterior. A origem da lista ainda não foi auditada pela Meta.',
  'no-run': 'O coletor informado não tem nenhuma execução finalizada.',
  'no-results': 'A última execução não retornou nomes válidos para esta prévia.',
  'unsupported-result': 'O formato do resultado não é compatível com o modo de leitura atual.',
  'invalid-key': 'A PhantomBuster recusou a chave API. Não a compartilhe por mensagens.',
  'rate-limited': 'A API aplicou uma restrição de acesso. Nenhuma nova tentativa será feita automaticamente.',
  unavailable: 'Não foi possível ler a última execução do coletor.',
};

export function ReferenceAudiencePanel({
  accountId,
  references,
}: {
  accountId: string;
  references: Reference[];
}) {
  const [referenceId, setReferenceId] = useState('');
  const [collectorAgentId, setCollectorAgentId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = references.some(ref => ref.id === referenceId)
    ? referenceId
    : (references[0]?.id ?? '');

  async function check() {
    if (!selected || !accountId || busy) return;
    const key = apiKey.trim();
    const agent = collectorAgentId.trim();
    if (!/^\d{10,25}$/.test(agent) || !key) {
      setError('Preencha a chave API e o ID numérico do Instagram Follower Collector.');
      return;
    }
    setApiKey(''); // Never persist secrets in local/session storage.
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const response = await fetch('/api/provider/phantombuster/audience-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        credentials: 'same-origin',
        body: JSON.stringify({ accountId, referenceId: selected, collectorAgentId: agent, apiKey: key }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const reason = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Falha na consulta';
        throw Error(reason);
      }
      const parsed = data as Preview;
      if (!Object.prototype.hasOwnProperty.call(MESSAGES, parsed.status) ||
          !Array.isArray(parsed.usernames)) throw Error('Resposta desconhecida');
      setResult(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na verificação');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Seguidores de referência — prévia experimental</CardTitle>
        <CardDescription>
          Consulta somente resultados antigos de um Instagram Follower Collector configurado por você.
          Não inicia coleta, follow ou unfollow, e não salva perfis no banco.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Esta prévia mostra no máximo 10 nomes por leitura. A referência é indicada por você:
          o DECOLA INSTA ainda não confirma automaticamente se cada perfil segue aquela conta.
        </p>
        {!references.length ? (
          <p>Cadastre uma conta de referência no formulário acima antes de consultar resultados.</p>
        ) : (
          <>
            <label htmlFor="collector-reference" className="block font-medium">Conta de referência cadastrada</label>
            <select id="collector-reference" value={selected}
              onChange={e => { setReferenceId(e.target.value); setResult(null); }}
              className="w-full rounded-md border bg-background px-3 py-2">
              {references.map(ref => <option key={ref.id} value={ref.id}>@{ref.username}</option>)}
            </select>
            <label htmlFor="collector-agent-id" className="block font-medium">ID da automação Instagram Follower Collector</label>
            <Input id="collector-agent-id" value={collectorAgentId}
              onChange={e => setCollectorAgentId(e.target.value)}
              maxLength={25} inputMode="numeric" autoComplete="off"
              placeholder="Número que aparece na URL do coletor" />
            <label htmlFor="collector-api-key" className="block font-medium">Chave API da PhantomBuster (temporária)</label>
            <Input id="collector-api-key" type="password" value={apiKey}
              onChange={e => setApiKey(e.target.value)} autoComplete="off" maxLength={512}
              placeholder="Usada somente nesta consulta; não será salva" />
            <Button type="button" variant="outline" onClick={() => void check()} disabled={busy || !accountId}>
              <RefreshCw className="h-4 w-4 mr-2"/>
              {busy ? 'Consultando...' : 'Ler resultados anteriores (sem executar coletor)'}
            </Button>
            <p className="text-xs text-muted-foreground">
              <a className="underline inline-flex items-center gap-1"
                href="https://support.phantombuster.com/hc/en-us/articles/26971109041170-How-to-Use-the-Instagram-Follower-Collector"
                target="_blank" rel="noopener noreferrer">O que é o Instagram Follower Collector <ExternalLink className="h-3 w-3"/></a>.
              Não compartilhe a chave aqui no chat.
            </p>
          </>
        )}
        {result && (
          <div role="status" className="rounded-md border p-3 space-y-2">
            <p>{MESSAGES[result.status]}</p>
            {result.status === 'found' && (
              <>
                <p>Referência indicada: @{result.referenceUsername}. Origem ainda não verificada pela Meta.</p>
                <div className="flex flex-wrap gap-2">
                  {result.usernames.map(name => (
                    <a key={name} href={`https://www.instagram.com/${encodeURIComponent(name)}/`}
                      target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs underline">
                      @{name}
                    </a>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Somente leitura; nenhuma pessoa foi seguida, nenhum registro foi persistido.
                </p>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
