import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  inspectDynamicRunProof,readDynamicContainerResults,
} from '../lib/providers/phantombuster-dynamic-reference';

const agentId='1111111111111111';
const containerId='2222222222222222';
const claimId='a789b196-a830-4a44-93ca-9d2f53b0f772';
const good={
  id:containerId,agentId,status:'finalized',
  endedAt:'2026-11-21T03:20:00.000Z',
  userCustomMetadata:{decolainstaClaimId:claimId},
  argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/uber/',
    sessionCookie:'SECRET_DO_NOT_RETURN'}),
};
test('verified container binds source reference and durable claim, not editable agent settings',async()=>{
  let count=0;
  const got=await inspectDynamicRunProof('SENSITIVE_KEY',agentId,containerId,
    'uber',claimId,async(url,init)=>{
      count++;
      assert.equal(new URL(url).pathname,'/api/v2/containers/fetch');
      assert.equal(new URL(url).searchParams.get('id'),containerId);
      assert.equal(init?.method,'GET');
      return Response.json({data:good});
    });
  assert.equal(count,1);
  assert.equal(got,'verified-finished');
});
test('different tenant claim, different input, unfinished container never import',async()=>{
  const mutate=[
    [{...good,userCustomMetadata:{}},'finished-unverified'],
    [{...good,userCustomMetadata:{decolainstaClaimId:'wrong'}},'finished-unverified'],
    [{...good,argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/mameto_lueji/'})},'finished-unverified'],
    [{...good,exitCode:1},'finished-unverified'],
    [{...good,status:'running',endedAt:null},'running'],
    [{...good,id:'3333333333333333'},'unavailable'],
    [{...good,agentId:'3333333333333333'},'unavailable'],
  ] as const;
  for(const [data,wanted] of mutate){
    const result=await inspectDynamicRunProof('key',agentId,containerId,
      'uber',claimId,async()=>Response.json({data}));
    assert.equal(result,wanted);
  }
});
test('only exact container resultObject can supply up to 250 candidate usernames',async()=>{
  let calls=0;
  const output=await readDynamicContainerResults('SECRET_KEY',containerId,'uber',
    async(url,init)=>{
      calls++;
      assert.equal(new URL(url).pathname,'/api/v2/containers/fetch-result-object');
      assert.equal(new URL(url).searchParams.get('id'),containerId);
      assert.equal(init?.method,'GET');
      assert.equal(init?.redirect,'error');
      return Response.json({data:{resultObject:[
        {username:'test.one',sessionCookie:'SECRET_PRIVATE'},
        {profileUrl:'https://www.instagram.com/test.two/'},
        {username:'test.one'},
        {username:'uber'},
        {profileUrl:'https://attacker.example/inject/'},
        {username:'../escape'},
      ]}});
    });
  assert.equal(calls,1);
  assert.deepEqual(output,{status:'found',usernames:['test.one','test.two']});
  assert.doesNotMatch(JSON.stringify(output),/SECRET|sessionCookie|attacker|escape/);
});
test('no resultObject or broken response fails without using latest agent file',async()=>{
  const unknown=await readDynamicContainerResults('key',containerId,'uber',
    async()=>Response.json({data:{success:true}}));
  assert.equal(unknown.status,'unsupported');
  const empty=await readDynamicContainerResults('key',containerId,'uber',
    async()=>Response.json({data:{resultObject:[]}}));
  assert.deepEqual(empty,{status:'empty',usernames:[]});
});
test('controller never imports unless run metadata matches claim and exact container results',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(src,/inspectDynamicRunProof/);
  assert.match(src,/proof\.status!=='verified-finished'/);
  assert.match(src,/readDynamicContainerResults/);
  assert.match(src,/makeAudienceSnapshot/);
  assert.match(src,/MAX_HISTORY_BATCHES/);
  assert.match(src,/isolationLevel:Prisma.TransactionIsolationLevel.Serializable/);
  assert.match(src,/event&&event.accountId!==accountId/);
  assert.match(src,/status:'finished-without-input-proof'/);
  assert.doesNotMatch(src,/agents\/save|user_follow|user_unfollow|unfollowSingle/);
});

test('finished launch waits briefly for its exact result object without restarting the agent',async()=>{
  const {withinDynamicResultGracePeriod}=await import('../lib/reference-dynamic-collection');
  const now=new Date('2026-11-21T17:50:00Z');
  assert.equal(withinDynamicResultGracePeriod(new Date('2026-11-21T17:49:00Z'),now),true);
  assert.equal(withinDynamicResultGracePeriod(new Date('2026-11-21T17:35:00Z'),now),true);
  assert.equal(withinDynamicResultGracePeriod(new Date('2026-11-21T17:34:59Z'),now),false);
  assert.equal(withinDynamicResultGracePeriod(new Date('2026-11-21T17:50:01Z'),now),false);
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/withinDynamicResultGracePeriod\(last\.createdAt\)/);
  assert.match(route,/providerStatus:'awaiting-results',providerReason:'results-pending'/);
  assert.match(route,/noDuplicateLaunch:true/);
  assert.match(ui,/'results-pending':/);
});

test('fallback uses documented withResultObject on SAME container, never agent files',async()=>{
  const urls:string[]=[];
  const result=await readDynamicContainerResults('KEY',containerId,'prefeituradepetrolina',
    async(url,init)=>{
      urls.push(url);
      assert.equal(init?.method,'GET');
      if(url.includes('fetch-result-object'))
        return Response.json({data:{success:true}});
      assert.equal(new URL(url).pathname,'/api/v2/containers/fetch');
      assert.equal(new URL(url).searchParams.get('id'),containerId);
      assert.equal(new URL(url).searchParams.get('withResultObject'),'true');
      return Response.json({data:{id:containerId,resultObject:{
        followers:[{username:'person.one'},{profileUrl:'https://instagram.com/person.two/'}]
      }}});
    });
  assert.equal(urls.length,2);
  assert.ok(urls.every(x=>x.includes('/containers/')));
  assert.deepEqual(result,{status:'found',usernames:['person.one','person.two']});
});
test('fallback rejects result from a DIFFERENT container, preserving earlier run data',async()=>{
  const result=await readDynamicContainerResults('KEY',containerId,'prefeituradepetrolina',
    async(url)=>url.includes('fetch-result-object')
      ?Response.json({data:{success:true}})
      :Response.json({data:{id:'9999999999999999',resultObject:[{username:'wrong_run'}]}}));
  assert.deepEqual(result,{status:'unsupported',usernames:[]});
});
test('file-reference-only or unknown nonempty object never counts as empty success',async()=>{
  const result=await readDynamicContainerResults('KEY',containerId,'prefeituradepetrolina',
    async()=>Response.json({data:{resultObject:[{downloadUrl:'https://example.com/result.csv'}]}}));
  assert.deepEqual(result,{status:'unsupported',usernames:[]});
  const source=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(source,/failureDiagnostic=await inspectDynamicFailureOutput/);
  assert.match(source,/resultStatus:result\.status,failureDiagnostic/);
  assert.match(ui,/info\.status==='import-unavailable'/);
});
