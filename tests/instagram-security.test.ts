import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../lib/encryption';
import { cleanUsername, validateSettings } from '../lib/instagram/validation';
import { getProfile, getMedia, instagramAuthorizationUrl, longLivedToken, exchangeCode, publishPhoto, isPublicImageUrl } from '../lib/instagram/meta';

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

test('authorization requests only explicit professional account scopes', () => {
  const old = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET, redirect: process.env.INSTAGRAM_REDIRECT_URI };
  process.env.INSTAGRAM_APP_ID = 'app123'; process.env.INSTAGRAM_APP_SECRET = 'secret'; process.env.INSTAGRAM_REDIRECT_URI = 'https://example.com/api/instagram/connect/callback';
  const url = new URL(instagramAuthorizationUrl('stateABC'));
  assert.equal(url.hostname, 'www.instagram.com');
  assert.equal(url.searchParams.get('state'), 'stateABC');
  assert.ok(url.searchParams.get('scope')?.includes('instagram_business_basic'));
  if (old.id === undefined) delete process.env.INSTAGRAM_APP_ID; else process.env.INSTAGRAM_APP_ID = old.id;
  if (old.secret === undefined) delete process.env.INSTAGRAM_APP_SECRET; else process.env.INSTAGRAM_APP_SECRET = old.secret;
  if (old.redirect === undefined) delete process.env.INSTAGRAM_REDIRECT_URI; else process.env.INSTAGRAM_REDIRECT_URI = old.redirect;
});

test('live profile / media requests and publishing call official API using mocked network', async () => {
  const originalFetch = global.fetch;
  const requests: { url: URL; init?: RequestInit }[] = [];
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    requests.push({ url, init });
    assert.equal(url.hostname, 'graph.instagram.com');
    if (url.pathname.endsWith('/me')) return Response.json({ id: '123', username: 'usuario', followers_count: 177 });
    if (url.pathname.endsWith('/media')) {
      if (init?.method === 'POST') return Response.json({ id: 'container-1' });
      return Response.json({ data: [{ id: 'post-1', media_type: 'IMAGE' }] });
    }
    if (url.pathname.endsWith('/media_publish')) return Response.json({ id: 'published-1' });
    if (url.pathname.endsWith('/container-1')) return Response.json({ id: 'container-1', status_code: 'FINISHED' });
    return Response.json({ access_token: 'long-token', expires_in: 3600 });
  };
  try {
    const profile = await getProfile('fake-token');
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
  try { await assert.rejects(getProfile('invalid-token'), /Permissão negada/); }
  finally { global.fetch = originalFetch; }
});


test('code exchange and long-lived token use designated Meta hosts, never client JS', async () => {
  const old = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET, redirect: process.env.INSTAGRAM_REDIRECT_URI };
  const originalFetch = global.fetch;
  process.env.INSTAGRAM_APP_ID = 'test_app'; process.env.INSTAGRAM_APP_SECRET = 'test_secret'; process.env.INSTAGRAM_REDIRECT_URI = 'https://example.com/api/instagram/connect/callback';
  const requests: { url: URL; init?: RequestInit }[] = [];
  global.fetch = async (input, init) => {
    requests.push({ url: new URL(input.toString()), init });
    return Response.json({ access_token: 'token_from_meta', expires_in: 12345 });
  };
  try {
    const short = await exchangeCode('once_code');
    const long = await longLivedToken(short.access_token);
    assert.equal(short.access_token, 'token_from_meta');
    assert.equal(long.expires_in, 12345);
    assert.equal(requests[0].url.host, 'api.instagram.com');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(new URLSearchParams(requests[0].init?.body as string).get('client_secret'), 'test_secret');
    assert.equal(requests[1].url.host, 'graph.instagram.com');
  } finally {
    global.fetch = originalFetch;
    if (old.id === undefined) delete process.env.INSTAGRAM_APP_ID; else process.env.INSTAGRAM_APP_ID = old.id;
    if (old.secret === undefined) delete process.env.INSTAGRAM_APP_SECRET; else process.env.INSTAGRAM_APP_SECRET = old.secret;
    if (old.redirect === undefined) delete process.env.INSTAGRAM_REDIRECT_URI; else process.env.INSTAGRAM_REDIRECT_URI = old.redirect;
  }
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
    await assert.rejects(publishPhoto('test-token', 'account-123', 'https://example.org/image.jpg', ''), /contêiner error/);
    assert.equal(paths.some(p => p.endsWith('/media_publish')), false);
  } finally { global.fetch = originalFetch; }
});

