export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { publicInstagramAccount } from '@/lib/instagram/accounts';
import { validateSettings } from '@/lib/instagram/validation';

async function ownerAccount(id: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { status: 401 as const, account: null };
  const account = await prisma.instagramAccount.findFirst({ where: { id, userId } });
  return { status: 404 as const, account };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, account } = await ownerAccount(id);
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status });
  const detailed = await prisma.instagramAccount.findUnique({
    where: { id }, include: {
      settings: true, targetAccounts: { orderBy: { createdAt: 'desc' } },
      whitelist: true, _count: { select: { followActions: true, activityLogs: true, alerts: true } },
    },
  });
  return NextResponse.json(publicInstagramAccount(detailed!));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, account } = await ownerAccount(id);
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status });
  const body = await req.json().catch(() => ({}));
  const { status: newStatus, dryMode, settings } = body;
  if (dryMode === false) return NextResponse.json({ error: 'O motor de seguir/deixar de seguir é somente demonstração. Use OAuth para ações reais disponíveis na API Meta.' }, { status: 400 });
  if (newStatus !== undefined && !['inactive', 'active', 'paused'].includes(newStatus)) {
    return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
  }
  if (Object.keys(body).some(key => !['status', 'dryMode', 'settings'].includes(key))) {
    return NextResponse.json({ error: 'Campo não permitido' }, { status: 400 });
  }
  let safeSettings: ReturnType<typeof validateSettings> | undefined;
  try { if (settings !== undefined) safeSettings = validateSettings(settings); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Configurações inválidas' }, { status: 400 }); }
  if (safeSettings) {
    const current = await prisma.accountSettings.findUnique({ where: { instagramAccountId: id } });
    const minDelay = safeSettings.minDelaySeconds ?? current?.minDelaySeconds ?? 25;
    const maxDelay = safeSettings.maxDelaySeconds ?? current?.maxDelaySeconds ?? 90;
    if (Number(minDelay) > Number(maxDelay)) return NextResponse.json({ error: 'Delay mínimo maior que o máximo' }, { status: 400 });
  }
  const updated = await prisma.instagramAccount.update({
    where: { id }, data: {
      ...(newStatus !== undefined ? { status: newStatus } : {}),
      dryMode: true,
      ...(safeSettings ? { settings: { upsert: { create: safeSettings, update: safeSettings } } } : {}),
    }, include: { settings: true },
  });
  return NextResponse.json(publicInstagramAccount(updated));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, account } = await ownerAccount(id);
  if (!account) return NextResponse.json({ error: 'Conta não encontrada' }, { status });
  await prisma.instagramAccount.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
