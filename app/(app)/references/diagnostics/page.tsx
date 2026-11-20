import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/layouts/page-header';
import { ReferenceHistoryPanel } from '../_components/reference-history-panel';
import { OperatorCollectorIntakePanel } from '../_components/operator-collector-intake-panel';
import { ReferenceWorkflowPanel } from '../_components/reference-workflow-panel';

export const dynamic = 'force-dynamic';

export default async function ReferencesDiagnosticsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const operator = userId ? await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  }) : null;
  return (
    <div className="space-y-6">
      <Link href="/references" className="inline-block text-sm underline underline-offset-4">
        Voltar ao painel simples
      </Link>
      <PageHeader
        title="Diagnóstico experimental"
        description="Ferramentas técnicas de coleta, importação, histórico e revisão manual. Não executam follows ou unfollows."
      />
      {operator?.role === 'admin' && <OperatorCollectorIntakePanel />}
      <ReferenceWorkflowPanel />
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Histórico do laboratório local (opcional)</summary>
        <div className="pt-4"><ReferenceHistoryPanel /></div>
      </details>
    </div>
  );
}
