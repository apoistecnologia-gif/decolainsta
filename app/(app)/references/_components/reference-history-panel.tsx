'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { parseReferenceAggregate, type ReferenceAggregate } from '@/lib/reference-report';

function displayTime(value: string | null) {
  if (!value) return 'Não disponível';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ReferenceHistoryPanel() {
  const [report, setReport] = useState<ReferenceAggregate | null>(null);
  const [error, setError] = useState('');
  const [reviewHours, setReviewHours] = useState<24 | 72>(72);

  async function selectReport(file?: File) {
    setReport(null);
    setError('');
    if (!file) return;
    if (file.size > 50_000) { setError('Arquivo muito grande (máximo de 50 KB).'); return; }
    try {
      const next = parseReferenceAggregate(await file.text());
      setReport(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler o relatório.');
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Contas de referência — resultados observados</CardTitle>
          <CardDescription>
            Importe um relatório agregado gerado no laboratório local. A leitura acontece
            somente neste navegador: nenhuma lista de usuários, HMAC ou cookie é enviada ao servidor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="reference-aggregate-file" className="block text-sm font-medium">
            Arquivo JSON de relatório agregado
          </label>
          <input
            id="reference-aggregate-file" type="file" accept=".json,application/json"
            onChange={e => { void selectReport(e.currentTarget.files?.[0]); }}
            className="block w-full rounded-md border p-3 text-sm"
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            Gere o arquivo no PowerShell: npm run refs -- export-report mameto_lueji.
            Os dados não são salvos na Vercel; selecione novamente o arquivo ao recarregar a página.
          </p>
          <Link href="/reference-ai"><Button variant="outline">Analisar estratégia de conteúdo com GPT</Button></Link>
        </CardContent>
      </Card>
      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>Referência @{report.reference}</CardTitle>
            <CardDescription>
              Dados provenientes do relatório local fornecido por você, não auditados pela Meta.
              Gerado em {displayTime(report.generatedAt)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { title: 'Inspeções registradas', value: report.summary.inspections },
                { title: 'Perfis distintos nas amostras HMAC', value: report.summary.distinctObserved },
                { title: 'Contagem manual anterior', value: report.summary.manuallyReported },
                { title: 'Repetições observadas', value: report.summary.repeatedSeen },
              ].map(item => (
                <div key={item.title} className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{item.title}</p>
                  <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Última verificação: {displayTime(report.summary.lastSeen)}.
              Os dados são amostras parciais; não representam a quantidade de seguidores da referência,
              novos seguidores seus ou pessoas que seguiram você de volta.
            </p>
            <div className="space-y-2">
              <h3 className="font-semibold">Histórico recente</h3>
              {report.visits.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ainda não há verificações registradas.</p>
              ) : (
                <div className="space-y-2">
                  {report.visits.map((visit, index) => (
                    <div key={index} className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{displayTime(visit.observedAt)}</p>
                      <p className="text-muted-foreground">
                        {visit.source === 'manual_report_from_previous_check'
                          ? `Contagem declarada: ${visit.sampleSize} (sem identificadores)`
                          : `Amostra visível confirmada: ${visit.sampleSize}; novos: ${visit.uniqueNew}; repetidos: ${visit.repeated}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Acompanhamento após seguir um perfil</CardTitle>
          <CardDescription>
            Prazo de revisão do estado de um follow confirmado, não um comando de unfollow automático.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label htmlFor="follow-review-window" className="block text-sm font-medium">
            Revisar depois de
          </label>
          <select
            id="follow-review-window"
            value={reviewHours}
            onChange={e => setReviewHours(Number(e.target.value) === 24 ? 24 : 72)}
            className="rounded-md border bg-background px-4 py-2 text-sm"
          >
            <option value={24}>24 horas</option>
            <option value={72}>3 dias (72 horas)</option>
          </select>
          <p className="text-sm">
            Após um follow real confirmado no laboratório, consulte no PowerShell
            <code className="mx-1 rounded bg-muted p-1">npm run review -- {reviewHours}</code>
            para ver os perfis cujo prazo de revisão chegou.
          </p>
          <p className="text-xs text-muted-foreground">
            Não há robô contínuo, envio de mensagens, execução automática ou método para
            disfarçar ações humanas. A janela de revisão depende de histórico real do
            laboratório; o GPT não acessa a lista de seguidores e não decide unfollow sozinho.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
