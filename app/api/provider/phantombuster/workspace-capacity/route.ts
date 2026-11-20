export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { inspectWorkspaceCapacity } from '@/lib/providers/phantombuster-workspace-capacity';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

/** Administrator-only read-only capacity check of the configured workspace. */
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview')
    return NextResponse.json({ error: 'Disponível apenas no Preview' },
      { status: 403, headers: HEADERS });
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId)
    return NextResponse.json({ error: 'Não autorizado' },
      { status: 401, headers: HEADERS });
  const operator = await prisma.user.findUnique({
    where: { id: userId }, select: { role: true },
  });
  if (operator?.role !== 'admin')
    return NextResponse.json({ error: 'Acesso restrito ao operador' },
      { status: 403, headers: HEADERS });
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  if (!isConfiguredPhantomBusterKey(apiKey))
    return NextResponse.json({ error: 'Integração não configurada' },
      { status: 409, headers: HEADERS });
  return NextResponse.json(await inspectWorkspaceCapacity(apiKey),
    { headers: HEADERS });
}
