import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('references dashboard displays real Meta followers and unverified candidates separately',()=>{
  const ui=readFileSync('app/(app)/references/_components/simple-references-panel.tsx','utf8');
  const dto=readFileSync('lib/instagram/accounts.ts','utf8');
  assert.match(ui,/profileFollowersCount\?: number \| null/);
  assert.match(ui,/const selectedAccount = accounts\.find\(item => item\.id === accountId\)/);
  assert.match(ui,/selectedAccount\?\.connected && <Card>/);
  assert.match(ui,/Seguidores reais \(última leitura Meta\)/);
  assert.match(ui,/selectedAccount\.profileFollowersCount \?\? '—'/);
  assert.match(ui,/Nomes salvos \(não verificados\)/);
  assert.match(ui,/Nomes coletados são candidatos, não seguidores conquistados/);
  assert.match(ui,/selectedAccount\.lastSyncedAt/);
  assert.match(dto,/connected: Boolean\(encryptedAccessToken && account\.instagramUserId\)/);
  assert.doesNotMatch(ui,/automatedFollow|api\/operator\/social-pilot.*launch-one-follow/);
});
