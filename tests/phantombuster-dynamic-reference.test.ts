import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  dynamicReferenceLaunchPayload,launchExistingCollectorForReference,
  inspectDynamicCollectorTemplate,
} from '../lib/providers/phantombuster-dynamic-reference';
import {
  makeDynamicJobEvent,parseDynamicJobEvent,planDynamicReferenceQueue,
} from '../lib/reference-dynamic-collection';

const id='1111111111111111';
const claimId='a789b196-a830-4a44-93ca-9d2f53b0f772';
test('dynamic input overrides one reference without changing agent URL or session',()=>{
  const value=dynamicReferenceLaunchPayload(id,'uber',claimId);
  assert.deepEqual(value,{
    id,bonusArgument:{spreadsheetUrl:'https://www.instagram.com/uber/'},
    saveArgument:false,manualLaunch:true,maxInstanceCount:1,
    userCustomMetadata:{decolainstaClaimId:claimId},
  });
  assert.equal(dynamicReferenceLaunchPayload(id,'https://instagram.com/uber',claimId),null);
  assert.equal(dynamicReferenceLaunchPayload(id,'../uber',claimId),null);
  assert.equal(dynamicReferenceLaunchPayload('bad', 'uber', claimId),null);
  assert.doesNotMatch(JSON.stringify(value),/sessionCookie|SECRET|password|proxy/);
});
test('PhantomBuster launches use one-time bonusArgument and do not save settings',async()=>{
  let calls=0;
  const result=await launchExistingCollectorForReference('SECRET_API_KEY',id,'uber',claimId,
    async(url,init)=>{
      calls++;
      assert.equal(url,'https://api.phantombuster.com/api/v2/agents/launch');
      assert.equal(init?.method,'POST');
      assert.equal(init?.credentials,'omit');
      const body=JSON.parse(String(init?.body));
      assert.equal(body.bonusArgument.spreadsheetUrl,'https://www.instagram.com/uber/');
      assert.equal(body.saveArgument,false);
      assert.equal(body.maxInstanceCount,1);
      assert.deepEqual(Object.keys(body).sort(),
        ['bonusArgument','id','manualLaunch','maxInstanceCount','saveArgument','userCustomMetadata'].sort());
      assert.equal((init?.headers as Record<string,string>)['X-Phantombuster-Key'],'SECRET_API_KEY');
      return Response.json({data:{containerId:'2222222222222222'}});
    });
  assert.equal(calls,1);
  assert.deepEqual(result,{status:'queued',containerId:'2222222222222222'});
  assert.doesNotMatch(JSON.stringify(result),/SECRET|spreadsheetUrl|password/);
});
test('uncertain launch responses never authorize automatic repeat',async()=>{
  const unavailable=await launchExistingCollectorForReference('key',id,'uber',claimId,
    async()=>{throw new Error('connection lost after sending request');});
  assert.deepEqual(unavailable,{status:'unconfirmed',containerId:null});
  const ambiguous=await launchExistingCollectorForReference('key',id,'uber',claimId,
    async()=>Response.json({success:true}));
  assert.deepEqual(ambiguous,{status:'unconfirmed',containerId:null});
});
test('existing agent inspected without returning saved cookie',async()=>{
  const check=await inspectDynamicCollectorTemplate('key',id,async(url,init)=>{
    assert.match(url,/agents\/fetch/);
    assert.equal(init?.method,'GET');
    return Response.json({data:{id,script:'Instagram Follower Collector.js',
      argument:JSON.stringify({spreadsheetUrl:'https://instagram.com/mameto_lueji/',
        sessionCookie:'SENSITIVE_IG_SESSION'})}});
  });
  assert.equal(check,'ready');
});
test('queue selects only saved references and never retries attempted reference',()=>{
  const refs=[{id:'r1',username:'uber'},{id:'r2',username:'ammplamob'}];
  const base={accountId:'account_a',referenceId:'r1',
    referenceUsername:'uber',agentId:id,claimId,containerId:null};
  const claimed=makeDynamicJobEvent({...base,state:'claimed'});
  assert.ok(claimed);
  assert.deepEqual(parseDynamicJobEvent(JSON.stringify(claimed)),claimed);
  assert.equal(planDynamicReferenceQueue(refs,[claimed!],id).unresolved,true);
  assert.equal(planDynamicReferenceQueue(refs,[claimed!],id).next,null);
  const finished=makeDynamicJobEvent({...base,state:'finished'});
  assert.deepEqual(planDynamicReferenceQueue(refs,[finished!],id).next,
    {id:'r2',username:'ammplamob'});
  assert.equal(parseDynamicJobEvent(JSON.stringify({...finished,state:'unknown'})),null);
  assert.equal(parseDynamicJobEvent(JSON.stringify({...finished,sessionCookie:'s'})),null);
});
test('dynamic controller is preview gated, operator only, idempotent and account isolated',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(src,/process\.env\.VERCEL_ENV!=='preview'/);
  assert.match(src,/user\?\.role!=='admin'/);
  assert.match(src,/request\.headers\.get\('origin'\)/);
  assert.match(src,/PHANTOMBUSTER_DYNAMIC_COLLECTION_ENABLED!=='yes'/);
  assert.match(src,/instagramAccountId:accountId/);
  assert.match(src,/pg_try_advisory_xact_lock/);
  assert.match(src,/\$queryRaw<Array<\{acquired:boolean\}>>/);
  assert.match(src,/lockRows\[0\]\.acquired!==true/);
  assert.doesNotMatch(src,/\$queryRawUnsafe\(/);
  assert.match(src,/P2010/);
  assert.match(src,/P2034/);
  assert.match(src,/P2028/);
  assert.doesNotMatch(src,/return bad\('Conflito na reserva',503\)/);
  assert.match(src,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(src,/event&&event.accountId!==accountId/);
  assert.match(src,/state:'claimed'/);
  assert.match(src,/launchExistingCollectorForReference/);
  assert.match(src,/noAutomaticRetry/);
  assert.doesNotMatch(src,/followSingle|unfollowSingle|InstagramFollowersAutoFollow|agents\/save/);
});

test('verified dynamic container finalizes snapshots AND candidate index atomically',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(src,/indexSavedAudienceCandidates\(tx,event\.accountId\)/);
  assert.match(src,/candidatesIndexed:stored\.indexed/);
  assert.match(src,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.doesNotMatch(ui,/operation:'sync-saved-history'/);
  assert.match(ui,/queue\.currentState==='launched'/);
  assert.match(ui,/queue\.currentState==='finished-unverified'/);
  assert.match(ui,/resumedExisting\.current=true/);
});

test('dynamic completed snapshots are indexed once, in the owning tenant, without follows',async()=>{
  const {makeAudienceSnapshot,AUDIENCE_HISTORY_ACTION}=await import('../lib/reference-audience-history');
  const {AUDIENCE_CANDIDATE_ACTION,parseCandidateEvidence}=await import('../lib/reference-candidate-queue');
  const {indexSavedAudienceCandidates}=await import('../lib/server/dynamic-reference-candidate-index');
  const accountId='account_test',refId='reference_test';
  const snapshot=makeAudienceSnapshot(refId,'ammplamob',id,
    ['alice_valid','excluded_name','apoistecnologia'],'completed_run');
  assert.ok(snapshot);
  const created: Array<{instagramAccountId:string;action:string;targetUsername:string;details:string}> = [];
  const tx={
    instagramAccount:{findUnique:async(input:{where:{id:string}})=>{
      assert.equal(input.where.id,accountId);return {username:'apoistecnologia'};
    }},
    targetAccount:{findMany:async(input:{where:{instagramAccountId:string}})=>{
      assert.equal(input.where.instagramAccountId,accountId);
      return [{id:refId,username:'ammplamob'}];
    }},
    activityLog:{
      findMany:async(input:{where:{instagramAccountId:string;action:string}})=>{
        assert.equal(input.where.instagramAccountId,accountId);
        if(input.where.action===AUDIENCE_HISTORY_ACTION)
          return [{id:'snapshot_test',targetUsername:'ammplamob',
            details:JSON.stringify(snapshot),createdAt:new Date('2026-11-21T14:00:00Z')}];
        assert.equal(input.where.action,AUDIENCE_CANDIDATE_ACTION);
        return created.map(x=>({targetUsername:x.targetUsername,details:x.details}));
      },
      createMany:async(input:{data:typeof created})=>{
        for(const row of input.data){
          assert.equal(row.instagramAccountId,accountId);
          assert.equal(row.action,AUDIENCE_CANDIDATE_ACTION);
          created.push(row);
        }
        return {count:input.data.length};
      },
    },
    whitelist:{findMany:async()=>[{username:'excluded_name'}]},
    followAction:{findMany:async()=>[]},
  } as unknown as Parameters<typeof indexSavedAudienceCandidates>[0];
  assert.deepEqual(await indexSavedAudienceCandidates(tx,accountId),{indexed:1});
  assert.equal(created.length,1);
  assert.equal(created[0].targetUsername,'alice_valid');
  assert.equal(parseCandidateEvidence(created[0].details)?.actionsEnabled,false);
  assert.deepEqual(await indexSavedAudienceCandidates(tx,accountId),{indexed:0});
  assert.equal(created.length,1);
});

test('missing agentId in container detail reconciles against agent history with GET only',async()=>{
  const {inspectDynamicRunProof}=await import('../lib/providers/phantombuster-dynamic-reference');
  const urls:string[]=[];
  const fake=async(url:string,init?:RequestInit)=>{
    urls.push(url); assert.equal(init?.method,'GET');
    if(url.includes('/containers/fetch-all')){
      assert.equal(new URL(url).searchParams.get('agentId'),id);
      return Response.json({containers:[{id:'2222222222222222'}]});
    }
    assert.equal(new URL(url).searchParams.get('id'),'2222222222222222');
    return Response.json({id:'2222222222222222',status:'finished',
      endedAt:'2026-11-21T13:00:00Z',exitCode:0,
      userCustomMetadata:{decolainstaClaimId:claimId},
      argument:JSON.stringify({spreadsheetUrl:'https://www.instagram.com/uber/'})});
  };
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',claimId,fake),
    'verified-finished');
  assert.equal(urls.length,2);
  assert.ok(urls.every(x=>x.startsWith('https://api.phantombuster.com/api/v2/containers/')));
});

