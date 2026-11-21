export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { instagramConfig, instagramAuthorizationUrl } from '@/lib/instagram/meta';

export async function GET(request: NextRequest) {
  // OAuth cookies are host-only. Start the flow at the same stable host
  // registered as the callback in Meta, even if a user entered through a
  // deployment-specific Vercel URL.
  let canonicalOrigin: string;
  try {
    const { redirectUri } = instagramConfig();
    const callback = new URL(redirectUri);
    if (callback.pathname !== '/api/instagram/connect/callback') {
      return NextResponse.json({ error:'Callback Meta inválido' }, { status:503 });
    }
    canonicalOrigin = callback.origin;
  } catch {
    return NextResponse.json({ error:'Configuração Meta incompleta' }, { status:503 });
  }
  if (request.nextUrl.origin !== canonicalOrigin) {
    const response = NextResponse.redirect(
      new URL('/api/instagram/connect', canonicalOrigin), 307);
    response.headers.set('Cache-Control','no-store');
    return response;
  }
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
