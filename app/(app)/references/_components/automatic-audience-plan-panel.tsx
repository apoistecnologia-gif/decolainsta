'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw } from 'lucide-react';

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
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!accountId) return;
    try {
      const data = await fetchPlan(accountId, signal);
      if (signal?.aborted) return;
      setPlan(data);
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Consulta indisponível');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
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
          {loading ? 'Atualizando...' : 'Atualizar planejamento'}
        </Button>
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
          Requisito solicitado: revisar os relacionamentos 48 horas após o follow.
          O sistema ainda não consegue verificar quem seguiu de volta nem executar follow ou unfollow
          por uma integração oficial; nenhum temporizador de ação real foi ativado.
        </p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