test('missing metadata relies on recorded launch receipt; failed run or wrong agent remains blocked',async()=>{
  const {inspectDynamicRunProof}=await import('../lib/providers/phantombuster-dynamic-reference');
  const base=async(url:string)=>url.includes('fetch-all')
    ?Response.json({containers:[{id:'2222222222222222'}]})
    :Response.json({id:'2222222222222222',status:'finished',
      endedAt:'2026-11-21T13:00:00Z',exitCode:0});
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',claimId,base),
    'verified-finished');
  const mismatch=async(url:string)=>url.includes('fetch-all')
    ?Response.json({containers:[{id:'3333333333333333'}]})
    :Response.json({id:'2222222222222222',status:'finished',
      endedAt:'2026-11-21T13:00:00Z',exitCode:0});
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',claimId,mismatch),
    'unavailable');
  const fail=async()=>Response.json({id:'2222222222222222',agentId:id,
    status:'failed',exitCode:1,endedAt:'2026-11-21T13:00:00Z'});
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',claimId,fail),
    'finished-unverified');
});
test('the persisted launched receipt bypasses mutable template discovery for progress only',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  assert.match(src,/existingLaunchedAgent\(accountId\)/);
  assert.match(src,/agentForReconciliation\(key!,accountId\)/);
  assert.match(src,/activeContainerStatus:activeProof\?\.status/);
  assert.match(src,/providerStatus:proof\.status,providerReason:proof\.reason/);
});

