'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type WorkspaceCapacity = {
  status: 'ok' | 'invalid-key' | 'rate-limited' | 'unavailable' | 'unexpected-response';
  agents: number | null;
  resourcesRead: boolean;
  slotMetrics: Array<{ field: string; value: number }>;
  exactFreeSlotsKnown: false;
};
type ProvisioningPlan = {
  total: number;
  linked: number;
  pendingSetup: number;
  previousAttemptNeedsReview: number;
  explicitlyRevoked: number;
  eligible: number;
  next: boolean;
  draftCreationEnabled: boolean;
  sharedCollector?: {
    mode: 'one_reference_per_execution';
    pendingReferences: number;
    mayShareOneAgentSequentially: boolean;
    collectorAssigned: false;
    providerRunInputVerified: false;
    exclusiveAgentLeaseImplemented: false;
    exclusiveAgentClaimPrepared: true;
    exclusiveAgentLeaseEnabled: false;
    importsEnabled: false;
    actionsEnabled: false;
  };
};
type DraftOutcome = {
  state: 'created' | 'existing-draft' | 'capacity-reached' |
    'rejected' | 'unconfirmed';
};
type Reconciled = {
  checked: number;
  bound: number;
  pending: number;
  notConfigured: number;
  unverified: number;
  ambiguous: number;
  nextOffset: number | null;
};
type Result = {
  matched: number;
  alreadyBound: number;
  unmatched: number;
  ambiguousOrInUse: number;
  ambiguousAcrossCustomers: number;
  revoked: number;
  deferred: number;
  referencesExamined: number;
};

