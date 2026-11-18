import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../lib/encryption';
import { cleanUsername, validateSettings } from '../lib/instagram/validation';
import { getProfile, getMedia, instagramAuthorizationUrl, getAssignedInstagramAccounts, exchangeCode, publishPhoto, isPublicImageUrl } from '../lib/instagram/meta';

test('encryption rejects missing secret, roundtrip, tampering', () => {
  const old = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  assert.throws(() => encrypt('token'), /ENCRYPTION_KEY/);
  process.env.ENCRYPTION_KEY = '32_random_character_secret_for_test_2026';
  const ciphertext = encrypt('token-super-secreto');
  assert.equal(decrypt(ciphertext), 'token-super-secreto');
  assert.equal(ciphertext.includes('token-super-secreto'), false);
  const fields = ciphertext.split(':');
  fields[3] = (fields[3][0] === 'A' ? 'B' : 'A') + fields[3].slice(1);
  const corrupted = fields.join(':');
  assert.throws(() => decrypt(corrupted));
  if (old === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = old;
});

test('username and settings reject invalid values and unknown database fields', () => {
  assert.equal(cleanUsername('  @Perfil.Teste  '), 'perfil.teste');
  assert.equal(cleanUsername('@x!'), null);
  assert.equal(cleanUsername({}), null);
  assert.deepEqual(validateSettings({ maxFollowsPerDay: 50, warmupEnabled: true }), { maxFollowsPerDay: 50, warmupEnabled: true });
  assert.throws(() => validateSettings({ instagramAccountId: 'other-user-account' }), /não permitida/);
  assert.throws(() => validateSettings({ maxFollowsPerDay: -1 }), /inválido/);
});

test('image URLs must be public HTTPS and without credentials', () => {
  assert.equal(isPublicImageUrl('https://example.com/photo.jpg'), true);
  for (const url of ['http://example.com/image.jpg', 'https://localhost/img.jpg', 'https://127.0.0.1/img.jpg', 'https://user:pass@example.com/img.jpg', 'file:///etc/passwd']) {
    assert.equal(isPublicImageUrl(url), false, url);
  }
});

test('unified login requests a configuration ID and does not send legacy scopes', () => {
  const old = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET,
    redirect: process.env.INSTAGRAM_REDIRECT_URI, config: process.env.INSTAGRAM_CONFIG_ID };
  process.env.INSTAGRAM_APP_ID = '1734982044217816';
  process.env.INSTAGRAM_APP_SECRET = 'test_secret';
  process.env.INSTAGRAM_CONFIG_ID = '2676997126089732';
  process.env.INSTAGRAM_REDIRECT_URI = 'https://example.com/api/instagram/connect/callback';
  try {
    const url = new URL(instagramAuthorizationUrl('stateABC'));
    assert.equal(url.hostname, 'www.facebook.com');
    assert.equal(url.searchParams.get('config_id'), '2676997126089732');
    assert.equal(url.searchParams.get('client_id'), '1734982044217816');
    assert.equal(url.searchParams.get('scope'), null);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'stateABC');
  } finally {
    for (const [key, value] of Object.entries({ INSTAGRAM_APP_ID: old.id,
      INSTAGRAM_APP_SECRET: old.secret, INSTAGRAM_REDIRECT_URI: old.redirect,
      INSTAGRAM_CONFIG_ID: old.config })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('live profile / media requests and publishing call official API using mocked network', async () => {
  const originalFetch = global.fetch;
  const requests: { url: URL; init?: RequestInit }[] = [];
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    requests.push({ url, init });
    assert.equal(url.hostname, 'graph.facebook.com');
    if (url.pathname.endsWith('/123')) return Response.json({ id: '123', username: 'usuario', followers_count: 177 });
    if (url.pathname.endsWith('/media')) {
      if (init?.method === 'POST') return Response.json({ id: 'container-1' });
      return Response.json({ data: [{ id: 'post-1', media_type: 'IMAGE' }] });
    }
    if (url.pathname.endsWith('/media_publish')) return Response.json({ id: 'published-1' });
    if (url.pathname.endsWith('/container-1')) return Response.json({ id: 'container-1', status_code: 'FINISHED' });
    return Response.json({ access_token: 'long-token', expires_in: 3600 });
  };
  try {
    const profile = await getProfile('fake-token', '123');
    assert.equal(profile.followers_count, 177);
    assert.equal(requests[0].init?.headers && (requests[0].init!.headers as any).Authorization, 'Bearer fake-token');
    const media = await getMedia('fake-token', '123');
    assert.equal(media.data[0].id, 'post-1');
    const published = await publishPhoto('fake-token', '123', 'https://example.com/pic.jpg', 'Exemplo de teste');
    assert.equal(published.id, 'published-1');
    assert.equal(new URLSearchParams(requests[2].init?.body as string).get('image_url'), 'https://example.com/pic.jpg');
    assert.equal(requests[3].url.pathname.endsWith('/container-1'), true);
    assert.equal(requests[4].url.pathname.endsWith('/media_publish'), true);
  } finally { global.fetch = originalFetch; }
});

test('Meta API failure becomes an error rather than a fabricated success', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => Response.json({ error: { message: 'Permissão negada' } }, { status: 403 });
  try { await assert.rejects(getProfile('invalid-token', '123'), /Permissão negada/); }
  finally { global.fetch = originalFetch; }
});


test('unified code exchange uses Facebook Graph and no legacy Instagram exchange', async () => {
  const old = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET,
    redirect: process.env.INSTAGRAM_REDIRECT_URI, config: process.env.INSTAGRAM_CONFIG_ID };
  const originalFetch = global.fetch;
  process.env.INSTAGRAM_APP_ID = '1734982044217816';
  process.env.INSTAGRAM_APP_SECRET = 'test_secret';
  process.env.INSTAGRAM_CONFIG_ID = '2676997126089732';
  process.env.INSTAGRAM_REDIRECT_URI = 'https://example.com/api/instagram/connect/callback';
  const urls: URL[] = [];
  global.fetch = async input => {
    urls.push(new URL(input.toString()));
    return Response.json({ access_token: 'system_user_token' });
  };
  try {
    const response = await exchangeCode('single_use_code');
    assert.equal(response.access_token, 'system_user_token');
    assert.equal(urls.length, 1);
    assert.equal(urls[0].hostname, 'graph.facebook.com');
    assert.ok(urls[0].pathname.endsWith('/oauth/access_token'));
    assert.equal(urls[0].searchParams.get('code'), 'single_use_code');
    assert.equal(urls[0].searchParams.get('client_secret'), 'test_secret');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ INSTAGRAM_APP_ID: old.id,
      INSTAGRAM_APP_SECRET: old.secret, INSTAGRAM_REDIRECT_URI: old.redirect,
      INSTAGRAM_CONFIG_ID: old.config })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('unified token resolves assigned Instagram accounts, rejects empty assignments', async () => {
  const originalFetch = global.fetch;
  const paths: string[] = [];
  global.fetch = async input => {
    const url = new URL(input.toString());
    paths.push(url.pathname);
    if (url.pathname.endsWith('/me/assigned_instagram_accounts'))
      return Response.json({ data: [{ id: '123' }] });
    if (url.pathname.endsWith('/123')) return Response.json({ id: '123', username: 'perfil_teste' });
    throw new Error('Unexpected request');
  };
  try {
    const profiles = await getAssignedInstagramAccounts('system-token');
    assert.equal(profiles[0].username, 'perfil_teste');
    assert.equal(paths.length, 2);
  } finally { global.fetch = originalFetch; }
  global.fetch = async () => Response.json({ data: [] });
  try { await assert.rejects(getAssignedInstagramAccounts('system-token'), /Nenhuma conta Instagram/); }
  finally { global.fetch = originalFetch; }
});

test('publication refuses failed container; never calls media_publish', async () => {
  const originalFetch = global.fetch;
  const paths: string[] = [];
  global.fetch = async (input, init) => {
    const url = new URL(input.toString());
    paths.push(url.pathname);
    if (url.pathname.endsWith('/media') && init?.method === 'POST') return Response.json({ id: 'container-error' });
    if (url.pathname.endsWith('/container-error')) return Response.json({ id: 'container-error', status_code: 'ERROR' });
    throw new Error('Request must not be sent');
  };
  try {
    await assert.rejects(publishPhoto('test-token', '123', 'https://example.org/image.jpg', ''), /Contêiner de mídia: error/);
    assert.equal(paths.some(p => p.endsWith('/media_publish')), false);
  } finally { global.fetch = originalFetch; }
});

