import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from './_components/login-form';
import { AuthLayout } from '@/components/layouts/auth-layout';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <AuthLayout title="InstaGrowth System" description="Entre para gerenciar suas contas">
      <LoginForm />
    </AuthLayout>
  );
}
