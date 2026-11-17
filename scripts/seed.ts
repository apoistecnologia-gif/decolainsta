/** Optional, explicit first admin creation. Does not ship with a fixed admin credential. */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email && !password) {
    console.log('Seed ignorado: nenhuma conta padrão é criada.');
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 16) {
    throw new Error('SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD (16+ caracteres) são necessários para criar um administrador explícito.');
  }
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log('Admin já existe. Seed não alterou a senha nem o nível de acesso.');
    return;
  }
  await prisma.user.create({ data: { email, password: await bcrypt.hash(password, 12), name: 'Administrador', role: 'admin' } });
  console.log('Administrador autorizado criado.');
}

main()
  .catch(error => { console.error('Falha no seed:', error instanceof Error ? error.message : 'Erro desconhecido'); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
