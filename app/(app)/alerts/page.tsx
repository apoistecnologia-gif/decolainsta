'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layouts/page-header';
import { Bell, AlertTriangle, Shield, Info, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn } from '@/components/ui/animate';
import { SafeDate } from '@/components/safe-format';
import { toast } from 'sonner';

const typeIcons: Record<string, any> = {
  rate_limit: AlertTriangle,
  action_blocked: Shield,
  challenge: Shield,
  checkpoint: Shield,
  error: AlertTriangle,
  info: Info,
};

const typeColors: Record<string, string> = {
  rate_limit: 'text-yellow-600 dark:text-yellow-400',
  action_blocked: 'text-destructive',
  challenge: 'text-destructive',
  checkpoint: 'text-destructive',
  error: 'text-destructive',
  info: 'text-primary',
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAlerts = () => {
    setLoading(true);
    fetch('/api/alerts')
      .then((r) => r.json())
      .then((data) => {
        setAlerts(data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const markRead = async (alertId: string) => {
    try {
      const response = await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || 'Falha ao marcar alerta');
      }
      setAlerts((prev: any[]) =>
        (prev ?? []).map((a: any) => (a?.id === alertId ? { ...(a ?? {}), read: true } : a))
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar o alerta');
    }
  };

  const unread = (alerts ?? []).filter((a: any) => !a?.read).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertas"
        description={`${unread} alerta${unread !== 1 ? 's' : ''} não lido${unread !== 1 ? 's' : ''}`}
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : (alerts?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhum alerta</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(alerts ?? []).map((alert: any, idx: number) => {
            const Icon = typeIcons[alert?.type ?? 'info'] ?? Info;
            const color = typeColors[alert?.type ?? 'info'] ?? 'text-muted-foreground';
            return (
              <FadeIn key={alert?.id ?? idx} delay={idx * 0.03}>
                <Card className={alert?.read ? 'opacity-60' : ''}>
                  <CardContent className="flex items-center gap-4 py-3">
                    <div className={`h-8 w-8 rounded-full bg-muted flex items-center justify-center ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{alert?.message ?? '-'}</p>
                      <p className="text-xs text-muted-foreground">
                        @{alert?.instagramAccount?.username ?? '?'}
                        {alert?.createdAt && (
                          <> · <SafeDate date={alert.createdAt} options={{ dateStyle: 'short', timeStyle: 'short' }} /></>
                        )}
                      </p>
                    </div>
                    {!alert?.read && (
                      <Button size="sm" variant="ghost" onClick={() => markRead(alert?.id)}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </FadeIn>
            );
          })}
        </div>
      )}
    </div>
  );
}
