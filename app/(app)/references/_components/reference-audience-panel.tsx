'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RefreshCw, ExternalLink, History, Trash2 } from 'lucide-react';
import { summarizeAudienceHistory } from '@/lib/reference-audience-metrics';

type Reference = { id: string; username: string };
type HistoryItem = {
  id: string; savedAt: string; usernames: string[]; collectorAgentId: string;
  resultLocation: 'completed_run' | 'latest_agent_file'; referenceVerified: false;
};
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
  resultLocation?: 'completed_run' | 'latest_agent_file';
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
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const historyMetrics = summarizeAudienceHistory(history);

  const selected = references.some(ref => ref.id === referenceId)
    ? referenceId
    : (references[0]?.id ?? '');

  useEffect(() => {
    if (!accountId || !selected) return;
    let active = true;
    void fetch(`/api/provider/phantombuster/audience-history?accountId=${encodeURIComponent(accountId)}&referenceId=${encodeURIComponent(selected)}`,
      { cache: 'no-store', credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw Error('Histórico indisponível');
        return response.json() as Promise<{ history: HistoryItem[] }>;
      })
      .then(data => { if (active && Array.isArray(data.history)) setHistory(data.history); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [accountId, selected]);

  async function reloadHistory() {
    const response = await fetch(
      `/api/provider/phantombuster/audience-history?accountId=${encodeURIComponent(accountId)}&referenceId=${encodeURIComponent(selected)}`,
      { cache: 'no-store', credentials: 'same-origin' },
    );
    if (!response.ok) throw Error('Não foi possível atualizar o histórico.');
    const data = await response.json() as { history: HistoryItem[] };
    if (Array.isArray(data.history)) setHistory(data.history);
  }

  async function saveHistory() {
    if (!selected || !accountId || busy) return;
    const key = apiKey.trim();
    const agent = collectorAgentId.trim();
    if (!/^\d{10,25}$/.test(agent) || !key) {
      setError('Para registrar, informe novamente o ID do coletor e a chave API temporária.');
      return;
    }
    setApiKey('');
    setError('');
    setHistoryMessage('');
    setBusy(true);
    try {
      const response = await fetch('/api/provider/phantombuster/audience-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        body: JSON.stringify({ accountId, referenceId: selected, collectorAgentId: agent,
          apiKey: key, confirmSave: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const reason = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error) : 'Falha ao registrar histórico';
        throw Error(reason);
      }
      const outcome = data as { status: string; saved: boolean; duplicate: boolean; importedCount?: number };
      if (outcome.saved) {
        setHistoryMessage(`Consulta registrada: ${outcome.importedCount ?? 0} nomes, sem ações no Instagram.`);
      } else if (outcome.duplicate) {
        setHistoryMessage('Esta mesma lista já está registrada. Não houve duplicação.');
      } else if (outcome.status === 'history-limit') {
        setHistoryMessage('Limite de 60 consultas por referência. Exclua uma antiga para liberar espaço.');
      } else if (Object.prototype.hasOwnProperty.call(MESSAGES, outcome.status)) {
        setHistoryMessage(MESSAGES[outcome.status as PreviewStatus]);
      } else throw Error('Resposta desconhecida');
      await reloadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar histórico');
    } finally { setBusy(false); }
  }

  async function importCompleteAudience() {
    if (!selected || !accountId || busy) return;
    const key = apiKey.trim();
    const agent = collectorAgentId.trim();
    if (!/^\d{10,25}$/.test(agent) || !key) {
      setError('Informe o ID do coletor e sua chave API temporária para importar os resultados.');
      return;
    }
    if (!window.confirm(
      'Importar até 500 nomes do resultado já existente para o histórico do DECOLA INSTA? ' +
      'Serão gravados somente usernames, referência e proveniência. Nenhuma ação ocorrerá no Instagram.',
    )) return;
    setApiKey('');
    setError('');
    setHistoryMessage('');
    setBusy(true);
    try {
      const response = await fetch('/api/provider/phantombuster/audience-bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        body: JSON.stringify({ accountId, referenceId: selected, collectorAgentId: agent,
          apiKey: key, confirmBulkImport: true }),
      });
      const data = await response.json() as {
        error?: string; status?: string; importedCount?: number; newBatches?: number;
        totalAvailable?: number;
      };
      if (!response.ok) throw Error(data.error || 'Falha ao importar o resultado completo.');
      if (data.status === 'saved') {
        setHistoryMessage(
          `Importação concluída: ${data.importedCount ?? 0} nomes em ${data.newBatches ?? 0} novos lotes. ` +
          'Atualize a página para sincronizar o índice persistente de candidatos. Não houve ações no Instagram.',
        );
      } else if (data.status === 'duplicate') {
        setHistoryMessage('Esses resultados já constam do histórico. Nenhuma duplicação foi criada.');
      } else if (data.status === 'history-limit') {
        setHistoryMessage('O histórico atingiu o limite de 60 lotes desta referência.');
      } else if (data.status && Object.prototype.hasOwnProperty.call(MESSAGES, data.status)) {
        setHistoryMessage(MESSAGES[data.status as PreviewStatus]);
      } else throw Error('Resposta desconhecida da importação.');
      await reloadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar resultados.');
    } finally { setBusy(false); }
  }

  async function deleteHistory(historyId: string) {
    if (!accountId || !selected || busy ||
      !window.confirm('Excluir esta consulta salva e seus nomes do histórico?')) return;
    setBusy(true);
    setHistoryMessage('');
    setError('');
    try {
      const response = await fetch('/api/provider/phantombuster/audience-history', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
        body: JSON.stringify({ accountId, referenceId: selected, historyId, confirmDelete: true }),
      });
      if (!response.ok) throw Error('Não foi possível excluir o registro.');
      await reloadHistory();
      setHistoryMessage('Consulta removida do histórico.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir histórico');
    } finally { setBusy(false); }
  }

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
          Não inicia coleta, follow ou unfollow. A prévia não salva perfis; o histórico opcional só grava após seu clique.
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
              onChange={e => { setReferenceId(e.target.value); setResult(null); setHistory([]); setHistoryMessage(''); }}
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
            <div className="rounded-md border p-3 space-y-2">
              <p className="font-medium">Histórico opcional de consultas</p>
              <p className="text-xs text-muted-foreground">
                Se escolher registrar, o DECOLA INSTA fará uma nova leitura da execução anterior e
                guardará até 10 nomes, a referência indicada, o ID do coletor, a origem e a data de registro.
                Para importar até 500 nomes, use o botão separado abaixo. Nenhuma opção inicia coleta ou registra follow.
              </p>
              <Button type="button" variant="outline" onClick={() => void saveHistory()}
                disabled={busy || !accountId || !selected}>
                <History className="h-4 w-4 mr-2"/>
                {busy ? 'Processando...' : 'Registrar consulta no histórico'}
              </Button>
              <div className="rounded-md border p-3 space-y-2">
                <p className="font-medium">Importar resultados completos (até 500 nomes)</p>
                <p className="text-xs text-muted-foreground">
                  Usa a execução já concluída da PhantomBuster; salva apenas usernames validados,
                  em lotes de até dez, associados à referência selecionada.
                  A origem permanece não verificada pela Meta. Nenhum follow ou unfollow é executado.
                  É preciso informar a chave temporária novamente para essa operação.
                </p>
                <Button type="button" variant="outline" onClick={() => void importCompleteAudience()}
                  disabled={busy || !accountId || !selected}>
                  <History className="h-4 w-4 mr-2"/>
                  {busy ? 'Importando...' : 'Importar resultado completo do coletor'}
                </Button>
              </div>
              {historyMessage && <p role="status" className="text-sm">{historyMessage}</p>}
            </div>
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
                {result.resultLocation === 'latest_agent_file' && (
                  <p className="text-xs text-muted-foreground">
                    Fonte: arquivo JSON mais recente da PhantomBuster. Pode não representar apenas a última execução.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {result.usernames.map(name => (
                    <a key={name} href={`https://www.instagram.com/${encodeURIComponent(name)}/`}
                      target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs underline">
                      @{name}
                    </a>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Esta prévia é somente leitura. Salvar no histórico requer o botão separado acima.
                  Nenhuma pessoa foi seguida.
                </p>
              </>
            )}
          </div>
        )}
        {references.length > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <p className="font-medium">Histórico registrado desta referência</p>
            <p className="text-xs text-muted-foreground">
              {historyMetrics.consultations} consulta(s), {historyMetrics.distinctNames} nome(s)
              distinto(s), {historyMetrics.repeatedNames} nome(s) presentes em mais de uma consulta.
              Total de {historyMetrics.appearances} ocorrência(s) registradas.
              Dados fornecidos pela PhantomBuster, sem verificação independente da Meta.
            </p>
            {history.length === 0 && <p className="text-muted-foreground text-xs">Nenhuma consulta registrada ainda.</p>}
            {history.map(entry => (
              <div key={entry.id} className="rounded border p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">
                    Registrado em {new Date(entry.savedAt).toLocaleString('pt-BR')}
                    {' · '}{entry.usernames.length} nomes
                    {' · '}{historyMetrics.byBatchId[entry.id]?.newNames ?? 0} novos
                    {' · '}{historyMetrics.byBatchId[entry.id]?.repeatedNames ?? 0} repetidos
                  </span>
                  <Button type="button" variant="ghost" size="sm" disabled={busy}
                    onClick={() => void deleteHistory(entry.id)} aria-label="Excluir consulta salva">
                    <Trash2 className="h-4 w-4"/>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Coletor {entry.collectorAgentId} · {entry.resultLocation === 'latest_agent_file'
                    ? 'Arquivo mais recente do coletor' : 'Execução finalizada'} · Origem indicada, não verificada
                </p>
                <div className="flex flex-wrap gap-1">
                  {entry.usernames.map(name => <a key={name}
                    href={`https://www.instagram.com/${encodeURIComponent(name)}/`}
                    target="_blank" rel="noopener noreferrer"
                    className="border rounded px-2 py-1 text-xs underline">@{name}</a>)}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