test('metadata omission may use trusted backend launch receipt, but explicit mismatch blocks',async()=>{
  const {inspectDynamicRunProof}=await import('../lib/providers/phantombuster-dynamic-reference');
  const basic={id:'2222222222222222',agentId:id,status:'finished',
    endedAt:'2026-11-21T13:00:00Z',exitCode:0};
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',
    claimId,async()=>Response.json(basic)),'verified-finished');
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',
    claimId,async()=>Response.json({...basic,userCustomMetadata:{decolainstaClaimId:'another-claim'}})),
    'finished-unverified');
  assert.equal(await inspectDynamicRunProof('key',id,'2222222222222222','uber',
    claimId,async()=>Response.json({...basic,argument:{spreadsheetUrl:'https://instagram.com/other/'}})),
    'finished-unverified');
});
test('finished-unverified receipt is checked again without re-launching other references',()=>{
  const src=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(src,/event\?\.state==='finished-unverified'/);
  assert.match(src,/event\.state==='launched'/);
  assert.match(src,/state:'finished'/);
  assert.match(ui,/queue\.currentState==='finished-unverified'/);
  assert.match(src,/event\.containerId,event\.referenceUsername/);
});

test('safe diagnostic distinguishes claim, reference and execution failures',async()=>{
  const {inspectDynamicRunProofDetailed}=await import('../lib/providers/phantombuster-dynamic-reference');
  const base={id:'2222222222222222',agentId:id,status:'finalized',
    endedAt:'2026-11-21T13:00:00Z',exitCode:0};
  const cases=[
    [{...base,userCustomMetadata:{}},'missing-claim'],
    [{...base,userCustomMetadata:{decolainstaClaimId:'not-this-claim'}},'wrong-claim'],
    [{...base,argument:{spreadsheetUrl:'https://instagram.com/other/'}},'wrong-reference'],
    [{...base,exitCode:1},'failed-run'],
    [{...base,endedAt:null},'missing-completion-time'],
  ] as const;
  for(const [input,reason] of cases){
    const result=await inspectDynamicRunProofDetailed('key',id,'2222222222222222',
      'uber',claimId,async()=>Response.json({data:input}));
    assert.equal(result.status,'finished-unverified');
    assert.equal(result.reason,reason);
    assert.doesNotMatch(JSON.stringify(result),/instagram\.com|claimId|sessionCookie|apiKey/);
  }
});
test('read-only review keeps next ref hidden and labels button for existing container',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const ui=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/nextReference:ownLaunched\?null:/);
  assert.match(route,/activeContainerReason:activeProof\?\.reason/);
  assert.match(route,/providerReason:proof\.reason/);
  assert.match(ui,/Rever contêiner existente/);
  assert.match(ui,/Diagnóstico:/);
});

