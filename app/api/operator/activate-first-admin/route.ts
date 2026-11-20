export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import {
  eligibleFirstOperator, FIRST_OPERATOR_CONFIRMATION,
} from '@/lib/first-operator-bootstrap';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const deny = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: HEADERS });

/**
 * Preview-only, signed-in FIRST user re-verifies their current password.
 * Never silently elevate an account based on database count alone.
 * No password, hashes or account identifiers are logged or returned.
 */
export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== 'preview')
    return deny('Ativação administrativa disponível somente no Preview', 403);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return deny('Não autorizado', 401);
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return deny('Origem inválida', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return deny('Formato inválido', 415);
  const raw = await request.text().catch(() => '');
  if (!raw || raw.length > 1400) return deny('Solicitação inválida', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return deny('Solicitação inválida', 400);
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).length !== 2 ||
      body.confirm !== FIRST_OPERATOR_CONFIRMATION ||
      typeof body.password !== 'string' ||
      body.password.length < 1 || body.password.length > 1024)
    return deny('Confirmação inválida', 400);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async tx => {
        // Shares the offline bootstrap transaction lock, preventing competing
        // first-admin activations across browser tabs or CLI executions.
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(17320, 20261120)`;
        const [total, admins, owner] = await Promise.all([
          tx.user.count(),
          tx.user.count({ where: { role: 'admin' } }),
          tx.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, role: true, password: true },
          }),
        ]);
        if (!owner || !eligibleFirstOperator({
          requestedEmail: owner.email,
          knownUserCount: total,
          adminCount: admins,
          candidate: {
            email: owner.email, role: owner.role,
            hasPasswordHash: Boolean(owner.password),
          },
        })) return 'not-eligible' as const;
        if (!await bcrypt.compare(body.password as string, owner.password))
          return 'wrong-password' as const;
        const promoted = await tx.user.updateMany({
          where: { id: owner.id, email: owner.email, role: 'user' },
          data: { role: 'admin' },
        });
        return promoted.count === 1 ? 'activated' as const : 'not-eligible' as const;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });

      if (result !== 'activated')
        return deny('Não foi possível verificar ou habilitar esta conta', 403);
      return NextResponse.json({
        status: 'activated', instagramActionsExecuted: 0,
      }, { headers: HEADERS });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && attempt < 2)
        continue;
      return deny('Ativação indisponível', 503);
    }
  }
  return deny('Conflito de ativação', 503);
}
