export const dynamic = 'force-dynamic';

import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { exchangeCode, getAssignedInstagramAccounts } from '@/lib/instagram/meta';

const COOKIE_PATH = '/api/instagram/connect/callback';

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
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
    if (!userId) { outcome = 'login_required'; throw new Error('Sem sessão'); }
    if (denied) { outcome = 'access_denied'; throw new Error('Acesso negado'); }
    if (!code || !expectedState || !safeEqual(returnedState, expectedState) ||
        !expectedState.startsWith(`${userId}.`)) {
      outcome = 'invalid_state';
      throw new Error('Estado OAuth inválido');
    }

    // Meta returns a Business Integration System User token, which may not expire.
    const authorization = await exchangeCode(code);
    const token = authorization.access_token;
    const profiles = await getAssignedInstagramAccounts(token);
    const expiresAt = authorization.expires_in && authorization.expires_in > 0
      ? new Date(Date.now() + authorization.expires_in * 1000) : null;

    for (const profile of profiles) {
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
        tokenExpiresAt: expiresAt,
        profileFollowersCount: profile.followers_count ?? null,
        profileMediaCount: profile.media_count ?? null,
        lastSyncedAt: new Date(),
        dryMode: true,
        status: 'inactive',
      };
      if (existing) {
        await prisma.instagramAccount.update({ where: { id: existing.id }, data });
      } else {
        await prisma.instagramAccount.create({
          data: { userId, ...data, settings: { create: {} } },
        });
      }
    }
  } catch {
    // Do not put Meta errors, tokens, codes or personal data into redirects/logs.
    if (outcome === 'connected') outcome = 'connection_failed';
  }

  const response = NextResponse.redirect(new URL(`/accounts?instagram=${outcome}`, request.nextUrl.origin));
  response.cookies.set('instagram_oauth_state', '', {
    httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: COOKIE_PATH,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
