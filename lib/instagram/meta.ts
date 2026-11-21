/** Instagram API with Unified Login (Meta Business Login).
 * New Meta apps use a Facebook Graph Business Integration System User token.
 * Never use the legacy instagram.com/oauth flow or graph.instagram.com with this token.
 */
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v24.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;
const TIMEOUT_MS = 20000;

export function instagramConfig() {
  const clientId = process.env.INSTAGRAM_APP_ID;
  const clientSecret = process.env.INSTAGRAM_APP_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  const configId = process.env.INSTAGRAM_CONFIG_ID;
  if (!clientId || !/^\d+$/.test(clientId) || !clientSecret || !redirectUri ||
      !redirectUri.startsWith('https://') || !configId || !/^\d+$/.test(configId)) {
    throw new Error('Configure INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_CONFIG_ID e INSTAGRAM_REDIRECT_URI (HTTPS)');
  }
  return { clientId, clientSecret, redirectUri, configId };
}

export function instagramAuthorizationUrl(state: string) {
  const { clientId, redirectUri, configId } = instagramConfig();
  const url = new URL(`https://www.facebook.com/${API_VERSION}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: clientId,
    config_id: configId,
    redirect_uri: redirectUri,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  }).toString();
  return url.toString();
}

export class InstagramApiError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    // Do not log tokens or provider responses (can contain secrets or user data).
    const message = typeof data?.error?.message === 'string'
      ? data.error.message.slice(0, 300) : 'Falha na API oficial da Meta';
    throw new InstagramApiError(message, response.status === 429 ? 429 : 502);
  }
  return data as T;
}

async function postForm<T>(url: string, payload: Record<string, string>): Promise<T> {
  return parseResponse<T>(await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(payload), cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
}

async function graphGet<T>(path: string, token: string, fields?: string): Promise<T> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, '')}`);
  if (fields) url.searchParams.set('fields', fields);
  return parseResponse<T>(await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
}

export interface InstagramToken {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}
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
  id: string; caption?: string; media_type?: string; media_url?: string;
  permalink?: string; timestamp?: string;
}

export async function exchangeCode(code: string): Promise<InstagramToken> {
  const { clientId, clientSecret, redirectUri } = instagramConfig();
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.search = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, code,
  }).toString();
  const result = await parseResponse<InstagramToken>(await fetch(url, {
    cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
  if (!result.access_token) throw new InstagramApiError('A Meta não retornou um token da integração empresarial');
  return result;
}

/** /me is the system user, NOT the Instagram profile. Resolve explicitly assigned IG assets. */
export async function getAssignedInstagramAccounts(token: string): Promise<InstagramProfile[]> {
  const result = await graphGet<{ data?: Array<{ id?: string }> }>('me/assigned_instagram_accounts', token);
  const ids = [...new Set((result.data || []).map(item => item.id).filter((id): id is string => Boolean(id && /^\d+$/.test(id))))];
  if (!ids.length) throw new InstagramApiError('Nenhuma conta Instagram foi compartilhada com o aplicativo no portfólio empresarial. Autorize uma conta profissional na Meta.', 403);
  if (ids.length > 25) throw new InstagramApiError('Mais de 25 contas autorizadas; conecte em grupos menores', 400);
  // Verify the API can actually read the authorized account before saving any token.
  return Promise.all(ids.map(id => getProfile(token, id)));
}

export async function getProfile(token: string, igUserId: string): Promise<InstagramProfile> {
  if (!/^\d+$/.test(igUserId)) throw new InstagramApiError('Identificador de conta Instagram inválido', 400);
  const profile = await graphGet<InstagramProfile>(igUserId, token,
    'id,username,name,followers_count,follows_count,media_count,profile_picture_url');
  if (!profile.id || !profile.username) throw new InstagramApiError('Conta Instagram inacessível. Confira as permissões concedidas.', 403);
  // Never associate data from a different Instagram account with the requested account.
  if (profile.id !== igUserId) throw new InstagramApiError('A Meta retornou um perfil diferente da conta Instagram autorizada.', 403);
  return profile;
}

export async function getMedia(token: string, instagramUserId: string) {
  const path = `${encodeURIComponent(instagramUserId)}/media`;
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('fields', 'id,caption,media_type,media_url,permalink,timestamp');
  url.searchParams.set('limit', '12');
  return parseResponse<{ data: InstagramMedia[] }>(await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
}

export async function getContainerStatus(token: string, containerId: string) {
  return graphGet<{ id: string; status_code: string }>(encodeURIComponent(containerId), token, 'id,status_code');
}

export async function waitForReadyContainer(token: string, containerId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { status_code } = await getContainerStatus(token, containerId);
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED' || status_code === 'PUBLISHED')
      throw new InstagramApiError(`Contêiner de mídia: ${status_code.toLowerCase()}`);
    if (status_code !== 'IN_PROGRESS') throw new InstagramApiError('Processamento de mídia inesperado');
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new InstagramApiError('Mídia ainda em processamento; nenhuma publicação foi confirmada', 503);
}

export async function publishPhoto(token: string, igUserId: string, imageUrl: string, caption: string) {
  const base = `${GRAPH}/${encodeURIComponent(igUserId)}`;
  const container = await postForm<{ id: string }>(`${base}/media`, {
    image_url: imageUrl, caption, access_token: token,
  });
  if (!container.id) throw new InstagramApiError('A Meta não retornou ID de mídia');
  await waitForReadyContainer(token, container.id);
  // Exactly one publish attempt to avoid duplicates after ambiguous network failures.
  const published = await postForm<{ id: string }>(`${base}/media_publish`, {
    creation_id: container.id, access_token: token,
  });
  if (!published.id) throw new InstagramApiError('A Meta não confirmou a publicação');
  return published;
}

export function isPublicImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || !host.includes('.') || host.endsWith('.localhost') ||
        /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.endsWith('.internal') ||
        host.endsWith('.local')) return false;
    return true;
  } catch { return false; }
}
