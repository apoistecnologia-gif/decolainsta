'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Target,
  Plus,
  Trash2,
  Settings,
  Shield,
  Clock,
  Zap,
  AlertTriangle,
  UserPlus,
  UserMinus,
  Save,
  Image as ImageIcon,
  RefreshCw,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { FadeIn } from '@/components/ui/animate';

export function AccountDetail({ account }: { account: any }) {
  const router = useRouter();
  const settings = account?.settings ?? {};

  // Settings state
  const [minDelay, setMinDelay] = useState(settings?.minDelaySeconds ?? 25);
  const [maxDelay, setMaxDelay] = useState(settings?.maxDelaySeconds ?? 90);
  const [maxFollowsDay, setMaxFollowsDay] = useState(settings?.maxFollowsPerDay ?? 100);
  const [maxFollowsHour, setMaxFollowsHour] = useState(settings?.maxFollowsPerHour ?? 15);
  const [maxUnfollowsDay, setMaxUnfollowsDay] = useState(settings?.maxUnfollowsPerDay ?? 80);
  const [unfollowDays, setUnfollowDays] = useState(settings?.unfollowAfterDays ?? 3);
  const [warmupEnabled, setWarmupEnabled] = useState(settings?.warmupEnabled ?? true);
  const [opStart, setOpStart] = useState(settings?.operationStartHour ?? 8);
  const [opEnd, setOpEnd] = useState(settings?.operationEndHour ?? 22);
  const [skipPrivate, setSkipPrivate] = useState(settings?.skipPrivateProfiles ?? true);
  const [skipNoPhoto, setSkipNoPhoto] = useState(settings?.skipNoPhoto ?? true);
  const [neverUnfollowFollowers, setNeverUnfollowFollowers] = useState(settings?.neverUnfollowFollowers ?? true);
  const dryMode = true; // real follow/unfollow is not supported by Meta's official API
  const [instagramData, setInstagramData] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);

  // Targets
  const [targets, setTargets] = useState<any[]>(account?.targetAccounts ?? []);
  const [newTarget, setNewTarget] = useState('');
  const [addingTarget, setAddingTarget] = useState(false);

  // Whitelist
  const [whitelist, setWhitelist] = useState<any[]>(account?.whitelist ?? []);
  const [newWhitelist, setNewWhitelist] = useState('');

  const syncInstagram = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/instagram-accounts/${account.id}/instagram`, { cache: 'no-store' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setInstagramData(result);
      toast.success('Informações reais sincronizadas com Instagram');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha na sincronização'); }
    finally { setSyncing(false); }
  };

  const publishImage = async () => {
    if (!confirm('Publicar esta imagem agora na conta conectada do Instagram?')) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/instagram-accounts/${account.id}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, caption }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      toast.success(`Publicação realizada: ${result.mediaId}`);
      setImageUrl(''); setCaption('');
      await syncInstagram();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Falha na publicação'); }
    finally { setPublishing(false); }
  };

  const checked = async (response: Response) => {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'A operação falhou');
    }
    return response;
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await checked(await fetch(`/api/instagram-accounts/${account?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryMode,
          settings: {
            minDelaySeconds: minDelay,
            maxDelaySeconds: maxDelay,
            maxFollowsPerDay: maxFollowsDay,
            maxFollowsPerHour: maxFollowsHour,
            maxUnfollowsPerDay: maxUnfollowsDay,
            unfollowAfterDays: unfollowDays,
            warmupEnabled,
            operationStartHour: opStart,
            operationEndHour: opEnd,
            skipPrivateProfiles: skipPrivate,
            skipNoPhoto,
            neverUnfollowFollowers,
          },
        }),
      }));
      toast.success('Configurações da demonstração salvas!');
    } catch {
      toast.error('Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const addTarget = async () => {
    if (!newTarget) return;
    setAddingTarget(true);
    try {
      const res = await fetch(`/api/instagram-accounts/${account?.id}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Erro');
        return;
      }
      setTargets((prev: any[]) => [data, ...(prev ?? [])]);
      setNewTarget('');
      toast.success('Conta de referência cadastrada. Seguidores ainda não identificados.');
    } catch {
      toast.error('Erro ao adicionar alvo');
    } finally {
      setAddingTarget(false);
    }
  };

  const removeTarget = async (targetId: string) => {
    try {
      await checked(await fetch(`/api/instagram-accounts/${account?.id}/targets/${targetId}`, { method: 'DELETE' }));
      setTargets((prev: any[]) => (prev ?? []).filter((t: any) => t?.id !== targetId));
      toast.success('Alvo removido');
    } catch {
      toast.error('Erro');
    }
  };

  const toggleTarget = async (targetId: string, enabled: boolean) => {
    try {
      await checked(await fetch(`/api/instagram-accounts/${account?.id}/targets/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      }));
      setTargets((prev: any[]) =>
        (prev ?? []).map((t: any) => (t?.id === targetId ? { ...(t ?? {}), enabled: !enabled } : t))
      );
    } catch {
      toast.error('Erro');
    }
  };

  const addWhitelistUser = async () => {
    if (!newWhitelist) return;
    try {
      const res = await fetch(`/api/instagram-accounts/${account?.id}/whitelist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newWhitelist }),
      });
      const data = await res.json();
      if (res.ok) {
        setWhitelist((prev: any[]) => [data, ...(prev ?? [])]);
        setNewWhitelist('');
        toast.success('Adicionado à whitelist');
      }
    } catch {
      toast.error('Erro');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/accounts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">@{account?.username ?? '?'}</h1>
          <p className="text-sm text-muted-foreground">Perfil oficial e laboratório de simulação</p>
        </div>
      </div>

      <Tabs defaultValue="instagram" className="space-y-4">
        <TabsList>
          <TabsTrigger value="instagram"><Link2 className="h-4 w-4 mr-1"/> Instagram real</TabsTrigger>
          <TabsTrigger value="targets">
            <Target className="h-4 w-4 mr-1" /> Contas de referência
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1" /> Config. (demo)
          </TabsTrigger>
          <TabsTrigger value="whitelist">
            <Shield className="h-4 w-4 mr-1" /> Whitelist
          </TabsTrigger>
        </TabsList>

        <TabsContent value="instagram" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Dados oficiais do Instagram</CardTitle><CardDescription>Consulta pela API da Meta; nenhuma estatística simulada é mostrada aqui.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {!account.connected ? <div className="space-y-2"><p className="text-sm">Este perfil não está conectado. Para obter dados reais, autorize a conta profissional.</p><a href="/api/instagram/connect"><Button><Link2 className="h-4 w-4 mr-2"/> Conectar Instagram</Button></a></div> : <>
                <Button variant="outline" onClick={syncInstagram} loading={syncing}><RefreshCw className="h-4 w-4 mr-2"/> Sincronizar agora</Button>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Seguidores</p><p className="text-2xl font-bold">{instagramData?.profile?.followers_count ?? account.profileFollowersCount ?? '—'}</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Publicações</p><p className="text-2xl font-bold">{instagramData?.profile?.media_count ?? account.profileMediaCount ?? '—'}</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Tipo</p><p className="text-base font-semibold">{instagramData?.profile?.account_type ?? 'Profissional'}</p></div>
                </div>
                {instagramData?.followersMeasurement && (
                  <div className="rounded-md border p-3 space-y-1">
                    <p className="text-sm font-medium">Variação de seguidores observada pela Meta</p>
                    <p className="text-lg font-semibold">
                      {instagramData.followersMeasurement.delta === null
                        ? 'Primeira observação, sem comparação anterior'
                        : new Intl.NumberFormat('pt-BR', { signDisplay: 'always' }).format(instagramData.followersMeasurement.delta)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Diferença desde a contagem anterior registrada. Não prova que os seguidores vieram de follow/unfollow.
                    </p>
                  </div>
                )}
                {instagramData && <div className="space-y-3"><h3 className="font-medium">Últimas publicações (dados oficiais)</h3><div className="space-y-2">{instagramData.media.map((media: any) => <div key={media.id} className="rounded-md border p-3 text-sm"><div className="font-medium">{media.media_type ?? 'Mídia'} · {media.timestamp ? new Date(media.timestamp).toLocaleDateString('pt-BR') : ''}</div><p className="text-muted-foreground line-clamp-2">{media.caption ?? 'Sem legenda'}</p>{media.permalink && <a className="text-primary underline" href={media.permalink} target="_blank" rel="noopener noreferrer">Ver no Instagram</a>}</div>)}</div></div>}
              </>}
            </CardContent>
          </Card>
          {account.connected && <Card>
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><ImageIcon className="h-5 w-5"/> Publicar uma imagem real</CardTitle><CardDescription>Use uma URL HTTPS de imagem pública. Exige permissão instagram_business_content_publish no seu app Meta.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div><Label htmlFor="publishImage">URL pública da imagem</Label><Input id="publishImage" placeholder="https://exemplo.com/imagem.jpg" value={imageUrl} onChange={e => setImageUrl(e.target.value)}/></div>
              <div><Label htmlFor="publishCaption">Legenda</Label><textarea id="publishCaption" rows={4} maxLength={2200} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={caption} onChange={e => setCaption(e.target.value)} /></div>
              <Button onClick={publishImage} disabled={!imageUrl.trim() || publishing} loading={publishing}>Publicar no Instagram</Button>
              <p className="text-xs text-muted-foreground">A publicação é real e imediata após sua confirmação, caso Meta autorize a conta e a imagem.</p>
            </CardContent>
          </Card>}
        </TabsContent>
        <TabsContent value="targets" className="space-y-4">
          <FadeIn>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Adicionar conta de referência</CardTitle>
                <CardDescription>Cadastre o @ de um perfil cuja audiência interessa a você. Ainda não coletamos a lista de seguidores desse perfil.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="@ do perfil de referência"
                    value={newTarget}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTarget(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={addTarget} loading={addingTarget}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <div className="space-y-2">
            {(targets ?? []).map((target: any) => (
              <FadeIn key={target?.id}>
                <Card>
                  <CardContent className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <Target className="h-4 w-4 text-primary" />
                      <div>
                        <p className="text-sm font-medium">@{target?.username ?? '?'}</p>
                        <p className="text-xs text-muted-foreground">
                          Referência cadastrada · Lista de seguidores não identificada
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={target?.enabled ?? false}
                        onCheckedChange={() => toggleTarget(target?.id, target?.enabled)}
                      />
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeTarget(target?.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </FadeIn>
            ))}
            {(targets?.length ?? 0) === 0 && (
              <Card>
                <CardContent className="text-center py-8">
                  <Target className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Nenhuma conta de referência cadastrada</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <FadeIn>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5" /> Modo de Operação
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Modo Simulação (Dry-Run)</Label>
                    <p className="text-xs text-muted-foreground">Motor de seguir/deixar de seguir é exclusivamente demonstrativo; a API oficial não oferece essas ações.</p>
                  </div>
                  <Switch checked={true} disabled />
                </div>
                {!dryMode && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <p className="text-xs text-destructive flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      Modo real ativado. As ações serão executadas diretamente no Instagram. Use por sua conta e risco.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1}>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5" /> Delays e Limites
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Delay mínimo entre ações (s): {minDelay}</Label>
                    <Slider value={[minDelay]} onValueChange={(v: number[]) => setMinDelay(v?.[0] ?? 25)} min={10} max={120} step={5} />
                  </div>
                  <div className="space-y-2">
                    <Label>Delay máximo entre ações (s): {maxDelay}</Label>
                    <Slider value={[maxDelay]} onValueChange={(v: number[]) => setMaxDelay(v?.[0] ?? 90)} min={30} max={300} step={10} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Máx follows/dia</Label>
                    <Input type="number" value={maxFollowsDay} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxFollowsDay(parseInt(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Máx follows/hora</Label>
                    <Input type="number" value={maxFollowsHour} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxFollowsHour(parseInt(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Máx unfollows/dia</Label>
                    <Input type="number" value={maxUnfollowsDay} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxUnfollowsDay(parseInt(e.target.value) || 0)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Dias antes de dar unfollow: {unfollowDays}</Label>
                  <Slider value={[unfollowDays]} onValueChange={(v: number[]) => setUnfollowDays(v?.[0] ?? 3)} min={1} max={14} step={1} />
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.2}>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserPlus className="h-5 w-5" /> Aquecimento
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Aquecimento progressivo</Label>
                    <p className="text-xs text-muted-foreground">Começa com menos ações e aumenta gradualmente</p>
                  </div>
                  <Switch checked={warmupEnabled} onCheckedChange={setWarmupEnabled} />
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.3}>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5" /> Horário de Operação
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Início: {opStart}h</Label>
                    <Slider value={[opStart]} onValueChange={(v: number[]) => setOpStart(v?.[0] ?? 8)} min={0} max={23} step={1} />
                  </div>
                  <div className="space-y-2">
                    <Label>Fim: {opEnd}h</Label>
                    <Slider value={[opEnd]} onValueChange={(v: number[]) => setOpEnd(v?.[0] ?? 22)} min={1} max={24} step={1} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <FadeIn delay={0.4}>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5" /> Filtros
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Ignorar perfis privados</Label>
                  <Switch checked={skipPrivate} onCheckedChange={setSkipPrivate} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Ignorar perfis sem foto</Label>
                  <Switch checked={skipNoPhoto} onCheckedChange={setSkipNoPhoto} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Nunca dar unfollow em quem seguiu de volta</Label>
                    <p className="text-xs text-muted-foreground">Protege seguidores que retribuíram</p>
                  </div>
                  <Switch checked={neverUnfollowFollowers} onCheckedChange={setNeverUnfollowFollowers} />
                </div>
              </CardContent>
            </Card>
          </FadeIn>

          <Button onClick={saveSettings} loading={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" /> Salvar Configurações
          </Button>
        </TabsContent>

        <TabsContent value="whitelist" className="space-y-4">
          <FadeIn>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Whitelist</CardTitle>
                <CardDescription>Contas que nunca serão removidas (unfollow)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="@username"
                    value={newWhitelist}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewWhitelist(e.target.value)}
                    className="flex-1"
                  />
                  <Button onClick={addWhitelistUser}>
                    <Plus className="h-4 w-4 mr-1" /> Adicionar
                  </Button>
                </div>
                <div className="space-y-2">
                  {(whitelist ?? []).map((item: any) => (
                    <div key={item?.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                      <span className="text-sm">@{item?.username ?? '?'}</span>
                      <Button size="sm" variant="ghost" className="text-destructive h-7" onClick={async () => {
                        try {
                          await checked(await fetch(`/api/instagram-accounts/${account.id}/whitelist/${item.id}`, { method: 'DELETE' }));
                          setWhitelist(current => current.filter(w => w.id !== item.id));
                          toast.success('Removido da whitelist');
                        } catch { toast.error('Falha ao remover'); }
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {(whitelist?.length ?? 0) === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Whitelist vazia</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </FadeIn>
        </TabsContent>
      </Tabs>
    </div>
  );
}
