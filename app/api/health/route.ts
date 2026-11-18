export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/** Minimal health check. Never return infrastructure names, credentials, or DB errors. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'connected' }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
