import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScheduledPost } from '../lib/instagram/scheduled-post';

const now = new Date('2026-11-18T18:00:00.000Z');

test('agendamento valida JPEG HTTPS, legenda e dia de publicação', () => {
  const draft = validateScheduledPost(
    { imageUrl: 'https://static.example.com/foto.jpeg?key=public', caption: 'Exemplo', day: '2026-11-20' },
    now,
  );
  assert.equal(draft.scheduledFor.toISOString(), '2026-11-20T12:00:00.000Z');
  assert.equal(draft.caption, 'Exemplo');
  for (const bad of [
    { imageUrl: 'http://example.com/pic.jpg', caption: '', day: '2026-11-20' },
    { imageUrl: 'https://example.com/pic.png', caption: '', day: '2026-11-20' },
    { imageUrl: 'https://example.com/pic.jpg', caption: 'X'.repeat(2201), day: '2026-11-20' },
    { imageUrl: 'https://example.com/pic.jpg', caption: '', day: '2026-02-31' },
    { imageUrl: 'https://example.com/pic.jpg', caption: '', day: '2026-11-18' },
    { imageUrl: 'https://example.com/pic.jpg', caption: '', day: '2027-11-20' },
  ]) assert.throws(() => validateScheduledPost(bad, now));
});

test('fila tem isolamento por usuário, cancelamento e execução protegida e sem retry', () => {
  const create = readFileSync('app/api/instagram-accounts/[id]/scheduled-posts/route.ts', 'utf8');
  const cancel = readFileSync('app/api/instagram-accounts/[id]/scheduled-posts/[postId]/route.ts', 'utf8');
  const cron = readFileSync('app/api/cron/publish-scheduled/route.ts', 'utf8');
  const worker = readFileSync('lib/instagram/scheduled-publisher.ts', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(create, /where: \{ id, userId \}/);
  assert.match(create, /DECOLAINSTA_AUTO_PUBLISH_ENABLED/);
  assert.match(cancel, /instagramAccountId: id, status: 'queued'/);
  assert.match(cron, /timingSafeEqual/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /DECOLAINSTA_AUTO_PUBLISH_ENABLED/);
  assert.match(worker, /updateMany\(/);
  assert.match(worker, /status: 'needs_review'/);
  assert.match(worker, /publishPhoto\(/);
  assert.doesNotMatch(worker, /processFollowsForAccount|processUnfollowsForAccount/);
  assert.match(schema, /model ScheduledInstagramPost/);
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(config.crons.map((job: { path: string; schedule: string }) => job.path).sort(), [
    '/api/cron/publish-scheduled', '/api/cron/sync-insights',
  ]);
  assert.ok(config.crons.every((job: { schedule: string }) => job.schedule === '0 12 * * *'));
});
