import { PageHeader } from '@/components/layouts/page-header';
import { ReferenceHistoryPanel } from './_components/reference-history-panel';
import { ReferenceWorkflowPanel } from './_components/reference-workflow-panel';

export const dynamic = 'force-dynamic';

export default function ReferencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas de referência"
        description="Acompanhe referências, perfis registrados e revisões de follows informados, com prazos de 24 ou 72 horas."
      />
      <ReferenceWorkflowPanel />
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Histórico do laboratório local (opcional)</summary>
        <div className="pt-4"><ReferenceHistoryPanel /></div>
      </details>
    </div>
  );
}