test('failed receipt offers one explicit retry of SAME reference only, never auto next',async()=>{
  const {planFailedDynamicReferenceRetry}=await import('../lib/reference-dynamic-collection');
  const references=[{id:'reference1',username:'ammplamob'},
    {id:'reference2',username:'prefeituradepetrolina'}];
  const initial=makeDynamicJobEvent({state:'finished-unverified',
    accountId:'account1',referenceId:'reference1',referenceUsername:'ammplamob',
    agentId:id,claimId,containerId:'2222222222222222'});
  assert.ok(initial);
  assert.deepEqual(planFailedDynamicReferenceRetry(references,[initial!],'account1',id),
    references[0]);
  assert.equal(planFailedDynamicReferenceRetry(references,[initial!],'otherAccount',id),null);
  const retry=makeDynamicJobEvent({...initial!,state:'claimed',claimId:'b789b196-a830-4a44-93ca-9d2f53b0f772',containerId:null});
  assert.ok(retry);
  assert.equal(planFailedDynamicReferenceRetry(references,[retry!,initial!],'account1',id),null);
  const fail2=makeDynamicJobEvent({...retry!,state:'finished-unverified',containerId:'3333333333333333'});
  assert.equal(planFailedDynamicReferenceRetry(references,[fail2!,initial!],'account1',id),null);
  assert.equal(planFailedDynamicReferenceRetry(references,[initial!], 'account1','2222222222222222'),null);
});
test('failed-run retry is preview-only and reserved with serializable advisory lock',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const panel=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/body\.operation==='retry-failed'/);
  assert.match(route,/inspectFailedRetryPreflight/);
  assert.match(route,/planFailedDynamicReferenceRetry/);
  assert.match(route,/const configured=await agent\(key!\)/);
  assert.match(route,/rows\[0\]\.details!==receipt\.details/);
  assert.match(route,/pg_try_advisory_xact_lock/);
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(panel,/advance\('retry-failed'\)/);
  assert.match(panel,/disabled=\{running\}/);
  assert.doesNotMatch(route,/followSingle|unfollowSingle|InstagramFollowersAutoFollow|agents\/save/);
});

test('successful retry resolves old unverified count without deleting audit event',()=>{
  const refs=[{id:'reference_one',username:'ammplamob'},{id:'reference_two',username:'prefeituradepetrolina'}];
  const failed=makeDynamicJobEvent({state:'finished-unverified',
    accountId:'account_one',referenceId:'reference_one',
    referenceUsername:'ammplamob',agentId:id,claimId,
    containerId:'2222222222222222'});
  const success=makeDynamicJobEvent({state:'finished',
    accountId:'account_one',referenceId:'reference_one',
    referenceUsername:'ammplamob',agentId:id,
    claimId:'b789b196-a830-4a44-93ca-9d2f53b0f772',
    containerId:'3333333333333333'});
  assert.ok(failed&&success);
  assert.equal(planDynamicReferenceQueue(refs,[failed!],id).attributionUnverified,1);
  const after=planDynamicReferenceQueue(refs,[success!,failed!],id);
  assert.equal(after.attributionUnverified,0);
  assert.equal(after.completed,1);
  assert.equal(after.attempted,1);
  assert.deepEqual(after.next,{id:'reference_two',username:'prefeituradepetrolina'});
});
test('rate limiting pauses browser polling, not the manual same-container query',()=>{
  const route=readFileSync('app/api/operator/phantombuster/dynamic-references/route.ts','utf8');
  const panel=readFileSync('app/(app)/references/_components/dynamic-collector-control.tsx','utf8');
  assert.match(route,/collectionLimited=Boolean\(ownLaunched&&/);
  assert.match(route,/failureDiagnostic==='platform-limited'/);
  assert.match(route,/failureDiagnostic,collectionLimited,canAdvance/);
  assert.match(panel,/if\(running&&queue\?\.collectionLimited\)/);
  assert.match(panel,/!queue.collectionLimited&&/);
  assert.match(panel,/Consultar resultado existente/);
  assert.doesNotMatch(panel,/followSingle|unfollowSingle|agents\/launch/);
});
