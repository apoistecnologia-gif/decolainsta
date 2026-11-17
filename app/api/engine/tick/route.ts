export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { runEngineTick } from '@/lib/worker/engine';

export async function POST() {
  const session = await auth();
  if (!session?.user || !(session.user as { id?: string }).id) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const result = await runEngineTick((session.user as { id: string }).id);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Erro no motor' }, { status: 500 });
  }
}
