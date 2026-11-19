import Link from 'next/link';
import { PageHeader } from '@/components/layouts/page-header';
import { ReferenceHistoryPanel } from '../_components/reference-history-panel';
import { ReferenceWorkflowPanel } from '../_components/reference-workflow-panel';

export const dynamic = 'force-dynamic';

export default function ReferencesDiagnosticsPage() {
  return (
    <div className="space-y-6">
      <Link href="/references" className="inline-block text-sm underline underline-offset-4">
        Voltar ao painel simples
      </Link>
      <PageHeader
        title="Diagnóstico experimental"
        description="Ferramentas técnicas de coleta, importação, histórico e revisão manual. Não executam follows ou unfollows."
      />
      <ReferenceWorkflowPanel />
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Histórico do laboratório local (opcional)</summary>
        <div className="pt-4"><ReferenceHistoryPanel /></div>
      </details>
    </div>
  );
}
