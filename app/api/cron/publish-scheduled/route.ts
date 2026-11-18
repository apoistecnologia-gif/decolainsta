export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { processScheduledPosts } from '@/lib/instagram/scheduled-publisher';

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const actual = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (process.env.DECOLAINSTA_AUTO_PUBLISH_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false, claimed: 0, published: 0, realFollows: 0, realUnfollows: 0 });
  }
  try {
    const result = await processScheduledPosts();
    return NextResponse.json(
      { enabled: true, ...result, realFollows: 0, realUnfollows: 0 },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ error: 'Falha na execução da fila de publicação' }, { status: 500 });
  }
}
