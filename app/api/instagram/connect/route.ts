export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { instagramAuthorizationUrl } from '@/lib/instagram/meta';

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.redirect(new URL('/login', request.nextUrl.origin));
  try {
    const state = `${userId}.${crypto.randomBytes(24).toString('hex')}`;
    const response = NextResponse.redirect(instagramAuthorizationUrl(state));
    response.cookies.set('instagram_oauth_state', state, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      maxAge: 600, path: '/api/instagram/connect/callback',
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Instagram indisponível' }, { status: 503 });
  }
}
