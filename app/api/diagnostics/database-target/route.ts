export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Temporary preview-only read-only diagnostic. Never exposes any credential or host.
// Remove this endpoint after verifying the database target.
const EXPECTED_TARGET_DIGEST = 'ab3e85e5bc1cfea328e3eb5492cad5bcd2cd9ad1c9daf49b8a08956c8aebfa54';

export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let matchedConnection = false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    const normalizedHost = url.hostname.toLowerCase().replace('-pooler.', '.');
    const dbPath = decodeURIComponent(url.pathname);
    const digest = createHash('sha256').update(`${normalizedHost}${dbPath}`).digest('hex');
    matchedConnection = ['postgres:', 'postgresql:'].includes(url.protocol)
      && digest === EXPECTED_TARGET_DIGEST;
  } catch {
    // Invalid or missing environment value; report a mismatch, never a raw URL.
  }

  let databaseReachable = false;
  if (matchedConnection) {
    try {
      const rows = await prisma.$queryRaw<Array<{ databaseName: string }>>`SELECT current_database() AS "databaseName"`;
      databaseReachable = rows[0]?.databaseName === 'decolainsta';
    } catch {
      // The connection may be configured but unavailable.
    }
  }

  return NextResponse.json(
    { verified: matchedConnection && databaseReachable, matchedConnection, databaseReachable },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
