import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeUnfollowScheduledAt } from '../lib/worker/unfollow-schedule';

test('one day is exactly 24 hours even across clock changes', () => {
  const start = new Date('2026-10-31T15:45:00.000Z');
  assert.equal(computeUnfollowScheduledAt(start, 1).toISOString(), '2026-11-01T15:45:00.000Z');
});

test('three days means 72 hours from simulated follow time', () => {
  const start = new Date('2026-11-18T12:34:56.000Z');
  assert.equal(computeUnfollowScheduledAt(start, 3).toISOString(), '2026-11-21T12:34:56.000Z');
});

test('invalid retention times and dates fail closed', () => {
  assert.throws(() => computeUnfollowScheduledAt(new Date('bad'), 3), /Data/);
  for (const days of [0, -1, 1.5, 366, NaN, Infinity]) {
    assert.throws(() => computeUnfollowScheduledAt(new Date(), days), /Prazo/);
  }
});

test('demo unfollow queue excludes records imported from real actions', () => {
  const source = readFileSync(join(process.cwd(), 'lib/worker/engine.ts'), 'utf8');
  const query = source.match(/const dueForUnfollow = await prisma\.followAction\.findMany\(\{\s*where:\s*\{([\s\S]*?)\},\s*take:/)?.[1];
  assert.ok(query, 'due-for-unfollow query must exist');
  assert.match(query, /isDryRun:\s*true/);
  assert.match(query, /unfollowedAt:\s*null/);
  assert.match(query, /unfollowScheduledAt:\s*\{\s*lte:\s*now/);
});

test('demo unfollow obeys operating hours and remaining daily quota', () => {
  const source = readFileSync(join(process.cwd(), 'lib/worker/engine.ts'), 'utf8');
  const fn = source.split('export async function processUnfollowsForAccount')[1].split('export async function runEngineTick')[0];
  assert.match(fn, /isWithinOperatingHours\(accountId\)/);
  assert.match(fn, /calendarDayKey\(now, timeZone\)/);
  assert.match(fn, /take:\s*Math\.min\(2, limits\.maxUnfollows - account\.unfollowsToday\)/);
});
