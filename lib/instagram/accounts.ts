import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/encryption';
import { refreshLongLivedToken } from '@/lib/instagram/meta';
import type { InstagramAccount } from '@prisma/client';

// Remove all private fields, even when an API handler includes additional relations.
export function publicInstagramAccount<T extends InstagramAccount>(account: T): Omit<T, 'encryptedPassword' | 'encryptedAccessToken' | 'proxyUrl' | 'sessionData'> & { connected: boolean } {
  const { encryptedPassword, encryptedAccessToken, proxyUrl, sessionData, ...rest } = account;
  return { ...rest, connected: Boolean(encryptedAccessToken && account.instagramUserId) };
}

export async function connectedAccount(accountId: string, userId: string) {
  const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return null;
  if (!account.instagramUserId || !account.encryptedAccessToken) throw new Error('Conecte a conta pela autorização oficial do Instagram');
  let token = decrypt(account.encryptedAccessToken);
  // Refresh only after a token is at least 24 hours old and nearing expiry.
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < 7 * 86400000) {
    const refreshed = await refreshLongLivedToken(token);
    if (!refreshed.access_token) throw new Error('Falha ao renovar acesso à Meta. Reconecte o Instagram.');
    token = refreshed.access_token;
    await prisma.instagramAccount.update({
      where: { id: account.id },
      data: { encryptedAccessToken: encrypt(token), tokenExpiresAt: new Date(Date.now() + (refreshed.expires_in || 5184000) * 1000) },
    });
  }
  return { account, token };
}
