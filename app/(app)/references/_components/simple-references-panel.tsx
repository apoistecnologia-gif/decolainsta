'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DynamicCollectorControl } from './dynamic-collector-control';
import { FollowPreviewControls } from './follow-preview-controls';

type Account = { id: string; username: string; connected?: boolean; profileFollowersCount?: number | null; lastSyncedAt?: string | null };
type Reference = { id: string; username: string };
type Workflow = { references: Reference[] };
type SyncResult = { status: 'synced' | 'capacity-reached'; synced?: number; total?: number };
type CollectionStatus = {
  statuses: { referenceId: string; state: 'source-linked' | 'awaiting-collector' |
    'awaiting-provider-setup' | 'awaiting-provider-capacity' |
    'collection-completed' | 'collection-started' | 'needs-operator-review' }[];
  linked: number;
  awaiting: number;
};
type RelationshipSummary={
  providerActions:number;pendingObserved:number;followingObserved:number;
  endedObserved:number;unknownRelationships:number;
  followBackYesObserved:number;followBackNoObserved:number;
  independentlyConfirmedFollows:0;independentlyConfirmedFollowBacks:0;
  eligibleForAutomaticUnfollow:0;unfollowAutomationEnabled:false;
};
type Index = {
  persistedCandidates: number;
  byReference: { referenceId: string; referenceUsername: string; candidates: number }[];
  lastIndexedAt: string | null;
  actionsEnabled: false;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error) : 'Falha ao consultar o sistema';
    throw new Error(error);
  }
  return payload as T;
}

