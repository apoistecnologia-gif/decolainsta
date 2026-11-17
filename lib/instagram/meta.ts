/** Instagram Platform with Instagram Login: official Meta API for professional accounts. */
export const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const GRAPH = 'https://graph.instagram.com';
const OAUTH = 'https://api.instagram.com';
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v24.0';

export function instagramConfig() {
  const clientId = process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri || !redirectUri.startsWith('https://')) {
    throw new Error('Configure INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET e INSTAGRAM_REDIRECT_URI (HTTPS)');
  }
  return { clientId, clientSecret, redirectUri };
}

export function instagramAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = instagramConfig();
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.search = new URLSearchParams({
    enable_fb_login: '0',
    force_authentication: '1',
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES.join(','),
    state,
  }).toString();
  return url.toString();
}

export class InstagramApiError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

async function parseInstagramResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    // Never log/return token-bearing request URLs or payloads.
    const message = typeof data?.error?.message === 'string' ? data.error.message : 'Falha na API do Instagram';
    throw new InstagramApiError(message, response.status === 429 ? 429 : 502);
  }
  return data as T;
}

async function postForm<T>(url: string, payload: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  return parseInstagramResponse<T>(response);
}

export interface InstagramToken { access_token: string; expires_in?: number; token_type?: string; }
export interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  account_type?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}
export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
}

export async function exchangeCode(code: string): Promise<InstagramToken> {
  const { clientId, clientSecret, redirectUri } = instagramConfig();
  const token = await postForm<InstagramToken>(`${OAUTH}/oauth/access_token`, {
    client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code',
    redirect_uri: redirectUri, code,
  });
  if (!token.access_token) throw new InstagramApiError('Instagram não retornou token de acesso');
  return token;
}

export async function longLivedToken(token: string): Promise<InstagramToken> {
  const { clientSecret } = instagramConfig();
  const url = new URL(`${GRAPH}/access_token`);
  url.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: clientSecret, access_token: token }).toString();
  return parseInstagramResponse<InstagramToken>(await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }));
}

export async function refreshLongLivedToken(token: string): Promise<InstagramToken> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token }).toString();
  return parseInstagramResponse<InstagramToken>(await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) }));
}

async function getGraph<T>(endpoint: string, token: string, query: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${API_VERSION}/${endpoint.replace(/^\//, '')}`);
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  return parseInstagramResponse<T>(response);
}

export async function getProfile(token: string): Promise<InstagramProfile> {
  return getGraph<InstagramProfile>('me', token, { fields: 'id,username,name,account_type,followers_count,follows_count,media_count,profile_picture_url' });
}

export async function getMedia(token: string, instagramUserId: string) {
  return getGraph<{ data: InstagramMedia[] }>(`${encodeURIComponent(instagramUserId)}/media`, token, {
    fields: 'id,caption,media_type,media_url,permalink,timestamp', limit: '12',
  });
}

/** Media containers are processed asynchronously. Never publish an unfinished or failed container. */
export async function getContainerStatus(token: string, containerId: string) {
  return getGraph<{ id: string; status_code: string }>(encodeURIComponent(containerId), token, { fields: 'id,status_code' });
}

export async function waitForReadyContainer(token: string, containerId: string) {
  // Keep total execution short enough for typical serverless handlers; no automatic publish retries.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { status_code } = await getContainerStatus(token, containerId);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED' || status_code === 'PUBLISHED') {
      throw new InstagramApiError(`Não foi possível publicar: contêiner ${status_code.toLowerCase()}`);
    }
    if (status_code !== 'IN_PROGRESS') throw new InstagramApiError('Resposta inesperada ao processar a imagem');
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new InstagramApiError('Imagem ainda em processamento pela Meta. Tente novamente com outra imagem; nenhuma publicação foi confirmada.', 503);
}

export async function publishPhoto(token: string, igUserId: string, imageUrl: string, caption: string) {
  const base = `${GRAPH}/${API_VERSION}/${encodeURIComponent(igUserId)}`;
  const container = await postForm<{ id: string }>(`${base}/media`, {
    image_url: imageUrl, caption, access_token: token,
  });
  if (!container.id) throw new InstagramApiError('Instagram não retornou ID de mídia');
  await waitForReadyContainer(token, container.id);
  // Issue media_publish only once: repeating after a lost HTTP response can duplicate a post.
  const published = await postForm<{ id: string }>(`${base}/media_publish`, { creation_id: container.id, access_token: token });
  if (!published.id) throw new InstagramApiError('Meta não confirmou o ID da publicação');
  return published;
}

export function isPublicImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || !host.includes('.') || host.endsWith('.localhost') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
    if (/^(0|10|127|169|172|192|198)\./.test(host) || host.endsWith('.internal') || host.endsWith('.local')) return false;
    return true;
  } catch { return false; }
}
