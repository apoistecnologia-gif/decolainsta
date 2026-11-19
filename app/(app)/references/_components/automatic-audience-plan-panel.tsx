'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw } from 'lucide-react';

type QueueResult = {
  status: 'synced' | 'capacity-reached';
  synced: number;
  total: number;
  availableInHistory?: number;
  referencesRepresented?: number;
  snapshotsRead?: number;
  historyTruncated?: boolean;
  actionsEnabled: false;
  instagramActionsExecuted: 0;
};
type RelationshipOverview = {
  basis: 'operator_reported_not_meta_verified';
  followbackVerifiedByMeta: false;
  socialActionsEnabled: false;
  reviewHours: 48;
  reportedRecords: number;
  manuallyTrackedCandidates: number;
  reportedFollowed: number;
  followBackReported: number;
  due48hReview: number;
  awaiting48h: number;
  followBackNotReported: number;
  protectedDue48h: number;
  invalidFollowTimestamps: number;
  keptReported: number;
  unfollowReported: number;
  identifiedWithoutReportedAction: number;
  identifiedWithReportedAction: number;
};

type CandidateIndexSummary = {
  relationshipOverview: RelationshipOverview;
  persistedCandidates: number;
  referencesRepresented: number;
  capacity: number;
  lastIndexedAt: string | null;
  duplicateRecords: number;
  byReference: { referenceId: string; referenceUsername: string; candidates: number }[];
};
async function fetchIndex(accountId: string, signal?: AbortSignal): Promise<CandidateIndexSummary> {
  const response = await fetch('/api/reference-candidate-queue?accountId=' + encodeURIComponent(accountId),
    { cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new Error('Não foi possível consultar os candidatos salvos.');
  return response.json() as Promise<CandidateIndexSummary>;
}

type Plan = {
  source: 'saved_snapshots_unverified';
  readOnly: true;
  actionsEnabled: false;
  referenceVerified: false;
  followbackVerified: false;
  suggestedReviewAfterHours: 48;
  referencesWithSnapshots: number;
  eligibleDistinct: number;
  candidates: { username: string; referenceUsername: string }[];
};

async function fetchPlan(accountId: string, signal?: AbortSignal): Promise<Plan> {
  const response = await fetch(`/api/reference-auto-plan?accountId=${encodeURIComponent(accountId)}`,
    { cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new Error('Não foi possível consultar os históricos salvos.');
  return response.json() as Promise<Plan>;
}

export function AutomaticAudiencePlanPanel({ accountId }: { accountId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [index, setIndex] = useState<CandidateIndexSummary | null>(null);
  const [queueError, setQueueError] = useState('');
  const [collectorNotice, setCollectorNotice] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!accountId) return;
    try {
      // Existing refresh button can test the real completed-run reader on Preview.
      // This request never starts a collector and never carries an API key.
      const providerResponse = await fetch('/api/provider/phantombuster/refresh-now', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        body: JSON.stringify({ accountId, operation: 'refresh-readonly' }), signal,
      });
      if (providerResponse.ok) {
        const status = await providerResponse.json() as {
          enabled?: boolean; examined?: number; indexed?: number;
          newCandidatesObserved?: number;
        };
        if (!signal?.aborted) setCollectorNotice(status.enabled
          ? `Leitura de resultados anteriores: ${status.examined ?? 0} referência(s) verificadas; ${status.indexed ?? 0} candidato(s) novos no índice.`
          : 'Coleta automática ainda não configurada. Dados já salvos permanecem disponíveis.');
      } else if (providerResponse.status !== 403 && !signal?.aborted) {
        setCollectorNotice('Leitura externa indisponível; mostrando os dados já salvos.');
      }
    } catch {
      if (!signal?.aborted) setCollectorNotice('Leitura externa indisponível; mostrando os dados já salvos.');
    }
    try {
      const data = await fetchPlan(accountId, signal);
      if (signal?.aborted) return;
      setPlan(data);
      const persisted = await fetchIndex(accountId, signal);
      if (!signal?.aborted) setIndex(persisted);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Consulta indisponível');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    // Synchronize ONLY previously saved, operator-approved history. No per-user
    // choices, no collector launch, and no social actions.
    void fetch('/api/reference-candidate-queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      body: JSON.stringify({ accountId, operation: 'sync-saved-history' }),
      signal: controller.signal,
    }).then(async response => {
      const data = await response.json() as QueueResult & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Sincronização indisponível');
      if (!controller.signal.aborted) setQueue(data);
      return fetchIndex(accountId, controller.signal).then(persisted => {
        if (!controller.signal.aborted) setIndex(persisted);
      });
    }).catch(err => {
      if (!controller.signal.aborted)
        setQueueError(err instanceof Error ? err.message : 'Fila indisponível');
    });
    void fetchPlan(accountId, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) {
          setPlan(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Consulta indisponível');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [accountId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Planejamento automático entre referências — sem ação real</CardTitle>
        <CardDescription>
          O sistema mistura automaticamente os nomes que já estão nos históricos salvos de todas
          as referências cadastradas. Você não precisa selecionar perfis individuais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Button type="button" variant="outline"
          onClick={() => { setLoading(true); setError(''); void load(); }}
          disabled={loading || !accountId}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {loading ? 'Atualizando...' : 'Atualizar dados'}
        </Button>
        {collectorNotice && <p role="status" className="text-xs text-muted-foreground">{collectorNotice}</p>}
        {queue && (
          <div className="rounded-md border p-3 space-y-1">
            <p className="font-medium">Índice persistente de candidatos</p>
            <p>
              {queue.total} candidato(s) distintos registrados no banco,
              {' '}{queue.synced} novo(s) nesta sincronização, a partir de históricos já salvos.
            </p>
            {index && (
              <div className="space-y-2 border-t pt-2">
                <p className="font-medium">
                  Confirmado no banco: {index.persistedCandidates} candidatos
                  em {index.referencesRepresented} referência(s).
                </p>
                <p className="text-xs text-muted-foreground">
                  Capacidade experimental: {index.capacity}. Estado: identificado, não verificado.
                </p>
                {index.byReference.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium">Distribuição por referência</p>
                    {index.byReference.map(item => (
                      <div key={item.referenceId} className="flex justify-between gap-2 border-b py-1 text-xs">
                        <span>@{item.referenceUsername}</span>
                        <span>{item.candidates} nomes</span>
                      </div>
                    ))}
                  </div>
                )}
                {index.lastIndexedAt && (
                  <p className="text-xs text-muted-foreground">
                    Último registro: {new Date(index.lastIndexedAt).toLocaleString('pt-BR')}
                  </p>
                )}
                {index.duplicateRecords > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Atenção: {index.duplicateRecords} duplicidade(s) legadas no índice.
                  </p>
                )}
              </div>
            )}
            {index && (
              <div className="space-y-2 border-t pt-2">
                <p className="font-medium">Estados de acompanhamento — somente registros informados</p>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <p>Identificados sem ação informada: <strong>{index.relationshipOverview.identifiedWithoutReportedAction}</strong></p>
                  <p>Follows informados: <strong>{index.relationshipOverview.reportedFollowed}</strong></p>
                  <p>Follow-backs informados: <strong>{index.relationshipOverview.followBackReported}</strong></p>
                  <p>Aguardando 48h: <strong>{index.relationshipOverview.awaiting48h}</strong></p>
                  <p>Elegíveis para revisão 48h: <strong>{index.relationshipOverview.due48hReview}</strong></p>
                  <p>Unfollows informados: <strong>{index.relationshipOverview.unfollowReported}</strong></p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {index.relationshipOverview.protectedDue48h} perfil(is) protegidos fora da revisão,
                  {' '}{index.relationshipOverview.followBackNotReported} follow(s) sem follow-back informado.
                  Esses eventos não foram verificados pela Meta.
                </p>
                {index.relationshipOverview.invalidFollowTimestamps > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Atenção: {index.relationshipOverview.invalidFollowTimestamps} registro(s)
                    com data de follow inconsistente.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Nenhum follow ou unfollow executado pelo DECOLA INSTA.
              O índice não é uma fila de execução do Instagram.
            </p>
            {queue.historyTruncated && <p className="text-xs text-muted-foreground">
              Histórico extenso: somente as últimas consultas dentro do limite foram processadas.
            </p>}
          </div>
        )}
        {queueError && <p role="alert" className="text-destructive">
          Não foi possível sincronizar os candidatos: {queueError}
        </p>}
        {plan && (
          <>
            <p>
              {plan.referencesWithSnapshots} referência(s) com candidatos,
              {' '}{plan.eligibleDistinct} nome(s) distintos disponíveis no histórico
              e até {plan.candidates.length} nomes na ordem de prévia.
            </p>
            {plan.candidates.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {plan.candidates.map(item => (
                  <span key={item.username} className="rounded-md border px-2 py-1 text-xs">
                    @{item.username} · referência @{item.referenceUsername}
                  </span>
                ))}
              </div>
            ) : <p className="text-muted-foreground">Nenhum candidato disponível nos históricos registrados.</p>}
            <p className="text-xs text-muted-foreground">
              A ordem é alternada entre referências e pode variar entre dias.
              Origem indicada pela PhantomBuster, não verificada pela Meta.
              Isso não representa todos os seguidores coletados pela PhantomBuster.
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Regra confirmada: 48 horas após o follow, perfis que seguiram de volta
          tornam-se elegíveis para avaliação de unfollow; quem não seguiu de volta não entra nessa regra.
          O sistema ainda não verifica follow-back nem executa follow/unfollow automaticamente
          por uma integração oficial; nenhum temporizador de ação real foi ativado.
        </p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
