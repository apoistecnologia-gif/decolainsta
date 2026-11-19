export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runReadOnlyAudienceRefresh } from '@/lib/server/reference-audience-refresh-runner';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  const expected = Buffer.from('Bearer ' + secret, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Vercel cron route; preview does not automatically run cron jobs. */
export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: 'Não autorizado' },
      { status: 401, headers: HEADERS });
  return runReadOnlyAudienceRefresh();
}
