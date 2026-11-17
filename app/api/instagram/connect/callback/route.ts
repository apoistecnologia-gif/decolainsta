export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { exchangeCode, longLivedToken, getProfile } from '@/lib/instagram/meta';

const PARAMS = { path: '/api/instagram/connect/callback', maxAge: 0 } as const;

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const code = request.nextUrl.searchParams.get('code');
  const returnedState = request.nextUrl.searchParams.get('state') || '';
  const expectedState = request.cookies.get('instagram_oauth_state')?.value || '';
  const denied = request.nextUrl.searchParams.has('error');
  let outcome = 'connected';

  try {
    if (!userId) { outcome = 'login_required'; throw new Error('Sessão inválida'); }
    if (denied) { outcome = 'access_denied'; throw new Error('Acesso negado'); }
    if (!code || !expectedState || !safeEqual(returnedState, expectedState) || !expectedState.startsWith(`${userId}.`)) {
      outcome = 'invalid_state'; throw new Error('Verificação OAuth inválida');
    }
    const short = await exchangeCode(code);
    const long = await longLivedToken(short.access_token);
    const token = long.access_token;
    const profile = await getProfile(token);
    if (!profile.id || !profile.username) throw new Error('Perfil Instagram inválido');

    const existing = await prisma.instagramAccount.findFirst({
      where: { userId, OR: [{ instagramUserId: profile.id }, { username: profile.username }] },
    });
    const data = {
      username: profile.username,
      instagramUserId: profile.id,
      encryptedPassword: '',
      proxyUrl: null,
      sessionData: null,
      encryptedAccessToken: encrypt(token),
      tokenExpiresAt: new Date(Date.now() + (long.expires_in || 5184000) * 1000),
      profileFollowersCount: profile.followers_count ?? null,
      profileMediaCount: profile.media_count ?? null,
      lastSyncedAt: new Date(),
      dryMode: true,
      status: 'inactive',
    };
    if (existing) {
      await prisma.instagramAccount.update({ where: { id: existing.id }, data });
    } else {
      await prisma.instagramAccount.create({ data: { userId, ...data, settings: { create: {} } } });
    }
  } catch {
    // Never redirect with exception text (provider may include secrets/PII).
    if (outcome === 'connected') outcome = 'connection_failed';
  }

  const response = NextResponse.redirect(new URL(`/accounts?instagram=${outcome}`, request.nextUrl.origin));
  response.cookies.set('instagram_oauth_state', '', PARAMS);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
