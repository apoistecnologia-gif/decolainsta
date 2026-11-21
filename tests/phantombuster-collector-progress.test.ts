import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  inspectExistingReferenceCollector, classifyCollectorContainers,
} from '../lib/providers/phantombuster-collector-progress';

const agentId='1111111111111111';
const collector=(reference:string)=>({
  id:agentId,script:'Instagram Follower Collector.js',
  argument:JSON.stringify({
    spreadsheetUrl:'https://www.instagram.com/'+reference+'/',
    sessionCookie:'NEVER_PRINT_SESSION',
  }),
});
function mockedProvider(status='running') {
  const requests:string[]=[];
  return {
    requests,
    fetcher: async (url:string,init?:RequestInit):Promise<Response> => {
      requests.push(url);
      assert.equal(init?.method,'GET');
      assert.equal(init?.cache,'no-store');
      assert.equal(init?.redirect,'error');
      assert.equal(init?.credentials,'omit');
      if(url.includes('/agents/fetch-all'))
        return Response.json({data:[collector('mameto_lueji')]});
      if(url.includes('/containers/fetch-all')){
        const u=new URL(url);
        assert.equal(u.searchParams.get('agentId'),agentId);
        assert.equal(u.searchParams.get('mode'),'all');
        assert.equal(u.searchParams.get('limit'),'5');
        assert.equal(u.searchParams.get('withRuntimeEvents'),'false');
        return Response.json({data:[{
          id:'2222222222222222',agentId,status,
          startedAt:'2026-11-21T03:11:00Z',
          argument:'TOP_SECRET_SESSION_COOKIE',
          ...(status==='finished'?{endedAt:'2026-11-21T03:12:00Z'}:{}),
        }]});
      }
      throw new Error('Unexpected provider request');
    },
  };
}

test('specific already running collector can be inspected without a new launch or credential exposure',async()=>{
  const mock=mockedProvider();
  const result=await inspectExistingReferenceCollector('SECRET_API_KEY','mameto_lueji',
    mock.fetcher);
  assert.equal(result.status,'running');
  assert.equal(result.reference,'mameto_lueji');
  assert.equal(result.latestRunSeen,true);
  assert.equal(result.instagramSessionVerifiedByProvider,false);
  assert.equal(result.resultsAttributedToSavedReference,false);
  assert.equal(result.followsExecutedByDiagnostic,0);
  assert.equal(result.newFollowersOnOwnAccount,0);
  assert.equal(mock.requests.length,2);
  assert.doesNotMatch(JSON.stringify(result),/NEVER_PRINT|SECRET|agentId|sessionCookie/);
});

test('other references cannot be assigned results of the old collector',async()=>{
  const mock=mockedProvider();
  const result=await inspectExistingReferenceCollector('SECRET_API_KEY','uber',
    mock.fetcher);
  assert.equal(result.status,'no-matching-collector');
  assert.equal(result.latestRunSeen,false);
  assert.equal(mock.requests.length,1);
});
test('malformed/other agent lists and missing reliable statuses fail closed',()=>{
  const valid={id:'2222222222222222',agentId,status:'running'};
  assert.deepEqual(classifyCollectorContainers([valid],agentId),
    {status:'running',latestRunSeen:true});
  assert.deepEqual(classifyCollectorContainers([valid,{...valid,
    agentId:'3333333333333333'}],agentId),
    {status:'unverified',latestRunSeen:false});
  assert.deepEqual(classifyCollectorContainers([{...valid,id:'oops'}],agentId),
    {status:'unverified',latestRunSeen:false});
  assert.deepEqual(classifyCollectorContainers([],agentId),
    {status:'no-run',latestRunSeen:false});
  assert.deepEqual(classifyCollectorContainers([{...valid,status:'finished'}],agentId),
    {status:'unverified',latestRunSeen:true});
  assert.deepEqual(classifyCollectorContainers([{...valid,status:'failed'}],agentId),
    {status:'failed',latestRunSeen:true});
  assert.deepEqual(classifyCollectorContainers([{...valid,status:'finished',
    endedAt:'2026-11-21T03:12:00Z'}],agentId),
    {status:'finished',latestRunSeen:true});
});
test('latest container is selected by timestamp rather than array order',()=>{
  const older={id:'2222222222222222',agentId,status:'finished',
    startedAt:'2026-11-19T03:00:00Z',endedAt:'2026-11-19T03:03:00Z'};
  const newer={id:'3333333333333333',agentId,status:'running',
    startedAt:'2026-11-21T03:11:00Z'};
  assert.equal(classifyCollectorContainers([older,newer],agentId).status,'running');
});
test('operator monitor has no agent writes and does not expose provider credentials',()=>{
  const route=readFileSync('app/api/operator/phantombuster-collector-progress/route.ts','utf8');
  const providerModule=readFileSync('lib/providers/phantombuster-collector-progress.ts','utf8');
  const panel=readFileSync('app/(app)/references/_components/operator-collector-intake-panel.tsx','utf8');
  assert.match(route,/VERCEL_ENV!=='preview'/);
  assert.match(route,/operator\?\.role!=='admin'/);
  assert.match(route,/PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE/);
  assert.match(route,/inspectExistingReferenceCollector/);
  assert.match(providerModule,/mode','all'/);
  assert.match(providerModule,/withRuntimeEvents','false'/);
  assert.match(panel,/Consultar execução existente \(somente leitura\)/);
  assert.doesNotMatch(route+providerModule,/https:\/\/api\.phantombuster\.com\/api\/v2\/agents\/(?:launch|save)|user_follow|user_unfollow/);
  assert.doesNotMatch(route,/\.create\(|\.update\(|\.delete\(/);
});
