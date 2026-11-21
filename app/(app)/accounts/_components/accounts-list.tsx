'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Instagram, Link2, Plus, Trash2, Pause, Play, Settings, ShieldCheck, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export function AccountsList({ initialAccounts, outcome }: { initialAccounts: any[]; outcome?: string }) {
  const [accounts, setAccounts] = useState(initialAccounts ?? []);
  const [demoUsername, setDemoUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const createDemo = async () => {
    if (!demoUsername.trim()) return;
    setLoading(true);
    try {
      const response = await fetch('/api/instagram-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: demoUsername }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAccounts(current => [data, ...current]); setDemoUsername('');
      toast.success('Conta demonstrativa criada');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha ao criar demonstração'); }
    finally { setLoading(false); }
  };

  // Reuse the existing per-user, read-only Meta route; never act on Instagram relationships.
  const syncOfficial = async (account: any) => {
    if (!account.connected || syncingId) return;
    setSyncingId(account.id);
    try {
      const response = await fetch(`/api/instagram-accounts/${encodeURIComponent(account.id)}/instagram`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Não foi possível sincronizar o Instagram');
      if (result.source !== 'meta_official_api' || result.profile?.id !== account.instagramUserId) {
        throw new Error('Resposta da Meta não corresponde à conta selecionada');
      }
      const followers = result.profile.followers_count;
      const media = result.profile.media_count;
      setAccounts(current => current.map(item => item.id !== account.id ? item : {
        ...item,
        profileFollowersCount: Number.isSafeInteger(followers) && followers >= 0 ? followers : item.profileFollowersCount,
        profileMediaCount: Number.isSafeInteger(media) && media >= 0 ? media : item.profileMediaCount,
        lastSyncedAt: typeof result.syncedAt === 'string' ? result.syncedAt : item.lastSyncedAt,
      }));
      toast.success('Dados oficiais do Instagram atualizados');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha na sincronização');
    } finally {
      setSyncingId(null);
    }
  };

  const toggleStatus = async (id: string, status: string) => {
    const nextStatus = status === 'active' ? 'paused' : 'active';
    try {
      const response = await fetch(`/api/instagram-accounts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAccounts(current => current.map(a => a.id === id ? { ...a, status: data.status } : a));
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha na operação'); }
  };

  const remove = async (id: string) => {
    if (!confirm('Remover esta conta e seus dados locais? Esta operação não remove a conta do Instagram.')) return;
    try {
      const response = await fetch(`/api/instagram-accounts/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Não foi possível remover a conta');
      setAccounts(current => current.filter(a => a.id !== id)); toast.success('Conta removida');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Erro'); }
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Seus perfis</h2>
      <a href="/api/instagram/connect">
        <Button size="sm" variant={accounts.some(item => item.connected) ? 'outline' : 'default'}>
          <Link2 className="h-4 w-4 mr-2" />{accounts.some(item => item.connected) ? 'Conectar outra conta' : 'Conectar Instagram'}
        </Button>
      </a>
    </div>
    {outcome === 'connected' && <p role="status" className="text-sm text-green-600">Instagram conectado com sucesso.</p>}
    {outcome && outcome !== 'connected' && <p role="alert" className="text-sm text-destructive">Não foi possível conectar: {outcome === 'access_denied' ? 'permissão recusada' : outcome === 'invalid_state' ? 'sessão OAuth expirada/inválida' : outcome === 'login_required' ? 'entre na sua conta DecolaInsta' : 'verifique a configuração e o acesso da Meta'}.</p>}
    {accounts.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma conta Meta conectada. Você pode analisar referências com IA sem fazer essa conexão.</CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {accounts.map(account => <Card key={account.id}>
        <CardHeader className="pb-3"><div className="flex items-center gap-2"><Instagram className="h-5 w-5 text-primary"/><CardTitle className="text-base">@{account.username}</CardTitle></div>
          <div className="flex gap-2 pt-2 flex-wrap"><Badge variant={account.connected ? 'default' : 'secondary'}>{account.connected ? 'Meta conectada' : 'Somente demo'}</Badge>{!account.connected && <Badge variant="outline">{account.status === 'active' ? 'Demo ativa' : account.status === 'paused' ? 'Demo pausada' : 'Inativa'}</Badge>}</div>
        </CardHeader>
        <CardContent className="space-y-3">
          {account.connected ? <div className="space-y-1 text-sm">
            <p>Seguidores: <strong>{account.profileFollowersCount ?? '—'}</strong> · Publicações: <strong>{account.profileMediaCount ?? '—'}</strong></p>
            <p className="text-xs text-muted-foreground">Última sincronização: {account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }) : 'Não realizada'}</p>
          </div> : <p className="text-sm text-muted-foreground">Conta de demonstração, sem dados oficiais.</p>}
          <div className="flex flex-wrap gap-2">
            <Link href={`/accounts/${account.id}`}><Button size="sm" variant="outline"><Settings className="h-4 w-4 mr-1"/> Detalhes</Button></Link>
            {account.connected
              ? <Button size="sm" variant="outline" onClick={() => syncOfficial(account)} disabled={syncingId !== null} loading={syncingId === account.id}><RefreshCw className="h-4 w-4 mr-1" /> Atualizar dados</Button>
              : <Button size="sm" variant="outline" onClick={() => toggleStatus(account.id, account.status)}>{account.status === 'active' ? <Pause className="h-4 w-4"/> : <Play className="h-4 w-4"/>}<span className="ml-1">{account.status === 'active' ? 'Pausar demo' : 'Ativar demo'}</span></Button>}
            <Button size="sm" variant="ghost" onClick={() => remove(account.id)} aria-label={`Remover ${account.username}`}><Trash2 className="h-4 w-4 text-destructive"/></Button>
          </div>
        </CardContent>
      </Card>)}
    </div>
    <details className="rounded-xl border bg-card px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">Recursos opcionais: IA e simulação</summary>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-5 w-5" /> IA · Referências</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Este recurso não exige conectar sua conta Instagram à Meta. Analise informações públicas de perfis de referência, sem acessar listas de seguidores nem executar ações.</p>
            <Link href="/reference-ai"><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" /> Abrir IA · Referências</Button></Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5" /> Laboratório de simulação</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Perfis fictícios para testar o motor demonstrativo, sem ações reais no Instagram.</p>
            <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" value={demoUsername} onChange={event => setDemoUsername(event.target.value)} placeholder="nome_de_teste" aria-label="Nome da conta demonstrativa"/><Button onClick={createDemo} loading={loading}><Plus className="h-4 w-4 mr-1"/> Demo</Button></div>
          </CardContent>
        </Card>
      </div>
    </details>
  </div>;
}
