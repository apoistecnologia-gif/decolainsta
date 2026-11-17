'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layouts/page-header';
import { Zap, Play, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { FadeIn } from '@/components/ui/animate';

export default function EnginePage() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [autoRun, setAutoRun] = useState(false);

  const runTick = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/engine/tick', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setLastResult(data);
        toast.success(`Simulação executada: ${data?.processed ?? 0} conta(s) de demonstração`);
      } else {
        toast.error(data?.error ?? 'Erro no motor');
      }
    } catch {
      toast.error('Erro ao executar motor');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (autoRun) {
      interval = setInterval(runTick, 60000); // Run every 60s
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRun]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laboratório de Simulação"
        description="Experimente ciclos fictícios de follows/unfollows. Ações reais não são oferecidas pela API da Meta."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <FadeIn>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" /> Execução Manual
              </CardTitle>
              <CardDescription>
                Execute um ciclo demonstrativo. Nenhuma conta real será seguida e nenhuma lista real de seguidores será coletada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={runTick} loading={running} className="w-full">
                <Play className="h-4 w-4 mr-2" />
                Executar Ciclo
              </Button>

              {lastResult && (
                <div className="rounded-lg bg-muted p-3 text-sm">
                  <p>Último resultado: {lastResult?.processed ?? 0} conta(s) processada(s)</p>
                </div>
              )}
            </CardContent>
          </Card>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-primary" /> Simulação Contínua no Navegador
              </CardTitle>
              <CardDescription>
                Aciona o simulador a cada 60 segundos enquanto esta página estiver aberta. Não cria agendamento no servidor.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={autoRun ? 'default' : 'secondary'}>
                    {autoRun ? 'Rodando' : 'Parado'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {autoRun ? 'Executando a cada 60s' : 'Desativado'}
                  </span>
                </div>
                <Button
                  variant={autoRun ? 'destructive' : 'default'}
                  onClick={() => {
                    setAutoRun(!autoRun);
                    if (!autoRun) {
                      toast.info('Simulação local habilitada enquanto esta página estiver aberta');
                      runTick();
                    } else {
                      toast.info('Motor automático desativado');
                    }
                  }}
                >
                  {autoRun ? 'Parar' : 'Iniciar'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </FadeIn>
      </div>

      <FadeIn delay={0.2}>
        <Card>
          <CardContent className="py-4">
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">Aviso Importante</h4>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                    O motor desta tela é <strong>exclusivamente demonstrativo</strong>. Os resultados não representam atividade real. Para recursos reais autorizados, conecte uma conta profissional na seção Contas Instagram e acesse os dados e a publicação de imagens.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </FadeIn>
    </div>
  );
}
