'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, ImageIcon, LoaderCircle, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layouts/page-header';

type Account = { id: string; username: string; connected?: boolean };
type ScheduledPost = {
  id: string;
  imageUrl: string;
  caption: string;
  status: string;
  scheduledFor: string;
  publishedAt?: string | null;
  reviewNote?: string | null;
};
const labels: Record<string, string> = {
  queued: 'Aguardando',
  processing: 'Em processamento',
  published: 'Publicado',
  needs_review: 'Revisão necessária',
  cancelled: 'Cancelado',
};

async function fetchScheduledPosts(accountId: string): Promise<{ enabled: boolean; posts: ScheduledPost[] }> {
  const response = await fetch(`/api/instagram-accounts/${encodeURIComponent(accountId)}/scheduled-posts`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Falha ao carregar agendamentos');
  return { enabled: data.enabled === true, posts: Array.isArray(data.posts) ? data.posts : [] };
}

export default function ScheduledPostsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loadedAccount, setLoadedAccount] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/instagram-accounts')
      .then(async res => {
        if (!res.ok) throw new Error('Não foi possível carregar as contas');
        return res.json();
      })
      .then((value: unknown) => {
        if (!alive) return;
        const list = Array.isArray(value)
          ? value.filter((item): item is Account => typeof item?.id === 'string' && typeof item?.username === 'string')
          : [];
        setAccounts(list);
        setSelectedAccount(list.find(account => account.connected)?.id ?? list[0]?.id ?? '');
      })
      .catch((error: Error) => { if (alive) setMessage(error.message); });
    return () => { alive = false; };
  }, []);

  async function refresh(accountId: string) {
    try {
      const data = await fetchScheduledPosts(accountId);
      setEnabled(data.enabled);
      setPosts(data.posts);
      setLoadedAccount(accountId);
    } catch (error) {
      setEnabled(false);
      setPosts([]);
      setLoadedAccount(accountId);
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar agendamentos');
    }
  }

  useEffect(() => {
    if (!selectedAccount) return;
    let alive = true;

    // The effect subscribes to an external fetch. State changes only on promise settlement,
    // avoiding synchronous setState and ignoring responses for an unmounted/changed selection.
    fetchScheduledPosts(selectedAccount)
      .then(data => {
        if (!alive) return;
        setEnabled(data.enabled);
        setPosts(data.posts);
        setLoadedAccount(selectedAccount);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setEnabled(false);
        setPosts([]);
        setLoadedAccount(selectedAccount);
        setMessage(error instanceof Error ? error.message : 'Erro ao carregar agendamentos');
      });

    return () => { alive = false; };
  }, [selectedAccount]);

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount || busy || !enabled) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/instagram-accounts/${encodeURIComponent(selectedAccount)}/scheduled-posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, caption, day }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao salvar agendamento');
      setImageUrl('');
      setCaption('');
      setDay('');
      setMessage('Publicação adicionada à fila. O serviço só publicará no processamento diário autorizado.');
      await refresh(selectedAccount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro no agendamento');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(postId: string) {
    if (!selectedAccount || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/instagram-accounts/${encodeURIComponent(selectedAccount)}/scheduled-posts/${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Falha ao cancelar agendamento');
      setMessage('Agendamento cancelado.');
      await refresh(selectedAccount);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  const connected = accounts.find(account => account.id === selectedAccount)?.connected;
  const waitingForData = selectedAccount && loadedAccount !== selectedAccount;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publicações agendadas"
        description="Agende imagens JPEG para publicação pela API oficial da Meta, em contas profissionais conectadas."
      />
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <p className="text-sm text-muted-foreground">
          O processamento está configurado para uma execução diária, a partir das 9h (Recife).
          No Vercel Hobby, a execução pode ocorrer em qualquer momento da hora e não há garantia de horário exato.
          No máximo uma publicação é processada por dia nesta primeira versão.
        </p>
        <p className="text-xs text-muted-foreground">
          A publicação real depende de conta profissional com permissão Meta, banco preparado e habilitação
          explícita em produção. Não há coleta de seguidores, follow ou unfollow neste módulo.
        </p>
        {!enabled && (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Agendamento desligado. A fila só estará disponível após a configuração e aprovação da implantação em produção.
          </p>
        )}
      </div>
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <label htmlFor="schedule-account" className="block text-sm font-medium">Conta Instagram</label>
        <select
          id="schedule-account"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm"
          value={selectedAccount}
          onChange={event => { setSelectedAccount(event.target.value); setMessage(''); }}
        >
          {accounts.length === 0 && <option value="">Nenhuma conta vinculada</option>}
          {accounts.map(account => (
            <option key={account.id} value={account.id}>
              @{account.username}{account.connected ? ' · Meta conectada' : ' · somente demonstração'}
            </option>
          ))}
        </select>
        {waitingForData ? <p className="text-sm text-muted-foreground">Carregando agendamentos...</p> : null}
        <form className="space-y-4" onSubmit={schedule}>
          <div>
            <label htmlFor="post-image" className="block text-sm font-medium mb-1">Endereço público da imagem JPEG</label>
            <input id="post-image" type="url" required maxLength={2000} placeholder="https://exemplo.com/foto.jpg"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={imageUrl} onChange={event => setImageUrl(event.target.value)} />
          </div>
          <div>
            <label htmlFor="post-caption" className="block text-sm font-medium mb-1">Legenda (até 2.200 caracteres)</label>
            <textarea id="post-caption" rows={4} maxLength={2200}
              className="w-full rounded-md border bg-background p-3 text-sm"
              value={caption} onChange={event => setCaption(event.target.value)} />
          </div>
          <div>
            <label htmlFor="post-day" className="block text-sm font-medium mb-1">Dia da publicação (horário de Recife)</label>
            <input id="post-day" type="date" required
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={day} onChange={event => setDay(event.target.value)} />
          </div>
          <button type="submit"
            disabled={!enabled || !connected || !selectedAccount || busy || Boolean(waitingForData)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            Programar publicação
          </button>
        </form>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </div>
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">Fila e histórico de publicações</h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum agendamento para esta conta.</p>
        ) : posts.map(post => (
          <div className="flex flex-wrap items-start gap-3 rounded-md border p-3" key={post.id}>
            <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">{labels[post.status] ?? post.status}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(post.scheduledFor).toLocaleString('pt-BR', {
                  timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short',
                })} · Recife
              </p>
              {post.caption && <p className="text-sm whitespace-pre-wrap break-words">{post.caption}</p>}
              {post.reviewNote && <p className="text-xs text-amber-700">{post.reviewNote}</p>}
            </div>
            {post.status === 'queued' && (
              <button type="button" onClick={() => cancel(post.id)} disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" /> Cancelar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
