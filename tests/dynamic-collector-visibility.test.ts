import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';

test('connected Instagram account detail shows collector control in references tab',()=>{
 const page=readFileSync('app/(app)/accounts/[id]/_components/account-detail.tsx','utf8');
 assert.match(page,/TabsContent value="targets"/);
 assert.match(page,/account.connected && <DynamicCollectorControl accountId=\{account.id\}/);
});
test('reference collection shows backend errors rather than disappearing',()=>{
 const code=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
 assert.match(code,/const \[diagnostic,setDiagnostic\]/);
 assert.match(code,/detail\[response.status\]/);
 assert.match(code,/setDiagnostic\(result.diagnostic\)/);
 assert.match(code,/role="status"/);
 assert.match(code,/\{diagnostic\}/);
 assert.doesNotMatch(code,/if\(!queue\)return null/);
 assert.match(code,/queue \? <>/);
});
