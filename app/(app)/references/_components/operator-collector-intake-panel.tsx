'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

type CollectorProgress = {
  status: 'running'|'finished'|'failed'|'pending'|'unverified'|'no-run'|
    'no-matching-collector'|'ambiguous-collector'|'invalid-key'|
    'rate-limited'|'unavailable'|'invalid-reference'|'not-configured';
  reference:string|null;
  latestRunSeen:boolean;
  instagramSessionVerifiedByProvider:false;
  resultsAttributedToSavedReference:false;
  newFollowersOnOwnAccount:0;
  followsExecutedByDiagnostic:0;
};
type SessionDiagnostic = {
  status: 'session-error-observed' | 'verification-required-observed' |
    'no-session-error-observed' | 'no-output' | 'invalid-key' | 'rate-limited' |
    'unavailable' | 'invalid-agent' | 'not-configured';
  evidence: 'previous_agent_output_only' | 'none';
  accountAliasMatched: boolean;
  officialMetaConnectionRecorded: boolean;
  instagramSessionVerifiedNow: false;
  passwordChangeImpactConfirmed: false;
  providerActionsExecuted: 0;
};
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
  const [sessionCheck, setSessionCheck] = useState<SessionDiagnostic | null>(null);
  const [collectorProgress, setCollectorProgress] = useState<CollectorProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [queue, setQueue] = useState<ProvisioningPlan | null>(null);
  const [draftOutcome, setDraftOutcome] = useState<DraftOutcome | null>(null);
  const [reconciled, setReconciled] = useState<Reconciled | null>(null);
  const [reconciliationOffset, setReconciliationOffset] = useState(0);
  const [error, setError] = useState('');
  async function checkCollectorProgress() {
    if(busy) return;
    setBusy(true); setError(''); setCollectorProgress(null);
    try {
      const response=await fetch('/api/operator/phantombuster-collector-progress',{
        method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
      });
      if(!response.ok) throw new Error('Consulta do coletor recusada');
      setCollectorProgress(await response.json() as CollectorProgress);
    } catch {
      setError('Não foi possível consultar a execução do coletor existente.');
    } finally {setBusy(false);}
  }

  async function checkExistingSessionLogs() {
    if (busy) return;
    setBusy(true); setError(''); setSessionCheck(null);
    try {
      const response = await fetch('/api/operator/phantombuster-session-diagnostic', {
        method:'GET', credentials:'same-origin', cache:'no-store', redirect:'error',
      });
      if (!response.ok) throw new Error('Consulta do histórico de sessão não autorizada.');
      setSessionCheck(await response.json() as SessionDiagnostic);
    } catch {
      setError('Não foi possível consultar o histórico do PhantomBuster.');
    } finally { setBusy(false); }
  }

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
      <div className="rounded-md border p-3 space-y-2">
        <h3 className="text-sm font-medium">Coleta em andamento no PhantomBuster</h3>
        <p className="text-xs text-muted-foreground">
          Consulta a última execução do coletor atualmente configurado para o
          teste antigo. Não inicia outras coletas nem cadastra novos seguidores.
        </p>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => void checkCollectorProgress()}>
          {busy ? 'Consultando...' : 'Consultar execução existente (somente leitura)'}
        </Button>
        {collectorProgress && <div role="status" className="space-y-1 text-sm">
          <p>Referência configurada: {collectorProgress.reference
            ? '@' + collectorProgress.reference : 'não identificada'}.</p>
          <p>{collectorProgress.status === 'running' ? 'Execução em andamento.' :
              collectorProgress.status === 'finished' ? 'Contêiner finalizado; resultados e origem ainda precisam ser verificados.' :
              collectorProgress.status === 'failed' ? 'A execução anterior terminou com erro.' :
              collectorProgress.status === 'pending' ? 'Execução na fila.' :
              collectorProgress.status === 'no-matching-collector' ? 'Nenhum coletor único encontrado para essa referência.' :
              collectorProgress.status === 'ambiguous-collector' ? 'Existem coletores duplicados; precisa de revisão.' :
              collectorProgress.status === 'no-run' ? 'Nenhuma execução registrada.' :
              'Estado não comprovado: ' + collectorProgress.status} </p>
          <p className="text-xs text-muted-foreground">
            Esta consulta não confirma novos seguidores na sua conta.
            As referências novas só serão processadas por execuções próprias,
            com identificação da origem de cada resultado.
          </p>
        </div>}
      </div>
      <div className="rounded-md border p-3 space-y-2">
        <h3 className="text-sm font-medium">Sessão Instagram no PhantomBuster</h3>
        <p className="text-xs text-muted-foreground">
          Consulta apenas o registro da última execução do agente existente.
          Não abre o Instagram, não testa a sessão atual e não executa ações.
        </p>
        <Button type="button" variant="outline" disabled={busy}
          onClick={() => void checkExistingSessionLogs()}>
          {busy ? 'Consultando...' : 'Verificar erros da sessão (somente leitura)'}
        </Button>
        {sessionCheck && <div role="status" className="text-sm space-y-1">
          <p>{sessionCheck.status === 'session-error-observed'
            ? 'O último registro contém erro de sessão. Reconecte o Instagram no próprio PhantomBuster.'
            : sessionCheck.status === 'verification-required-observed'
            ? 'O registro indica verificação ou desafio do Instagram. Resolva na conta oficial antes de qualquer nova execução.'
            : sessionCheck.status === 'no-session-error-observed'
            ? 'Nenhum erro de sessão foi identificado no registro disponível. Isso NÃO comprova que a sessão continua válida após a troca de senha.'
            : sessionCheck.status === 'no-output'
            ? 'Não há registro de execução disponível para verificar a sessão.'
            : sessionCheck.status === 'not-configured'
            ? 'Agente de teste não configurado no servidor.'
            : 'A consulta não confirmou o estado da sessão: ' + sessionCheck.status} </p>
          {!sessionCheck.accountAliasMatched && <p className="text-xs text-muted-foreground">
            O nome de conta configurado no teste antigo não corresponde ao cadastro atual.
            A identidade da sessão do PhantomBuster não foi comprovada.
          </p>}
          <p className="text-xs text-muted-foreground">
            Histórico anterior apenas. Sessão atual: não verificada.
            Nenhuma coleta, follow ou unfollow foi iniciada.
          </p>
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
