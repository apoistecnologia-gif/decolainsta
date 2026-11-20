'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
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
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold">Preparação de referências de todos os clientes</h2>
      <p className="text-xs text-muted-foreground">
        Somente para o operador. Vincula no máximo 3 coletores já existentes,
        após conferir o alvo exato; nunca cria ou executa agentes. Referências
        iguais em clientes diferentes ficam pendentes de revisão.
      </p>
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
