/**
 * OFFLINE ONLY. Does not expose an HTTP route or automatically run on deploy.
 * Check mode (default) verifies eligibility and the existing account password
 * without mutating anything. Apply mode requires explicit operator approval.
 *
 * IMPORTANT: if Preview and Production share Neon, applying this changes the
 * user's role in BOTH environments. Never run against an unreviewed database.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  eligibleFirstOperator, explicitFirstOperatorApproval,
} from '../lib/first-operator-bootstrap';

async function main() {
  const mode = process.env.FIRST_OPERATOR_MODE ?? 'check';
  const email = process.env.FIRST_OPERATOR_EMAIL?.trim().toLowerCase() ?? '';
  const password = process.env.FIRST_OPERATOR_PASSWORD ?? '';
  if ((mode !== 'check' && mode !== 'apply') ||
      !explicitFirstOperatorApproval(
        mode, process.env.FIRST_OPERATOR_CONFIRM, process.env.VERCEL_ENV) ||
      !email || !password || password.length > 1024)
    throw new Error('Operação não autorizada ou credenciais incompletas');

  const prisma = new PrismaClient();
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize competing first-operator invocations without a migration.
      // SELECT only an integer to avoid decoding a PostgreSQL void result.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(17320, 20261120)`;
      const users = await tx.user.findMany({
        select: { id: true, email: true, role: true, password: true },
        take: 2,
      });
      const adminCount = await tx.user.count({ where: { role: 'admin' } });
      const candidate = users.length === 1 ? users[0] : null;
      if (!eligibleFirstOperator({
        requestedEmail: email,
        knownUserCount: users.length,
        adminCount,
        candidate: candidate ? {
          email: candidate.email, role: candidate.role,
          hasPasswordHash: Boolean(candidate.password),
        } : null,
      })) throw new Error('Conta não elegível para primeiro operador');

      // The owner must prove the password of the existing account.
      if (!candidate || !await bcrypt.compare(password, candidate.password))
        throw new Error('Verificação de titularidade não concluída');

      if (mode === 'check') return 'verified-without-write' as const;

      const changed = await tx.user.updateMany({
        where: { id: candidate.id, email: candidate.email, role: 'user' },
        data: { role: 'admin' },
      });
      if (changed.count !== 1)
        throw new Error('A promoção não foi confirmada');
      return 'promoted' as const;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    });
    console.log(outcome === 'promoted'
      ? 'Primeiro operador habilitado mediante verificação explícita.'
      : 'Titularidade verificada; nenhuma permissão foi alterada.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // No database errors, emails, password values or hashes in CI logs.
  console.error('Bootstrap do primeiro operador não foi concluído.');
  process.exitCode = 1;
});
