'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, ExternalLink, Plus, RefreshCw, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProviderConnectionPanel } from './provider-connection-panel';
import { Input } from '@/components/ui/input';

const PILOT_USERNAME = 'contateste6699'; // Test-only; manual local record, never Meta OAuth.
type Account = { id: string; username: string; connected?: boolean };
type Reference = { id: string; username: string };
type Lead = {
  id: string;
  username: string;
  reference: string | null;
  status: 'reference_candidate' | 'reference_followed' | 'reference_kept' | 'reference_unfollowed';
  followedAt: string | null;
  followedBack: boolean;
  unfollowedAt: string | null;
  reviewAt: string | null;
  due: boolean;
  protected: boolean;
};
type WorkflowData = {
  account: { id: string; username: string; connected: boolean } | null;
  references: Reference[];
  leads: Lead[];
  source: 'user_reported_not_meta_verified';
};

function profileLink(username: string) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

function displayDate(date: string | null) {
  if (!date) return 'Sem data';
  return new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function readJson(res: Response) {
  const value = await res.json();
  if (!res.ok) throw new Error(value.error ?? 'Não foi possível concluir a operação');
  return value;
}

async function fetchWorkflow(accountId: string): Promise<WorkflowData> {
  const response = await fetch(`/api/reference-workflow?accountId=${encodeURIComponent(accountId)}`, { cache: 'no-store' });
  return readJson(response) as Promise<WorkflowData>;
}

export function ReferenceWorkflowPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [data, setData] = useState<WorkflowData | null>(null);
  const [loadedAccount, setLoadedAccount] = useState('');
  const [referenceUsername, setReferenceUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [selectedReference, setSelectedReference] = useState('');
  const [reviewHours, setReviewHours] = useState<24 | 72>(72);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/instagram-accounts', { cache: 'no-store' })
      .then(readJson)
      .then((result: unknown) => {
        if (!alive) return;
        const list = Array.isArray(result)
          ? result.filter((item): item is Account => typeof item?.id === 'string' && typeof item?.username === 'string')
          : [];
        setAccounts(list);
        setSelectedAccount(list.find(account => account.connected)?.id ?? list[0]?.id ?? '');
      })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Falha ao carregar contas'); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selectedAccount) return;
    let alive = true;
    fetchWorkflow(selectedAccount)
      .then(result => {
        if (!alive) return;
        setData(result);
        setLoadedAccount(selectedAccount);
        setSelectedReference(current => result.references.some(ref => ref.id === current)
          ? current : (result.references[0]?.id ?? ''));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setData(null);
        setLoadedAccount(selectedAccount);
        setError(err instanceof Error ? err.message : 'Falha ao carregar referências');
      });
    return () => { alive = false; };
  }, [selectedAccount]);

  async function refresh(accountId: string) {
    const result = await fetchWorkflow(accountId);
    setData(result);
    setLoadedAccount(accountId);
    setSelectedReference(current => result.references.some(ref => ref.id === current)
      ? current : (result.references[0]?.id ?? ''));
  }

  async function registerPilotAccount() {
    if (busy || accounts.some(account => account.username.toLowerCase() === PILOT_USERNAME)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/instagram-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: PILOT_USERNAME }),
      });
      if (!response.ok && response.status !== 409) {
        await readJson(response);
      }
      // Always reload from the authenticated owner's DB to handle an existing record.
      const list = await readJson(await fetch('/api/instagram-accounts', { cache: 'no-store' })) as Account[];
      const testAccount = list.find(account => account.username.toLowerCase() === PILOT_USERNAME);
      if (!testAccount) throw new Error('A conta de teste não apareceu no cadastro.');
      setAccounts(list);
      setSelectedAccount(testAccount.id);
      setData(null);
      setLoadedAccount('');
      setMessage('Conta @contateste6699 cadastrada apenas para o piloto local. Instagram e Meta não foram autenticados.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar a conta de teste.');
    } finally {
      setBusy(false);
    }
  }

  async function addReference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || busy || !referenceUsername.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await readJson(await fetch(`/api/instagram-accounts/${encodeURIComponent(selectedAccount)}/targets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: referenceUsername }),
      }));
      setReferenceUsername('');
      await refresh(selectedAccount);
      setMessage('Referência cadastrada. Nenhuma lista de seguidores foi coletada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cadastrar a referência');
    } finally { setBusy(false); }
  }

  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || busy || !selectedReference || !newUsername.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await readJson(await fetch('/api/reference-workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccount, referenceId: selectedReference,
          username: newUsername, operation: 'add-lead',
        }),
      }));
      setNewUsername('');
      await refresh(selectedAccount);
      setMessage('Perfil registrado como informação fornecida por você, não verificada pela Meta.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar o perfil');
    } finally { setBusy(false); }
  }

  async function changeLead(lead: Lead, operation: string) {
    if (!selectedAccount || busy) return;
    if (operation === 'confirm-follow' &&
      !window.confirm(`Você já seguiu @${lead.username} diretamente no Instagram? O DECOLA INSTA não executará essa ação.`)) return;
    if (operation === 'confirm-unfollow' &&
      !window.confirm(`Você já deixou de seguir @${lead.username} diretamente no Instagram?`)) return;

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await readJson(await fetch('/api/reference-workflow', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: selectedAccount, leadId: lead.id, operation, hours: operation === 'confirm-follow' ? reviewHours : undefined }),
      }));
      await refresh(selectedAccount);
      setMessage('Registro atualizado com base na confirmação informada por você.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o registro');
    } finally { setBusy(false); }
  }

  const leads = data?.leads ?? [];
  const due = leads.filter(lead => lead.due && !lead.protected);
  const ordered = useMemo(
    () => [...leads].sort((a, b) => Number(b.due && !b.protected) - Number(a.due && !a.protected)),
    [leads],
  );
  const candidateCount = leads.filter(lead => lead.status === 'reference_candidate').length;
  const followedCount = leads.filter(lead => lead.status === 'reference_followed').length;
  const followbackCount = leads.filter(lead => lead.followedBack).length;
  const ready = selectedAccount && loadedAccount === selectedAccount && !!data;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Fluxo principal: audiência das contas de referência</CardTitle>
          <CardDescription>
            Registre as referências e os perfis que você identificou nelas, acompanhe follows confirmados manualmente
            e veja revisões após 24 ou 72 horas. Os dados são declarações suas, não uma coleta automatizada ou auditoria da Meta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-3 text-sm space-y-1">
            <p className="font-medium flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Limites reais da integração</p>
            <p className="text-muted-foreground">
              A API oficial da Meta não fornece a lista de seguidores de referências nem comandos de seguir/deixar de seguir.
              Esta tela não usa cookies, senhas, scraping ou usuários fictícios. Nenhum botão aqui executa follow/unfollow no Instagram.
            </p>
          </div>
          {!accounts.some(account => account.username.toLowerCase() === PILOT_USERNAME) && (
            <div className="rounded-md border p-3 space-y-2 text-sm">
              <p className="font-medium">Conta de teste ainda não cadastrada neste DECOLA INSTA</p>
              <p className="text-muted-foreground">
                Você conectou @contateste6699 na PhantomBuster, mas ela não entra automaticamente
                no cadastro do DECOLA INSTA. O botão abaixo cria apenas um registro local de teste,
                sem senha, sem acessar o Instagram e sem conectar a API oficial da Meta.
              </p>
              <Button type="button" variant="outline" disabled={busy} onClick={registerPilotAccount}>
                <Plus className="h-4 w-4 mr-2" />
                {busy ? 'Cadastrando...' : 'Cadastrar @contateste6699 no piloto'}
              </Button>
            </div>
          )}
          <label htmlFor="workflow-account" className="block text-sm font-medium">Conta que você quer desenvolver</label>
          <select id="workflow-account" disabled={busy} className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedAccount}
            onChange={event => { setSelectedAccount(event.target.value); setData(null); setError(''); setMessage(''); }}>
            {accounts.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
            {accounts.map(account => (
              <option key={account.id} value={account.id}>@{account.username}{account.connected ? ' · Meta conectada' : ' · sem OAuth Meta'}</option>
            ))}
          </select>
          {selectedAccount && !ready && <p className="text-sm text-muted-foreground">Carregando acompanhamento...</p>}
          {!selectedAccount && <p className="text-sm text-muted-foreground">Cadastre ou conecte sua conta na área Contas para começar.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p role="status" className="text-sm text-foreground">{message}</p>}
        </CardContent>
      </Card>

      <ProviderConnectionPanel key={selectedAccount} accountId={selectedAccount} />

      {ready && (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            {[
              { title: 'Perfis registrados', count: leads.length },
              { title: 'Follows informados em aberto', count: followedCount },
              { title: 'Revisões vencidas', count: due.length },
              { title: 'Follow-backs informados', count: followbackCount },
            ].map(item => (
              <div key={item.title} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">{item.title}</p>
                <p className="mt-2 text-2xl font-semibold">{item.count}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">1. Cadastrar conta de referência</CardTitle>
                <CardDescription>Uma conta cuja audiência você deseja estudar. O cadastro não coleta seguidores.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <form className="flex gap-2" onSubmit={addReference}>
                  <Input aria-label="Usuário da conta de referência" placeholder="@conta_referencia" maxLength={31}
                    value={referenceUsername} onChange={event => setReferenceUsername(event.target.value)} />
                  <Button disabled={busy || !referenceUsername.trim()} type="submit"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {(data?.references ?? []).map(ref => (
                    <a key={ref.id} target="_blank" rel="noopener noreferrer" href={profileLink(ref.username)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      @{ref.username} <ExternalLink className="inline-block h-3 w-3" />
                    </a>
                  ))}
                  {data?.references.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma referência cadastrada ainda.</p>}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">2. Registrar perfil identificado</CardTitle>
                <CardDescription>Informe manualmente o perfil que você observou como seguidor de uma referência.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={addLead}>
                  <label htmlFor="workflow-reference" className="block text-sm font-medium">Referência de origem</label>
                  <select id="workflow-reference" value={selectedReference}
                    onChange={event => setSelectedReference(event.target.value)} disabled={busy || !data?.references.length}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {!data?.references.length && <option value="">Cadastre uma referência primeiro</option>}
                    {(data?.references ?? []).map(ref => <option value={ref.id} key={ref.id}>@{ref.username}</option>)}
                  </select>
                  <label htmlFor="workflow-lead" className="block text-sm font-medium">Perfil observado</label>
                  <Input id="workflow-lead" placeholder="@pessoa_observada" maxLength={31}
                    value={newUsername} onChange={event => setNewUsername(event.target.value)} />
                  <Button type="submit" disabled={busy || !selectedReference || !newUsername.trim()} className="w-full">
                    <Plus className="h-4 w-4 mr-1" /> Registrar no acompanhamento
                  </Button>
                  <p className="text-xs text-muted-foreground">Não cole listas coletadas por robôs nem dados privados. O registro não segue ninguém.</p>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><CalendarClock className="h-4 w-4" /> 3. Acompanhar e revisar</CardTitle>
              <CardDescription>
                Abra o perfil no Instagram, execute as ações você mesmo e registre a confirmação aqui.
                O prazo de revisão é persistido no banco e continua contando com o navegador fechado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="workflow-hours" className="text-sm font-medium">Revisar follow após</label>
                <select id="workflow-hours" value={reviewHours} disabled={busy}
                  onChange={event => setReviewHours(Number(event.target.value) === 24 ? 24 : 72)}
                  className="rounded-md border bg-background px-3 py-2 text-sm">
                  <option value={24}>24 horas</option>
                  <option value={72}>72 horas (3 dias)</option>
                </select>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                  setError(''); void refresh(selectedAccount).catch(err => setError(err instanceof Error ? err.message : 'Falha na atualização'));
                }}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {candidateCount} perfil(is) ainda sem follow informado. Ações marcadas como confirmadas são relatos do operador, não eventos auditados pela Meta.
              </p>
              {ordered.length === 0 && <p className="rounded-md border p-4 text-sm text-muted-foreground">Os perfis que você registrar aparecerão aqui com o histórico e a revisão.</p>}
              {ordered.map(lead => (
                <div key={lead.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <a href={profileLink(lead.username)} target="_blank" rel="noopener noreferrer"
                        className="font-medium text-sm underline underline-offset-2">
                        @{lead.username} <ExternalLink className="inline-block h-3 w-3" />
                      </a>
                      <p className="text-xs text-muted-foreground">Origem informada: @{lead.reference ?? 'não identificada'}</p>
                    </div>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs">
                      {lead.status === 'reference_candidate' ? 'Pendente de ação' :
                       lead.status === 'reference_unfollowed' ? 'Unfollow informado' :
                       lead.status === 'reference_kept' ? 'Manter seguindo' :
                       lead.followedBack ? 'Seguiu de volta (informado)' :
                       lead.due ? 'Prazo de revisão atingido' : 'Aguardando revisão'}
                    </span>
                  </div>
                  {lead.reviewAt && !lead.followedBack && lead.status === 'reference_followed' && (
                    <p className="text-xs text-muted-foreground">Revisar em {displayDate(lead.reviewAt)} · não executa unfollow automaticamente</p>
                  )}
                  {lead.protected && <p className="text-xs text-muted-foreground">Perfil na lista de proteção: não marcar unfollow.</p>}
                  <div className="flex flex-wrap gap-2">
                    {lead.status === 'reference_candidate' && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => void changeLead(lead, 'confirm-follow')}>
                          <UserRoundCheck className="h-4 w-4 mr-1" /> Confirmei que segui
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeLead(lead, 'discard-candidate')}>Descartar</Button>
                      </>
                    )}
                    {lead.status === 'reference_followed' && !lead.followedBack && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeLead(lead, 'confirm-followback')}>
                          Confirmei follow-back
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeLead(lead, 'keep-following')}>Manter seguindo</Button>
                        {lead.due && !lead.protected &&
                          <Button size="sm" disabled={busy} onClick={() => void changeLead(lead, 'confirm-unfollow')}>Confirmei que deixei de seguir</Button>}
                      </>
                    )}
                    {lead.followedBack && <span className="text-xs text-muted-foreground">Preservado: nenhum unfollow programado.</span>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
