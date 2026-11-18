import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/encryption';
import type { InstagramAccount } from '@prisma/client';

// Exclude credentials and session data from every public DTO.
export function publicInstagramAccount<T extends InstagramAccount>(
  account: T
): Omit<T, 'encryptedPassword' | 'encryptedAccessToken' | 'proxyUrl' | 'sessionData'> & { connected: boolean } {
  const { encryptedPassword, encryptedAccessToken, proxyUrl, sessionData, ...rest } = account;
  return { ...rest, connected: Boolean(encryptedAccessToken && account.instagramUserId) };
}

export async function connectedAccount(accountId: string, userId: string) {
  const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) return null;
  if (!account.instagramUserId || !account.encryptedAccessToken)
    throw new Error('Conecte a conta pela autorização oficial do Instagram');
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now())
    throw new Error('Acesso à Meta expirado. Reconecte o Instagram.');
  // Unified login uses Business Integration System User tokens.
  // These cannot be refreshed through graph.instagram.com/refresh_access_token.
  const token = decrypt(account.encryptedAccessToken);
  return { account, token };
}
