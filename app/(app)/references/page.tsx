import { PageHeader } from '@/components/layouts/page-header';
import { SimpleReferencesPanel } from './_components/simple-references-panel';

export const dynamic = 'force-dynamic';

export default function ReferencesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Contas de referência"
        description="Cadastre referências e acompanhe o total de candidatos identificados." />
      <SimpleReferencesPanel />
    </div>
  );
}
