import assert from 'node:assert/strict';
import { test } from 'node:test';
import { phantomBusterRequestHeaders } from '../lib/providers/phantombuster-request-headers';

test('only a numeric server-approved workspace id is passed in provider header', () => {
  assert.deepEqual(phantomBusterRequestHeaders('key','8394007372125782'), {
    Accept:'application/json',
    'X-Phantombuster-Key':'key',
    'X-Phantombuster-Org':'8394007372125782',
  });
  for (const invalid of [
    '', 'not-an-org', '123',
    '8394007372125782\r\nX-Forwarded-For: evil',
    '8394007372125782/other',
  ]) {
    const headers=phantomBusterRequestHeaders('key',invalid);
    assert.equal(headers['X-Phantombuster-Org'],undefined);
  }
  assert.equal(phantomBusterRequestHeaders('key',undefined)['X-Phantombuster-Key'],'key');
});

test('workspace, collector discovery and completed-result reader use same server-only scope', async () => {
  const { readFileSync } = await import('node:fs');
  for(const file of [
    'lib/providers/phantombuster.ts',
    'lib/providers/phantombuster-audience.ts',
    'lib/providers/phantombuster-collector-discovery.ts',
    'lib/providers/phantombuster-collector-identity.ts',
  ]) {
    const source=readFileSync(file,'utf8');
    assert.match(source,/phantomBusterRequestHeaders\(apiKey\)/);
    assert.doesNotMatch(source,/headers:\s*\{\s*Accept: 'application\/json', 'X-Phantombuster-Key': apiKey\s*\}/);
  }
});
