import { PageHeader } from '@/components/layouts/page-header';
import { ReferenceAIForm } from './_components/reference-ai-form';

export const dynamic = 'force-dynamic';

export default function ReferenceAIPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="IA — Contas de referência"
        description="Análise de estratégias com GPT, sem autenticação do Instagram pela Meta"
      />
      <ReferenceAIForm />
    </div>
  );
}
