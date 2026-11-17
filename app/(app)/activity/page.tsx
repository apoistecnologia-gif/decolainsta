'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layouts/page-header';
import { Activity, RefreshCw, UserPlus, UserMinus, AlertCircle, Clock, Zap } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/animate';
import { SafeDate } from '@/components/safe-format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const actionIcons: Record<string, any> = {
  follow: UserPlus,
  unfollow: UserMinus,
  error: AlertCircle,
  cooldown: Clock,
  pause: Clock,
};

const actionColors: Record<string, string> = {
  follow: 'text-green-600 dark:text-green-400',
  unfollow: 'text-orange-600 dark:text-orange-400',
  error: 'text-destructive',
  cooldown: 'text-yellow-600 dark:text-yellow-400',
};

export default function ActivityPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/instagram-accounts')
      .then((r) => r.json())
      .then((data) => setAccounts(data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    if (selectedAccount === 'all') {
      // Load all logs from all accounts
      Promise.all(
        (accounts ?? []).map((a: any) =>
          fetch(`/api/instagram-accounts/${a?.id}/logs?take=30`)
            .then((r) => r.json())
            .then((logs: any[]) => (logs ?? []).map((l: any) => ({ ...(l ?? {}), accountUsername: a?.username })))
            .catch(() => [])
        )
      ).then((allLogs) => {
        const merged = (allLogs ?? []).flat().sort((a: any, b: any) =>
          new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime()
        );
        setLogs(merged.slice(0, 100));
        setLoading(false);
      });
    } else {
      fetch(`/api/instagram-accounts/${selectedAccount}/logs?take=100`)
        .then((r) => r.json())
        .then((data) => {
          const acc = (accounts ?? []).find((a: any) => a?.id === selectedAccount);
          setLogs((data ?? []).map((l: any) => ({ ...(l ?? {}), accountUsername: acc?.username })));
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [selectedAccount, accounts]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Registro de Atividade"
        description="Histórico de todas as ações executadas pelo motor"
        actions={
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Todas as contas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as contas</SelectItem>
              {(accounts ?? []).map((a: any) => (
                <SelectItem key={a?.id} value={a?.id ?? ''}>@{a?.username ?? '?'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : (logs?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Nenhuma atividade registrada ainda</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {(logs ?? []).map((log: any, idx: number) => {
            const Icon = actionIcons[log?.action ?? ''] ?? Activity;
            const color = actionColors[log?.action ?? ''] ?? 'text-muted-foreground';
            return (
              <FadeIn key={log?.id ?? idx} delay={idx * 0.02}>
                <Card>
                  <CardContent className="flex items-center gap-4 py-3">
                    <div className={`h-8 w-8 rounded-full bg-muted flex items-center justify-center ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{log?.details ?? log?.action ?? '-'}</p>
                      <p className="text-xs text-muted-foreground">
                        @{log?.accountUsername ?? '?'}
                        {log?.createdAt && (
                          <> · <SafeDate date={log.createdAt} options={{ dateStyle: 'short', timeStyle: 'short' }} /></>
                        )}
                      </p>
                    </div>
                    <Badge variant={log?.success ? 'default' : 'destructive'} className="text-xs">
                      {log?.success ? 'OK' : 'Erro'}
                    </Badge>
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