export function OperatorCollectorIntakePanel() {
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState<WorkspaceCapacity | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [queue, setQueue] = useState<ProvisioningPlan | null>(null);
  const [draftOutcome, setDraftOutcome] = useState<DraftOutcome | null>(null);
  const [reconciled, setReconciled] = useState<Reconciled | null>(null);
  const [reconciliationOffset, setReconciliationOffset] = useState(0);
  const [error, setError] = useState('');
  async function checkCapacity() {
    if (busy) return;
    setBusy(true); setError(''); setCapacity(null);
    try {
      const response = await fetch('/api/provider/phantombuster/workspace-capacity', {
        method: 'GET', credentials: 'same-origin',
        cache: 'no-store', redirect: 'error',
      });
      if (!response.ok) throw Error('Consulta à capacidade não autorizada.');
      setCapacity(await response.json() as WorkspaceCapacity);
    } catch {
      setError('Não foi possível conferir a capacidade do PhantomBuster.');
    } finally { setBusy(false); }
  }
  async function reconcilePrepared() {
    if (busy) return;
    setBusy(true); setError(''); setReconciled(null);
    try {
      const response = await fetch('/api/provider/phantombuster/reconcile-prepared', {
        method: 'POST', credentials: 'same-origin',
        cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reconciliationOffset
          ? { operation:'reconcile-prepared', offset: reconciliationOffset }
          : { operation:'reconcile-prepared' }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'error' in data
          ? String((data as {error: unknown}).error)
          : 'Não foi possível validar os rascunhos';
        throw new Error(detail);
      }
      const outcome = data as Reconciled;
      setReconciled(outcome);
      setReconciliationOffset(typeof outcome.nextOffset === 'number'
        ? outcome.nextOffset : 0);
      setQueue(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na validação de coletores');
    } finally { setBusy(false); }
  }
  async function matchAll() {
    if (busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/provider/phantombuster/match-all-customers', {
        method: 'POST', credentials: 'same-origin',
        cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'match-all-existing' }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : 'Falha ao associar coletores existentes';
        throw new Error(detail);
      }
      setResult(data as Result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na associação');
    } finally {
      setBusy(false);
    }
  }
  async function runProvisioning(operation: 'plan' | 'create-next-draft') {
    if (busy) return;
    setBusy(true); setError('');
    if (operation === 'create-next-draft') setDraftOutcome(null);
    try {
      const response = await fetch('/api/provider/phantombuster/provision-all-customers', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(operation === 'plan' ? { operation } :
          { operation, confirmCreateUnconfiguredDraft: true }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const detail = data && typeof data === 'object' && 'error' in data
          ? String((data as {error: unknown}).error)
          : 'Não foi possível consultar a fila';
        throw new Error(detail);
      }
      if (operation === 'plan') setQueue(data as ProvisioningPlan);
      else {
        setDraftOutcome(data as DraftOutcome);
        setQueue(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na preparação');
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold">Preparação de referências de todos os clientes</h2>
      <p className="text-xs text-muted-foreground">
        Somente para o operador. Vincula no máximo 3 coletores já existentes,
        após conferir o alvo exato; nunca cria ou executa agentes. Referências
        iguais em clientes diferentes ficam pendentes de revisão.
      </p>
      <div className="rounded-md border p-3 space-y-2">
        <h3 className="text-sm font-medium">Capacidade da sua workspace PhantomBuster</h3>
        <p className="text-xs text-muted-foreground">
          Consulta as métricas de recursos e a quantidade de coletores sem
          criar, executar ou modificar agentes.
        </p>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => void checkCapacity()}>
          {busy ? 'Consultando...' : 'Validar capacidade do provedor'}
        </Button>
        {capacity && <div role="status" className="text-sm space-y-1">
          <p>{capacity.status === 'ok'
            ? 'Provedor respondeu à consulta de recursos.'
            : 'Capacidade não confirmada: ' + capacity.status} </p>
          {capacity.status === 'ok' && <p>
            Agentes na workspace (todos os tipos, não apenas coletores): {capacity.agents ?? 'desconhecido'}.
          </p>}
          {capacity.slotMetrics.map(metric => <p key={metric.field}>
            {metric.field}: {metric.value}
          </p>)}
          {capacity.status === 'ok' && capacity.slotMetrics.length === 0 &&
            <p>O provedor não informou números de vagas em formato reconhecido.
              Não é possível afirmar quantas vagas restam.</p>}
        </div>}
      </div>
      <Button type="button" variant="outline" disabled={busy}
        onClick={() => void matchAll()}>
        {busy ? 'Verificando coletores...' : 'Vincular coletores disponíveis'}
      </Button>
      {result && <p role="status" className="text-sm">
        Referências: {result.referencesExamined}. Novos vínculos: {result.matched}.
        Já vinculadas: {result.alreadyBound}. Sem coletor: {result.unmatched}.
        Ambíguas: {result.ambiguousOrInUse + result.ambiguousAcrossCustomers}.
        Revogadas: {result.revoked}. Aguardando próxima rodada: {result.deferred}.
      </p>}
      <div className="border-t pt-3 space-y-2">
        <h3 className="text-sm font-semibold">Concluir configuração dos coletores preparados</h3>
        <p className="text-xs text-muted-foreground">
          Após configurar um rascunho autorizado no PhantomBuster, confira sua
          identidade e referência para vinculá-lo automaticamente à conta correta.
          Esta operação só consulta configurações; não inicia coletas.
        </p>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => void reconcilePrepared()}>
          {busy ? 'Verificando...' : reconciliationOffset > 0
            ? 'Conferir próximos rascunhos' : 'Conferir rascunhos configurados'}
        </Button>
        {reconciled && <p role="status" className="text-sm">
          Verificados: {reconciled.checked}. Novas fontes vinculadas: {reconciled.bound}.
          Aguardando preparação: {reconciled.pending - reconciled.bound}.
          Configuração incompleta: {reconciled.notConfigured}.
          Identidade não confirmada: {reconciled.unverified}.
          Conflitos de titularidade: {reconciled.ambiguous}.
          {reconciled.nextOffset !== null && ' Existem outras referências para verificar.'}
        </p>}
        <h3 className="text-sm font-semibold pt-2">Fila de preparação de novos coletores</h3>
        <p className="text-xs text-muted-foreground">
          Consulta todas as referências cadastradas, sem escolher clientes
          individualmente. A verificação não ocupa vagas no provedor.
        </p>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => void runProvisioning('plan')}>
          {busy ? 'Verificando...' : 'Consultar fila de preparação'}
        </Button>
        {queue && <div className="text-sm space-y-1">
          <p>Referências: {queue.total}. Fontes vinculadas: {queue.linked}.</p>
          <p>Referências prontas para preparar: {queue.eligible}.
            Rascunhos já criados aguardando configuração: {queue.pendingSetup}.</p>
          <p>Exigem revisão: {queue.previousAttemptNeedsReview}.
            Revogadas: {queue.explicitlyRevoked}.</p>
          {queue.sharedCollector && <p className="rounded-md border p-2 text-xs text-muted-foreground">
            Reutilização sequencial: {queue.sharedCollector.pendingReferences} referência(s)
            aguardam preparação. O mesmo agente poderá ser reaproveitado apenas
            em execuções separadas, depois de validar a sessão, a reserva exclusiva
            e a origem do resultado de cada referência. {queue.sharedCollector.exclusiveAgentClaimPrepared ? 'A reserva transacional já está preparada no backend, mas segue desativada enquanto não houver liberação segura do agente.' : 'A reserva exclusiva ainda não está preparada.'} Nenhuma coleta ou ação está habilitada.
          </p>}
          {queue.next && queue.draftCreationEnabled && (
            <Button type="button" variant="outline" disabled={busy}
              onClick={() => void runProvisioning('create-next-draft')}>
              Criar 1 rascunho no PhantomBuster (ocupa vaga)
            </Button>
          )}
          {!queue.draftCreationEnabled && <p className="text-xs text-muted-foreground">
            Criação de agentes externos desativada pelo servidor.
          </p>}
          {!queue.next && <p className="text-xs text-muted-foreground">
            Nenhuma referência elegível para um novo rascunho.
          </p>}
        </div>}
        {draftOutcome && <p role="status" className="text-sm">
          {draftOutcome.state === 'created' ||
            draftOutcome.state === 'existing-draft'
            ? 'Rascunho encontrado ou criado. Ainda requer configuração e autorização no provedor.'
            : draftOutcome.state === 'capacity-reached'
            ? 'Sem vagas para criar outro coletor no PhantomBuster.'
            : 'Preparação não confirmada. Revisão do operador necessária; não repetir automaticamente.'}
        </p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
