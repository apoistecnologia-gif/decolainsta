import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { AppSidebar } from './_components/app-sidebar';
import { AppShell } from '@/components/layouts/app-shell';
import { AppHeader } from './_components/app-header';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !(session.user as { id?: string }).id) redirect('/login');

  return (
    <AppShell
      sidebar={<AppSidebar user={session.user} />}
      header={<AppHeader user={session.user} />}
    >
      {children}
    </AppShell>
  );
}
