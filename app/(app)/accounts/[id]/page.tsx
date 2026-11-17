import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { AccountDetail } from './_components/account-detail';
import { publicInstagramAccount } from '@/lib/instagram/accounts';

export const dynamic = 'force-dynamic';

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(session?.user as { id?: string } | undefined)?.id) redirect('/login');

  const { id } = await params;
  const userId = (session.user as { id: string }).id;

  const account = await prisma.instagramAccount.findFirst({
    where: { id, userId },
    include: {
      settings: true,
      targetAccounts: { orderBy: { createdAt: 'desc' } },
      whitelist: true,
    },
  });

  if (!account) redirect('/accounts');

  return <AccountDetail account={JSON.parse(JSON.stringify(publicInstagramAccount(account)))} />;
}
