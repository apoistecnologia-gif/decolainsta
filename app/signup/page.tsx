import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { SignupForm } from './_components/signup-form';
import { AuthLayout } from '@/components/layouts/auth-layout';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');

  return (
    <AuthLayout title="Criar Conta" description="Cadastre-se para começar a crescer">
      <SignupForm />
    </AuthLayout>
  );
}
