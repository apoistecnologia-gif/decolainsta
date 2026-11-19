'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Account = { id: string; username: string; connected?: boolean };
type Reference = { id: string; username: string };
type Workflow = { references: Reference[] };
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
  const [referenceUsername, setReferenceUsername] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAccount = useCallback(async (id: string, signal?: AbortSignal) => {
    const [referenceResponse, indexResponse] = await Promise.all([
      fetch('/api/reference-workflow?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
      fetch('/api/reference-candidate-queue?accountId=' + encodeURIComponent(id),
        { cache: 'no-store', credentials: 'same-origin', signal }),
    ]);
    const workflow = await readJson<Workflow>(referenceResponse);
    // The candidate index is pilot-only. A 403 means no index for another account,
    // not a failure to list or register that account's references.
    const summary = indexResponse.ok ? await readJson<Index>(indexResponse) : null;
    if (signal?.aborted) return;
    setReferences(workflow.references);
    setIndex(summary);
    setLoading(false);
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
        // Prefer the existing test account for the experimental Preview.
        const preferred = valid.find(a => a.username.toLowerCase() === 'contateste6699')
          ?? valid.find(a => a.connected) ?? valid[0];
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
    void loadAccount(accountId, controller.signal).catch(err => {
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
    setError('');
    try {
      const response = await fetch('/api/instagram-accounts/' + encodeURIComponent(accountId) + '/targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ username: referenceUsername.trim() }),
      });
      await readJson<Reference>(response);
      setReferenceUsername('');
      await loadAccount(accountId);
      setMessage('Referência cadastrada. Nenhuma coleta ou ação foi iniciada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar a referência');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!accountId || busy) return;
    setBusy(true);
    setError('');
    try { await loadAccount(accountId); }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha na atualização'); }
    finally { setBusy(false); }
  }

  const byReference = new Map(index?.byReference.map(item => [item.referenceId, item.candidates]) ?? []);
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
              setIndex(null); setReferences([]); setLoading(true); setError(''); setMessage('');
            }}>
            {accounts.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
            {accounts.map(account => (
              <option key={account.id} value={account.id}>@{account.username}</option>
            ))}
          </select>
          {!accountId && <p className="text-sm text-muted-foreground">
            Nenhuma conta disponível. <Link href="/accounts" className="underline">Abra Contas</Link> para cadastrar uma conta.
          </p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm">{message}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Contas de referência</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{references.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Candidatos identificados</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {index ? index.persistedCandidates : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

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
              {references.map(reference => (
                <div key={reference.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <a className="text-sm font-medium hover:underline" target="_blank" rel="noopener noreferrer"
                    href={'https://www.instagram.com/' + encodeURIComponent(reference.username) + '/'}>
                    @{reference.username} <ArrowUpRight className="inline h-3 w-3" />
                  </a>
                  {index && <span className="text-xs text-muted-foreground tabular-nums">
                    {byReference.get(reference.id) ?? 0} candidatos
                  </span>}
                </div>
              ))}
            </div>
          )}
          <Button type="button" variant="outline" disabled={!accountId || busy} onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar dados
          </Button>
          {index?.lastIndexedAt && (
            <p className="text-xs text-muted-foreground">
              Última importação registrada: {new Date(index.lastIndexedAt).toLocaleDateString('pt-BR')}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span>Automação do Instagram inativa nesta versão.</span>
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
