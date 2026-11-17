export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password, name } = body ?? {};

    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 12 || password.length > 128 || (name !== undefined && (typeof name !== 'string' || name.length > 100))) {
      return NextResponse.json({ error: 'Informe um e-mail válido e uma senha de 12 a 128 caracteres' }, { status: 400 });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return NextResponse.json({ error: 'Este email já está cadastrado' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        password: hashedPassword,
        name: name || cleanEmail.split('@')[0],
      },
    });

    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? 'Erro interno' }, { status: 500 });
  }
}