export function SimpleReferencesPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [references, setReferences] = useState<Reference[]>([]);
  const [index, setIndex] = useState<Index | null>(null);
  const [collection, setCollection] = useState<CollectionStatus | null>(null);
  const [relationships,setRelationships]=useState<{
    accountId:string;summary:RelationshipSummary;
  }|null>(null);
  const [referenceUsername, setReferenceUsername] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshMessage, setRefreshMessage] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemovalId, setConfirmRemovalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAccount = useCallback(async (id: string, signal?: AbortSignal) => {
    const [referenceResponse, indexResponse, statusResponse, relationshipResponse] = await Promise.all([
      fetch('/api/reference-workflow?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
      fetch('/api/reference-candidate-queue?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
      fetch('/api/reference-collection-status?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
      fetch('/api/reference-relationships?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
    ]);
    const workflow = await readJson<Workflow>(referenceResponse);
    // The candidate index is separately scoped to each owned account.
    // It may be unavailable outside the experimental Preview.
    const summary = indexResponse.ok ? await readJson<Index>(indexResponse) : null;
    const collectionStatus = statusResponse.ok
      ? await readJson<CollectionStatus>(statusResponse) : null;
    const relationships=relationshipResponse.ok
      ? await readJson<RelationshipSummary>(relationshipResponse) : null;
    return { references: workflow.references, index: summary,
      collection: collectionStatus,
      relationships: relationships ? {accountId:id,summary:relationships} : null };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/instagram-accounts', {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    }).then(response => readJson<Account[]>(response))
      .then(accountsResult => {
        if (controller.signal.aborted) return;
        const valid = Array.isArray(accountsResult) ? accountsResult.filter(a =>
          typeof a?.id === 'string' && typeof a?.username === 'string') : [];
        setAccounts(valid);
        // No mandatory test account: choose an owned connected profile if one exists.
        const preferred = valid.find(a => a.connected) ?? valid[0];
        if (preferred) setAccountId(preferred.id);
        else setLoading(false);
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar contas');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void loadAccount(accountId, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setReferences(result.references);
          setIndex(result.index);
          setCollection(result.collection);
          setRelationships(result.relationships);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Falha ao carregar referências');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [accountId, loadAccount]);

  async function addReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || !referenceUsername.trim() || busy) return;
    setBusy(true);
    setMessage('');
    setRefreshMessage('');
    setRefreshError('');
    setError('');
    try {
      const response = await fetch('/api/instagram-accounts/' + encodeURIComponent(accountId) + '/targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ username: referenceUsername.trim() }),
      });
      await readJson<Reference>(response);
      setReferenceUsername('');
      const updated = await loadAccount(accountId);
      setReferences(updated.references);
      setIndex(updated.index);
      setCollection(updated.collection);
      setRelationships(updated.relationships);
      setMessage('Referência cadastrada. Nenhuma coleta ou ação foi iniciada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar a referência');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!accountId || busy || loading) return;
    setBusy(true);
    setError('');
    setRefreshError('');
    setRefreshMessage('');
    try {
      const phases: string[] = [];
      let needsAdminAuthorization = false;
      // Admin discovery associates only EXISTING matching collectors; regular
      // users get a safe 403, without selecting a collector or another profile.
      try {
        const matched = await fetch('/api/provider/phantombuster/match-collectors', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          body: JSON.stringify({ accountId, operation: 'match-existing' }),
        });
        if (matched.ok) {
          const result = await matched.json() as {
            matched?: number; unmatched?: number; ambiguousOrInUse?: number;
            excludedByOwner?: number;
          };
          if ((result.matched ?? 0) > 0)
            phases.push((result.matched ?? 0) + ' coletor(es) existentes vinculados às referências.');
          else if ((result.ambiguousOrInUse ?? 0) > 0)
            phases.push('Vínculo pendente: mais de um coletor possível ou coletor já utilizado.');
          else if ((result.unmatched ?? 0) > 0)
            phases.push('Coletores existentes não correspondem às referências cadastradas.');
          else if ((result.excludedByOwner ?? 0) > 0)
            phases.push('Há referências com associação de coleta revogada.');
        } else if (matched.status === 403) {
          const detail = await matched.json().catch(() => null) as { error?: string } | null;
          if (detail?.error === 'Acesso restrito ao administrador')
            needsAdminAuthorization = true;
        }
      } catch {
        // Provider discovery must never block saved reference records.
      }
      // Read only previously finalized provider results for this one customer.
      try {
        const response = await fetch('/api/provider/phantombuster/refresh-now', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          body: JSON.stringify({ accountId, operation: 'refresh-readonly' }),
        });
        if (response.ok) {
          const info = await response.json() as {
            enabled?: boolean; examined?: number; newCandidatesObserved?: number;
            historicalOnly?: number; failed?: number; indexed?: number;
            deferredByHistoryLimit?: number;
          };
          if (info.enabled && (info.newCandidatesObserved ?? 0) > 0)
            phases.push((info.newCandidatesObserved ?? 0) + ' nome(s) novos da coleta posterior ao vínculo.');
          if (info.enabled && (info.indexed ?? 0) > 0)
            phases.push((info.indexed ?? 0) + ' nome(s) adicionados ao índice.');
          if (info.enabled && (info.deferredByHistoryLimit ?? 0) > 0)
            phases.push((info.deferredByHistoryLimit ?? 0) + ' nome(s) aguardam ampliação do histórico.');
          if (info.enabled && (info.historicalOnly ?? 0) > 0)
            phases.push('Resultado antigo encontrado: registros históricos preservados, sem nova importação.');
          if (info.enabled && info.examined === 0)
            phases.push('Nova leitura ainda não realizada: intervalo de segurança entre consultas.');
          if (info.enabled && (info.failed ?? 0) > 0)
            phases.push('Leitura do coletor não concluída; confira o diagnóstico da conexão.');
        }
      } catch {
        // Previously stored data remains readable when the provider is unavailable.
      }
      let syncResult: SyncResult | null = null;
      // Synchronize only stored, operator-approved history when the experimental
      // index is available. This never starts a collector or Instagram operation.
      if (index !== null) {
        const response = await fetch('/api/reference-candidate-queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
          body: JSON.stringify({ accountId, operation: 'sync-saved-history' }),
        });
        syncResult = await readJson<SyncResult>(response);
      }
      const updated = await loadAccount(accountId);
      setReferences(updated.references);
      setIndex(updated.index);
      setCollection(updated.collection);
      setRelationships(updated.relationships);
      try {
        const connectionResponse = await fetch(
          '/api/provider/phantombuster/connection-status?accountId=' +
          encodeURIComponent(accountId),
          { cache: 'no-store', credentials: 'same-origin' });
        if (connectionResponse.ok) {
          const connection = await connectionResponse.json() as {
            status: string; providerReached: boolean;
            waitingForCollectors: number; linkedCollectors: number;
            collectorCheck?: string; lastReadStatus?: string | null;
          };
          if (needsAdminAuthorization && connection.waitingForCollectors > 0)
            phases.push('Vínculo pendente de autorização administrativa.');
          if (connection.providerReached && connection.linkedCollectors > 0) {
            const diagnostics: Record<string, string> = {
              'invalid-key': 'A API não autorizou a consulta ao coletor vinculado.',
              'rate-limited': 'O PhantomBuster limitou temporariamente a consulta ao coletor.',
              'not-found': 'A chave da API não consegue localizar este coletor no workspace configurado.',
              'mismatch': 'A configuração do coletor não corresponde à referência cadastrada.',
              'unavailable': 'A API responde, mas não foi possível consultar os detalhes do coletor.',
            };
            const problem = connection.collectorCheck
              ? diagnostics[connection.collectorCheck] : undefined;
            if (problem) phases.push(problem);
            else if (connection.lastReadStatus === 'historical-only')
              phases.push('Resultado antigo preservado; nenhuma coleta nova foi importada.');
            else if (connection.lastReadStatus === 'source-unavailable' &&
                connection.collectorCheck !== 'matched')
              phases.push('A última tentativa de leitura não conseguiu confirmar o coletor.');
          }
          if (connection.providerReached) {
            phases.push(connection.waitingForCollectors > 0
              ? 'API conectada; ' + connection.waitingForCollectors +
                ' referência(s) aguardando coletor.'
              : 'API conectada; ' + connection.linkedCollectors +
                ' coletor(es) vinculado(s).');
          } else if (connection.status === 'invalid-key')
            phases.push('A chave API cadastrada não foi autorizada.');
          else if (connection.status === 'not-configured')
            phases.push('Chave do PhantomBuster ausente no servidor.');
          else if (connection.status === 'disabled')
            phases.push('Consulta do PhantomBuster desativada.');
          else if (connection.status === 'limited')
            phases.push('Limite de acesso temporário do PhantomBuster.');
          else
            phases.push('Conexão externa ainda não confirmada.');
        }
      } catch {
        // The main page never depends on an external provider request.
      }
      const providerInfo = phases.length ? ' ' + phases.join(' ') : '';
      if (syncResult?.status === 'capacity-reached') {
        setRefreshMessage('Índice de candidatos no limite de capacidade do teste.' + providerInfo);
      } else if (syncResult && (syncResult.synced ?? 0) > 0) {
        setRefreshMessage(`${syncResult.synced} novo(s) candidato(s) dos históricos salvos foram adicionados. Nenhuma ação no Instagram.` + providerInfo);
      } else if (syncResult) {
        setRefreshMessage('Os históricos salvos já estão sincronizados. Nenhuma ação no Instagram.' + providerInfo);
      } else {
        setRefreshMessage('Referências atualizadas.' + providerInfo);
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : 'Falha na atualização');
    } finally { setBusy(false); }
  }

  async function removeReference(reference: Reference) {
    if (!accountId || busy || confirmRemovalId !== reference.id) return;
    setBusy(true);
    setError(''); setMessage(''); setRefreshMessage('');
    try {
      const response = await fetch(
        '/api/instagram-accounts/' + encodeURIComponent(accountId) +
        '/targets/' + encodeURIComponent(reference.id),
        { method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Accept': 'application/json' } },
      );
      await readJson<{ success: true }>(response);
      setConfirmRemovalId(null);
      const updated = await loadAccount(accountId);
      setReferences(updated.references);
      setIndex(updated.index);
      setCollection(updated.collection);
      setRelationships(updated.relationships);
      setMessage('Referência removida. Seus históricos antigos foram preservados, mas não entram nos totais ativos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível remover a referência');
    } finally { setBusy(false); }
  }

  const selectedAccount = accounts.find(item => item.id === accountId);
  const byReference = new Map(index?.byReference.map(item => [item.referenceId, item.candidates]) ?? []);
  const readinessByReference = new Map(
    collection?.statuses.map(item => [item.referenceId, item.state]) ?? []);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conta do Instagram</CardTitle>
          <CardDescription>Escolha a conta e cadastre suas referências. Nenhuma ação de seguir está ativa.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="simple-reference-account" className="block text-sm font-medium">Conta que você quer desenvolver</label>
          <select id="simple-reference-account" className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={accountId} disabled={busy}
            onChange={event => {
              setAccountId(event.target.value);
              setIndex(null); setCollection(null); setReferences([]); setLoading(true);
              setError(''); setMessage(''); setRefreshMessage(''); setRefreshError('');
              setConfirmRemovalId(null);
            }}>
            {accounts.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
            {accounts.map(account => (
              <option key={account.id} value={account.id}>@{account.username}</option>
            ))}
          </select>
          <Link href="/accounts" className="inline-block text-xs underline underline-offset-4">
            Gerenciar contas do Instagram
          </Link>
          {!accountId && <p className="text-sm text-muted-foreground">
            Nenhuma conta disponível. <Link href="/accounts" className="underline">Abra Contas</Link> para cadastrar uma conta.
          </p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm">{message}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {selectedAccount?.connected && <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Seguidores reais (última leitura Meta)</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {selectedAccount.profileFollowersCount ?? '—'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedAccount.lastSyncedAt
                ? 'Sincronizado em ' + new Date(selectedAccount.lastSyncedAt).toLocaleDateString('pt-BR')
                : 'Ainda sem leitura oficial'}
            </p>
          </CardContent>
        </Card>}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Contas de referência</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{references.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Nomes salvos (não verificados)</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {index ? index.persistedCandidates : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {selectedAccount?.connected && <p className="text-xs text-muted-foreground">
        A contagem oficial de seguidores não comprova que novos seguidores vieram
        das referências. Nomes coletados são candidatos, não seguidores conquistados.
      </p>}
      {selectedAccount?.connected && <DynamicCollectorControl
        accountId={accountId}
        onIndexed={()=>{
          void loadAccount(accountId).then(data=>{
            setReferences(data.references);
            setIndex(data.index);
            setCollection(data.collection);
            setRelationships(data.relationships);
          }).catch(()=>undefined);
        }}
      />}
      {selectedAccount?.connected&&<FollowPreviewControls accountId={accountId} />}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Referências cadastradas</CardTitle>
          <CardDescription>Gerencie as contas de referência sem escolher seguidores individualmente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addReference} className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Nome da referência" placeholder="@nova_referencia"
              value={referenceUsername} maxLength={31}
              onChange={event => setReferenceUsername(event.target.value)} />
            <Button type="submit" disabled={!accountId || busy || !referenceUsername.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar referência
            </Button>
          </form>
          {loading && <p className="text-sm text-muted-foreground">Carregando dados...</p>}
          {!loading && !references.length && (
            <p className="text-sm text-muted-foreground">Nenhuma referência cadastrada.</p>
          )}
          {references.length > 0 && (
            <div className="space-y-2">
              {collection && collection.awaiting > 0 && (
                <p className="text-xs text-muted-foreground">
                  {collection.awaiting} referência(s) sem coleta confirmada.
                </p>
              )}
              {references.map(reference => (
                <div key={reference.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <a className="text-sm font-medium hover:underline" target="_blank" rel="noopener noreferrer"
                      href={'https://www.instagram.com/' + encodeURIComponent(reference.username) + '/'}>
                      @{reference.username} <ArrowUpRight className="inline h-3 w-3" />
                    </a>
                    {readinessByReference.has(reference.id) && (
                      <p className="text-xs text-muted-foreground">
                        {readinessByReference.get(reference.id) === 'collection-completed'
                          ? 'Coleta concluída'
                          : readinessByReference.get(reference.id) === 'collection-started'
                            ? 'Coleta iniciada; aguardando confirmação'
                          : readinessByReference.get(reference.id) === 'source-linked'
                          ? 'Fonte de dados vinculada'
                          : readinessByReference.get(reference.id) === 'awaiting-provider-setup'
                            ? 'Aguardando configuração da fonte'
                          : readinessByReference.get(reference.id) === 'awaiting-provider-capacity'
                            ? 'Preparação pendente: capacidade do provedor'
                          : readinessByReference.get(reference.id) === 'needs-operator-review'
                            ? 'Coleta ou configuração exige revisão'
                          : 'Aguardando preparação'}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {index && <span className="text-xs text-muted-foreground tabular-nums">
                      {byReference.get(reference.id) ?? 0} nomes
                    </span>}
                    {confirmRemovalId === reference.id ? (
                      <div className="flex items-center gap-1">
                        <Button type="button" size="sm" variant="destructive"
                          disabled={busy} onClick={() => void removeReference(reference)}>
                          Confirmar
                        </Button>
                        <Button type="button" size="sm" variant="outline"
                          disabled={busy} onClick={() => setConfirmRemovalId(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <Button type="button" variant="ghost" size="sm"
                        disabled={busy}
                        aria-label={'Remover referência @' + reference.username}
                        title="Remover referência"
                        onClick={() => setConfirmRemovalId(reference.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="outline" disabled={!accountId || busy || loading}
            onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> {busy ? 'Atualizando...' : 'Atualizar dados'}
          </Button>
          {refreshMessage && <p role="status" aria-live="polite" className="text-sm">
            {refreshMessage}
          </p>}
          {refreshError && <p role="alert" className="text-sm text-destructive">
            {refreshError}
          </p>}
          <p className="text-xs text-muted-foreground">
            Atualiza as referências e consulta resultados anteriores do provedor quando disponíveis.
            Não inicia uma nova coleta no Instagram nem executa ações de seguir ou deixar de seguir.
          </p>
          {index?.lastIndexedAt && (
            <p className="text-xs text-muted-foreground">
              Última atualização do índice: {new Date(index.lastIndexedAt).toLocaleDateString('pt-BR')}
            </p>
          )}
        </CardContent>
      </Card>

      {relationships&&relationships.accountId===accountId&&
        relationships.summary.providerActions>0&&
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-sm font-medium">Situação observada da conta selecionada</p>
            <p className="text-sm">
              Pedidos pendentes observados: {relationships.summary.pendingObserved}.
              Seguindo, conforme o titular: {relationships.summary.followingObserved}.
              Follows comprovados tecnicamente: {relationships.summary.independentlyConfirmedFollows}.
            </p>
            <p className="text-xs text-muted-foreground">
              Follow-backs relatados: {relationships.summary.followBackYesObserved}.
              Unfollow automático: desativado. São registros de evidências,
              não uma consulta em tempo real ao Instagram.
            </p>
          </CardContent>
        </Card>}
      <Card>
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>Seguir e deixar de seguir automaticamente: desativados. A coleta de candidatos funciona separadamente.</span>
          </div>
          <Link href="/references/diagnostics"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Diagnóstico e importações (experimental)
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
