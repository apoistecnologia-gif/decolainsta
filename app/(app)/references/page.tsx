import { PageHeader } from '@/components/layouts/page-header';
import { ReferenceHistoryPanel } from './_components/reference-history-panel';

export const dynamic = 'force-dynamic';

export default function ReferencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Contas de referência — Histórico"
        description="Verificações reais de amostras e revisão manual após 24 ou 72 horas"
      />
      <ReferenceHistoryPanel />
    </div>
  );
}
