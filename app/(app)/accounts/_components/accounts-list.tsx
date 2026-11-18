'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Instagram, Link2, Plus, Trash2, Pause, Play, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

export function AccountsList({ initialAccounts, outcome }: { initialAccounts: any[]; outcome?: string }) {
  const [accounts, setAccounts] = useState(initialAccounts ?? []);
  const [demoUsername, setDemoUsername] = useState('');
  const [loading, setLoading] = useState(false);

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> Analisar uma conta de referência com GPT</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Este recurso experimental não exige conectar sua conta Instagram à Meta.
          Informe o @ da referência e informações públicas; a IA sugere estratégias
          de conteúdo, sem identificar seguidores ou executar ações no Instagram.
        </p>
        <Link href="/reference-ai"><Button variant="outline"><Sparkles className="h-4 w-4 mr-2" /> Abrir IA · Referências</Button></Link>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/> Conexão oficial Meta</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">Conecte uma conta profissional (Criador ou Empresa) com a autorização do Instagram. O DecolaInsta não solicita sua senha. Dados reais e publicação dependem das permissões concedidas pela Meta.</p>
        <a href="/api/instagram/connect"><Button><Link2 className="h-4 w-4 mr-2"/> Conectar Instagram</Button></a>
        {outcome === 'connected' && <p className="text-sm text-green-600">Conta conectada. Dados reais disponíveis nos detalhes do perfil.</p>}
        {outcome && outcome !== 'connected' && <p className="text-sm text-destructive">Não foi possível conectar: {outcome === 'access_denied' ? 'permissão recusada' : outcome === 'invalid_state' ? 'sessão OAuth expirada/inválida' : outcome === 'login_required' ? 'entre na sua conta DecolaInsta' : 'verifique a configuração e o acesso da Meta'}.</p>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-base">Laboratório de simulação (opcional)</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Crie um perfil fictício para explorar o motor antigo. Ele não segue pessoas reais nem coleta seguidores reais.</p>
        <div className="flex gap-2"><Input value={demoUsername} onChange={event => setDemoUsername(event.target.value)} placeholder="nome_de_teste" aria-label="Nome da conta demonstrativa"/><Button onClick={createDemo} loading={loading}><Plus className="h-4 w-4 mr-1"/> Demo</Button></div>
      </CardContent>
    </Card>
    {accounts.length === 0 && <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma conta Meta conectada. Você pode analisar referências com IA sem fazer essa conexão.</CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {accounts.map(account => <Card key={account.id}>
        <CardHeader className="pb-3"><div className="flex items-center gap-2"><Instagram className="h-5 w-5 text-primary"/><CardTitle className="text-base">@{account.username}</CardTitle></div>
          <div className="flex gap-2 pt-2 flex-wrap"><Badge variant={account.connected ? 'default' : 'secondary'}>{account.connected ? 'Meta conectada' : 'Somente demo'}</Badge><Badge variant="outline">{account.status === 'active' ? 'Demo ativa' : account.status === 'paused' ? 'Demo pausada' : 'Inativa'}</Badge></div>
        </CardHeader>
        <CardContent className="space-y-3">
          {account.connected ? <p className="text-sm">Seguidores reais: <strong>{account.profileFollowersCount ?? 'Sincronizar'}</strong></p> : <p className="text-sm text-muted-foreground">Sem conexão real com Instagram.</p>}
          <div className="flex flex-wrap gap-2">
            <Link href={`/accounts/${account.id}`}><Button size="sm" variant="outline"><Settings className="h-4 w-4 mr-1"/> Detalhes</Button></Link>
            <Button size="sm" variant="outline" onClick={() => toggleStatus(account.id, account.status)}>{account.status === 'active' ? <Pause className="h-4 w-4"/> : <Play className="h-4 w-4"/>}<span className="ml-1">{account.status === 'active' ? 'Pausar demo' : 'Ativar demo'}</span></Button>
            <Button size="sm" variant="ghost" onClick={() => remove(account.id)} aria-label={`Remover ${account.username}`}><Trash2 className="h-4 w-4 text-destructive"/></Button>
          </div>
        </CardContent>
      </Card>)}
    </div>
  </div>;
}
