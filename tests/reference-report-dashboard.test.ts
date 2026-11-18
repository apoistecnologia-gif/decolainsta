import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReferenceAggregate } from '../lib/reference-report';

const fixture = {
  format: 'decolainsta-reference-aggregate-v1',
  reference: 'mameto_lueji',
  generatedAt: '2026-11-18T16:20:00.000Z',
  source: 'manual_lab_aggregate',
  verifiedFollowerList: false,
  followbackVerified: false,
  summary: {
    inspections: 3, distinctObserved: 6, manuallyReported: 5,
    repeatedSeen: 4, lastSeen: '2026-11-18T16:14:12.783Z',
  },
  visits: [{
    observedAt: '2026-11-18T16:14:12.783Z',
    source: 'manually_opened_dialog_user_confirmed',
    sampleSize: 5, uniqueNew: 1, repeated: 4, crossReferenceOverlap: 0,
  }],
};

test('formato agregado conserva números verificados sem afirmar lista completa', () => {
  const report = parseReferenceAggregate(JSON.stringify(fixture));
  assert.equal(report.reference, 'mameto_lueji');
  assert.equal(report.summary.distinctObserved, 6);
  assert.equal(report.summary.repeatedSeen, 4);
  assert.equal(report.verifiedFollowerList, false);
  assert.equal(report.followbackVerified, false);
});

test('importação bloqueia campos de pessoas, fingerprints e payloads alheios', () => {
  const bad = [
    { ...fixture, users: ['pessoa'] },
    { ...fixture, sessionid: 'cookie' },
    { ...fixture, summary: { ...fixture.summary, fingerprints: ['abc'] } },
    { ...fixture, visits: [{ ...fixture.visits[0], username: 'pessoa' }] },
    { ...fixture, source: 'instagram_official' },
    { ...fixture, verifiedFollowerList: true },
    { ...fixture, summary: { ...fixture.summary, distinctObserved: -1 } },
    { ...fixture, reference: 'https://instagram.com/abc' },
  ];
  for (const item of bad) assert.throws(() => parseReferenceAggregate(JSON.stringify(item)));
  assert.throws(() => parseReferenceAggregate('bad'));
  assert.throws(() => parseReferenceAggregate('x'.repeat(60_000)));
});

test('painel usa leitura local sem upload ao servidor e mostra revisão 24/72h', () => {
  const page = readFileSync('app/(app)/references/_components/reference-history-panel.tsx', 'utf8');
  const menu = readFileSync('app/(app)/_components/app-sidebar.tsx', 'utf8');
  assert.match(menu, /href: '\/references'/);
  assert.match(page, /parseReferenceAggregate\(await file\.text\(\)\)/);
  assert.match(page, /setReviewHours/);
  assert.match(page, /<option value=\{24\}>24 horas/);
  assert.match(page, /<option value=\{72\}>3 dias/);
  assert.match(page, /npm run review --/);
  assert.doesNotMatch(page, /fetch\(|localStorage|XMLHttpRequest|indexedDB/);
});

test('exportação apenas com contadores e verificações, sem fingerprints', () => {
  const cli = readFileSync('labs/instagram-local/references-cli.mjs','utf8');
  assert.match(cli, /command === 'export-report'/);
  assert.match(cli, /format: 'decolainsta-reference-aggregate-v1'/);
  assert.match(cli, /const payload/);
  assert.match(cli, /getReferenceHistoryReport\(username\)/);
  assert.match(cli, /visits: visits\.map/);
  assert.match(cli, /Nenhum/); // unrelated action messages
});
