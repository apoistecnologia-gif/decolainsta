import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/layouts/page-header';
import { AccountsList } from './_components/accounts-list';
import { publicInstagramAccount } from '@/lib/instagram/accounts';

export const dynamic = 'force-dynamic';

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ instagram?: string }> }) {
  const { instagram: outcome } = await searchParams;
  const session = await auth();
  if (!(session?.user as { id?: string } | undefined)?.id) redirect('/login');

  const userId = (session.user as { id: string }).id;
  const accounts = await prisma.instagramAccount.findMany({
    where: { userId },
    include: {
      settings: true,
      _count: { select: { targetAccounts: true, followActions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <PageHeader
        title="Contas Instagram"
        description="Conecte sua conta profissional à API oficial do Instagram e acompanhe resultados reais"
      />
      <AccountsList initialAccounts={JSON.parse(JSON.stringify(accounts.map(publicInstagramAccount)))} outcome={outcome} />
    </div>
  );
}
