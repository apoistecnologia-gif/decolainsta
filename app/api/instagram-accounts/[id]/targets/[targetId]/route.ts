export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AUDIENCE_SOURCE_BINDING_ACTION, makeAudienceSourceBinding,
  parseAudienceSourceBinding } from '@/lib/reference-audience-source-registry';

async function verify(id: string, targetId: string) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return 401;
  const target = await prisma.targetAccount.findFirst({ where: { id: targetId, instagramAccountId: id, instagramAccount: { userId } } });
  return target ? 200 : 404;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { id, targetId } = await params;
  const status = await verify(id, targetId);
  if (status !== 200) return NextResponse.json({ error: 'Não autorizado ou alvo não encontrado' }, { status });
  const { enabled, niche, ...other } = await req.json().catch(() => ({}));
  if (Object.keys(other).length || (enabled !== undefined && typeof enabled !== 'boolean') || (niche !== undefined && (typeof niche !== 'string' || niche.length > 100))) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const updated = await prisma.$transaction(async tx => {
    const saved = await tx.targetAccount.update({
      where: { id: targetId },
      data: { ...(enabled !== undefined && { enabled }), ...(niche !== undefined && { niche }) },
    });
    // Explicit disable revokes the independent read-only collector binding.
    // Registration defaults to disabled for the legacy social-action workflow,
    // but adding a reference is allowed to prepare read-only data collection.
    if (enabled === false) {
      const last = await tx.activityLog.findFirst({
        where: { instagramAccountId: id, targetUsername: targetId,
          action: AUDIENCE_SOURCE_BINDING_ACTION },
        select: { details: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const entry = parseAudienceSourceBinding(last?.details ?? null);
      if (!entry || entry.enabled) {
        const disabled = makeAudienceSourceBinding(targetId, null, false);
        if (!disabled) throw Error('invalid-collector-revocation');
        await tx.activityLog.create({
          data: { instagramAccountId: id, targetUsername: targetId,
            action: AUDIENCE_SOURCE_BINDING_ACTION, success: true,
            details: JSON.stringify(disabled) },
        });
      }
    }
    return saved;
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { id, targetId } = await params;
  const status = await verify(id, targetId);
  if (status !== 200) return NextResponse.json({ error: 'Não autorizado ou alvo não encontrado' }, { status });
  await prisma.targetAccount.delete({ where: { id: targetId } });
  return NextResponse.json({ success: true });
}
