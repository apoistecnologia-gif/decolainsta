import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  inspectFollowersAutoFollowDocument, inspectFollowersAutoFollowAgent,
} from '../lib/providers/phantombuster-followers-auto-follow';

const id='1838046655144130';
const ref='mameto_lueji';
const agent=(arg:Record<string,unknown>={})=>({
  id, script:'Instagram Followers Auto Follow.js', launchType:'manually',
  argument:JSON.stringify({
    profileUrl:'https://www.instagram.com/mameto_lueji/',
    numberOfProfilesToFollow:1, ...arg,
  }),
});

test('verifies saved followers auto-follow agent is manual and one profile only',()=>{
  assert.equal(inspectFollowersAutoFollowDocument(agent(),id,ref),'matched');
  assert.equal(inspectFollowersAutoFollowDocument(agent(),id,'wrong_reference'),'wrong-reference');
  assert.equal(inspectFollowersAutoFollowDocument({...agent(),launchType:'repeatedly'},id,ref),'wrong-frequency');
  assert.equal(inspectFollowersAutoFollowDocument({...agent(),script:'Instagram Auto Follow.js'},id,ref),'wrong-agent-type');
  assert.equal(inspectFollowersAutoFollowDocument(agent({numberOfProfilesToFollow:20}),id,ref),'limit-not-one');
  assert.equal(inspectFollowersAutoFollowDocument(agent({numberOfProfilesToFollow:undefined}),id,ref),'limit-not-one');
  assert.equal(inspectFollowersAutoFollowDocument(agent({urls:['https://www.instagram.com/other/']}),id,ref),'ambiguous-input');
  assert.equal(inspectFollowersAutoFollowDocument(agent({spreadsheetUrl:'https://attacker.invalid/list.csv'}),id,ref),'ambiguous-input');
});

test('reads exactly one agent without launching, leaks no raw session or inputs',async()=>{
  const calls:string[]=[];
  const result=await inspectFollowersAutoFollowAgent('secret-api-key',id,ref,
    async(url,options)=>{
      calls.push(url);
      assert.equal(options?.method,'GET');
      assert.equal(options?.redirect,'error');
      assert.equal(options?.credentials,'omit');
      assert.ok(!url.includes('launch'));
      return new Response(JSON.stringify({data:{...agent(),
        sessionCookie:'DO_NOT_RETURN',
      }}),{status:200});
    });
  assert.equal(result,'matched');
  assert.equal(calls.length,1);
  assert.doesNotMatch(result,/DO_NOT_RETURN|secret-api-key/);
});

test('falls back only to single-agent inventory after missing detail response',async()=>{
  const requests:string[]=[];
  const result=await inspectFollowersAutoFollowAgent('key',id,ref,async url=>{
    requests.push(url);
    if(url.includes('/agents/fetch?'))return new Response('',{status:404});
    assert.ok(url.includes('agentIds='+id));
    return new Response(JSON.stringify({data:[agent()]}),{status:200});
  });
  assert.equal(result,'matched');
  assert.equal(requests.length,2);
});

test('provider refusal cannot cause retry, launch or disclosure',async()=>{
  let calls=0;
  const result=await inspectFollowersAutoFollowAgent('key',id,ref,
    async()=>{calls++;return new Response('private secret',{status:429});});
  assert.equal(result,'rate-limited');
  assert.equal(calls,1);
});

test('preview-only admin diagnostic has no social-action endpoints',()=>{
  const s=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  assert.match(s,/process\.env\.VERCEL_ENV !== 'preview'/);
  assert.match(s,/operator\?\.role !== 'admin'/);
  assert.match(s,/userId/);
  assert.match(s,/where:\{ username:accountUsername, userId \}/);
  assert.match(s,/instagramAccountId:account.id, username:referenceUsername/);
  assert.match(s,/agentLaunchEnabled:false/);
  assert.match(s,/sessionAccountVerifiedByProvider:false/);
  assert.doesNotMatch(s,/agents\/launch|agents\/save|user_follow\(/);
  const h=readFileSync('lib/providers/phantombuster-followers-auto-follow.ts','utf8');
  assert.match(h,/api\/v2\/agents\/fetch/);
  assert.doesNotMatch(h,/agents\/launch|agents\/save/);
});

test('reads private exclusion by exact manifest schema, never by guessed key',async()=>{
  const {readSavedPrivateFilter,inspectSavedPrivateFilter}=
    await import('../lib/providers/phantombuster-private-filter');
  const config={...agent({privateSwitch:true}),manifest:{
    argumentSchema:{properties:{privateSwitch:{
      type:'boolean',title:'Exclude private profiles',
    }}},
  }};
  assert.equal(readSavedPrivateFilter({data:config},id,ref),'enabled');
  assert.equal(readSavedPrivateFilter({data:{...config,
    argument:agent({privateSwitch:false}).argument}},id,ref),'disabled');
  assert.equal(readSavedPrivateFilter(agent({privateSwitch:true}),id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,manifest:{
    argumentSchema:{properties:{privateSwitch:{
      type:'string',title:'Exclude private profiles',
    }}},
  }},id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,manifest:{
    argumentSchema:{properties:{
      privateSwitch:{type:'boolean',title:'Exclude private profiles'},
      otherSwitch:{type:'boolean',title:'Exclude private profiles'},
    }},
  }},id,ref),'unverified');
  assert.equal(readSavedPrivateFilter({...config,
    script:'Instagram Auto Follow.js'},id,ref),'agent-mismatch');
  let requests=0;
  const status=await inspectSavedPrivateFilter('SECRET_API_KEY',id,ref,
    async(url,opts)=>{
      requests++;
      assert.equal(new URL(url).pathname,'/api/v2/agents/fetch');
      assert.equal(new URL(url).searchParams.get('withManifest'),'true');
      assert.equal(new URL(url).searchParams.get('withCode'),'false');
      assert.equal(opts?.method,'GET');
      assert.equal(opts?.redirect,'error');
      assert.equal(opts?.credentials,'omit');
      return new Response(JSON.stringify({data:{...config,
        sessionCookie:'DO_NOT_EXPOSE'}}),{status:200});
    });
  assert.equal(status,'enabled');
  assert.equal(requests,1);
  assert.doesNotMatch(status,/SECRET|COOKIE/);
});
test('explicitly typed checkbox can map an argument; unknown types cannot',async()=>{
  const {readSavedPrivateFilter}=await import(
    '../lib/providers/phantombuster-private-filter');
  const entry={...agent({privateSwitch:true}),manifest:{
    argumentForm:{steps:[{fields:[{
      label:'Exclude private profiles (optional)',
      inputType:'checkbox',name:'privateSwitch',
    }]}]},
  }};
  assert.equal(readSavedPrivateFilter(entry,id,ref),'enabled');
  assert.equal(readSavedPrivateFilter({...entry,manifest:{
    argumentForm:{steps:[{fields:[{
      label:'Exclude private profiles',inputType:'text',name:'privateSwitch',
    }]}]},
  }},id,ref),'unverified');
});
test('admin readiness and any future launch block unverified exclusion',()=>{
  const readiness=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  const runner=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(readiness,/privateExclusionVerified:/);
  assert.match(readiness,/settings:\{select:\{skipPrivateProfiles:true\}\}/);
  assert.match(runner,/ctx.account.settings\?\.skipPrivateProfiles===false/);
  assert.match(runner,/privateExclusion!=='enabled'/);
  assert.match(runner,/inspectSavedPrivateFilter/);
  const src=readFileSync('lib/providers/phantombuster-private-filter.ts','utf8');
  assert.match(src,/withManifest','true'/);
  assert.doesNotMatch(src,/agents\/launch|agents\/save/);
});

test('filter diagnosis distinguishes missing manifest, field and saved value',async()=>{
  const {diagnoseSavedPrivateFilter,inspectSavedPrivateFilterDetails}=
    await import('../lib/providers/phantombuster-private-filter');
  const base={...agent({privateSwitch:true}),manifest:{
    argumentSchema:{properties:{privateSwitch:{
      type:'boolean',title:'Exclude private profiles',
    }}},
  }};
  assert.deepEqual(diagnoseSavedPrivateFilter(base,id,ref),
    {status:'enabled',reason:'verified'});
  const missing={...base};
  delete (missing as {manifest?:unknown}).manifest;
  assert.equal(diagnoseSavedPrivateFilter(missing,id,ref).reason,'manifest-absent');
  assert.equal(diagnoseSavedPrivateFilter({...base,manifest:'bad-json'},
    id,ref).reason,'manifest-invalid');
  assert.equal(diagnoseSavedPrivateFilter({...base,
    manifest:JSON.stringify(base.manifest)},id,ref).status,'enabled');
  assert.equal(diagnoseSavedPrivateFilter({...base,
    manifest:{argumentSchema:{properties:{}}}},id,ref).reason,
    'filter-not-described');
  assert.equal(diagnoseSavedPrivateFilter({...base,manifest:{
    argumentSchema:{properties:{
      privateSwitch:{type:'boolean',title:'Exclude private profiles'},
      another:{type:'boolean',title:'Exclude private profiles'},
    }},
  }},id,ref).reason,'filter-ambiguous');
  const noField={...base,argument:agent().argument};
  assert.equal(diagnoseSavedPrivateFilter(noField,id,ref).reason,
    'saved-argument-missing');
  assert.equal(diagnoseSavedPrivateFilter({...base,
    argument:agent({privateSwitch:'true'}).argument},id,ref).reason,
    'saved-value-invalid');
  const result=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async()=>new Response(JSON.stringify({data:base}),{status:200}));
  assert.deepEqual(result,{status:'enabled',reason:'verified'});
  const limited=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async()=>new Response('429',{status:429}));
  assert.deepEqual(limited,{status:'rate-limited',reason:'provider-rate-limited'});
});
test('client does not advertise a completed launch as enabled or repeat result import',()=>{
  const source=readFileSync(
    'app/(app)/references/_components/social-pilot-panel.tsx','utf8');
  assert.match(source,/trial\.attempted/);
  assert.match(source,/a tentativa única já foi utilizada/);
  assert.match(source,/privateExclusionReason/);
  assert.match(source,/trial\.attempt\.stage==='container-finished'/);
  const readiness=readFileSync(
    'app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  assert.match(readiness,/privateExclusionReason:exclusion.reason/);
});

test('official withManifest API errors have precise sanitized outcomes',async()=>{
  const {inspectSavedPrivateFilterDetails}=
    await import('../lib/providers/phantombuster-private-filter');
  const cases=[
    [400,'manifest-request-rejected','unverified'],
    [401,'manifest-access-denied','unverified'],
    [403,'provider-forbidden','unverified'],

    [412,'agent-script-missing','unverified'],
    [429,'provider-rate-limited','rate-limited'],
    [500,'provider-service-error','unavailable'],
    [502,'provider-service-error','unavailable'],
  ] as const;
  for(const [code,reason,status] of cases){
    const result=await inspectSavedPrivateFilterDetails('SENSITIVE_KEY',id,ref,
      async(url,opts)=>{
        assert.equal(new URL(url).searchParams.get('withManifest'),'true');
        assert.equal(opts?.method,'GET');
        assert.equal(opts?.redirect,'error');
        return new Response('SENSITIVE_BODY',{status:code});
      });
    assert.deepEqual(result,{status,reason});
    assert.doesNotMatch(JSON.stringify(result),/SENSITIVE/);
  }
});
test('large, malformed and missing manifest responses cannot imply enabled',async()=>{
  const {inspectSavedPrivateFilterDetails}=
    await import('../lib/providers/phantombuster-private-filter');
  for(const [body,opts,reason] of [
    ['not-json',{},'response-malformed'],
    ['{}',{headers:{'content-length':'250001'}},'response-too-large'],
    [JSON.stringify({data:agent()}),{},'manifest-absent'],
  ] as const){
    const result=await inspectSavedPrivateFilterDetails('key',id,ref,
      async()=>new Response(body,{status:200,...opts}));
    assert.equal(result.reason,reason);
    assert.notEqual(result.status,'enabled');
  }
});

test('404 detail is reconciled with verified inventory entry, never assumed deletion',async()=>{
  const {inspectSavedPrivateFilterDetails}=await import(
    '../lib/providers/phantombuster-private-filter');
  const calls:string[]=[];
  const entry=agent({privateSwitch:true});
  const result=await inspectSavedPrivateFilterDetails('SECRET_KEY',id,ref,
    async(url,opts)=>{
      calls.push(url);
      assert.equal(opts?.method,'GET');
      assert.equal(opts?.redirect,'error');
      assert.equal(opts?.credentials,'omit');
      if(new URL(url).pathname==='/api/v2/agents/fetch'){
        assert.equal(new URL(url).searchParams.get('withManifest'),'true');
        return new Response('NOT_FOUND_BODY',{status:404});
      }
      assert.equal(new URL(url).pathname,'/api/v2/agents/fetch-all');
      assert.equal(new URL(url).searchParams.get('agentIds'),id);
      assert.equal(new URL(url).searchParams.get('withArgument'),'true');
      return new Response(JSON.stringify({data:[{...entry,
        sessionCookie:'NEVER_EXPOSE'}]}),{status:200});
    });
  assert.deepEqual(result,{
    status:'unverified',reason:'listed-agent-manifest-unavailable',
  });
  assert.equal(calls.length,2);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|COOKIE|BODY/);
});
test('inventory can verify exclusion only when manifest and argument agree',async()=>{
  const {inspectSavedPrivateFilterDetails}=await import(
    '../lib/providers/phantombuster-private-filter');
  const withManifest={...agent({privateSwitch:true}),manifest:{
    argumentSchema:{properties:{
      privateSwitch:{type:'boolean',title:'Exclude private profiles'},
    }},
  }};
  const result=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async(url)=>{
      if(url.includes('/agents/fetch?'))
        return new Response('',{status:404});
      return new Response(JSON.stringify({data:[withManifest]}),{status:200});
    });
  assert.deepEqual(result,{status:'enabled',reason:'verified'});
  const wrong=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async(url)=>{
      if(url.includes('/agents/fetch?'))
        return new Response('',{status:404});
      return new Response(JSON.stringify({data:[{...withManifest,
        id:'9999999999999'}]}),{status:200});
    });
  assert.deepEqual(wrong,{status:'unverified',reason:'inventory-mismatch'});
  const empty=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async(url)=>{
      if(url.includes('/agents/fetch?'))
        return new Response('',{status:404});
      return new Response(JSON.stringify({data:[]}),{status:200});
    });
  assert.deepEqual(empty,{status:'unverified',reason:'inventory-unavailable'});
  const failed=await inspectSavedPrivateFilterDetails('KEY',id,ref,
    async()=>new Response('',{status:404}));
  assert.deepEqual(failed,{status:'unverified',reason:'inventory-unavailable'});
});
test('privacy fallback remains read-only and no invalid manifest grants execution',()=>{
  const src=readFileSync('lib/providers/phantombuster-private-filter.ts','utf8');
  assert.match(src,/inspectInventoryFallback/);
  assert.match(src,/if\(res\.status===404\)/);
  assert.match(src,/url\.searchParams\.set\('agentIds',agentId\)/);
  assert.doesNotMatch(src,/agents\/save|agents\/launch|user_unfollow/);
  const route=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(route,/privateExclusion!=='enabled'/);
});

test('documented PhantomBuster argumentForm steps.fields object maps labeled boolean key',async()=>{
  const {diagnoseSavedPrivateFilter}=await import(
    '../lib/providers/phantombuster-private-filter');
  const withForm={...agent({excludePrivatesSwitch:true}),manifest:{
    argumentForm:{enabled:true,steps:[{
      slug:'advanced-settings',title:'Advanced settings',fields:{
        ignoredText:{type:'text',label:'Other setting'},
        excludePrivatesSwitch:{
          type:'checkbox',label:'Exclude private profiles (optional)',
        },
      },
    }]},
    argumentSchema:{type:'object',properties:{
      excludePrivatesSwitch:{type:'boolean'},
    }},
  }};
  assert.deepEqual(diagnoseSavedPrivateFilter(withForm,id,ref),
    {status:'enabled',reason:'verified'});
  assert.deepEqual(diagnoseSavedPrivateFilter({...withForm,
    argument:agent({excludePrivatesSwitch:false}).argument},id,ref),
    {status:'disabled',reason:'verified'});
  assert.equal(diagnoseSavedPrivateFilter({...withForm,
    argument:agent().argument},id,ref).reason,'saved-argument-missing');
  assert.equal(diagnoseSavedPrivateFilter({...withForm,
    argument:agent({excludePrivatesSwitch:'true'}).argument},id,ref).reason,
    'saved-value-invalid');
  assert.equal(diagnoseSavedPrivateFilter({...withForm,
    manifest:{argumentForm:{steps:[{fields:{
      excludePrivatesSwitch:{
        type:'text',label:'Exclude private profiles (optional)',
      },
    }}]}}},id,ref).reason,'filter-not-described');
  assert.equal(diagnoseSavedPrivateFilter({...withForm,
    manifest:{argumentForm:{steps:[{fields:{
      excludePrivatesSwitch:{
        type:'checkbox',label:'Exclude private profiles',name:'differentKey',
      },
    }}]}}},id,ref).reason,'filter-ambiguous');
});
test('manifest fields map works on 404 inventory fallback without guessing option value',async()=>{
  const {inspectSavedPrivateFilterDetails}=await import(
    '../lib/providers/phantombuster-private-filter');
  const example={...agent({privateFilterKey:true}),manifest:{
    argumentForm:{steps:[{fields:{
      privateFilterKey:{
        label:'Exclude private profiles',component:'switch',
      },
    }}]},
  }};
  const calls:string[]=[];
  const diagnosis=await inspectSavedPrivateFilterDetails('API_SECRET',id,ref,
    async(url,options)=>{
      calls.push(new URL(url).pathname);
      assert.equal(options?.method,'GET');
      assert.equal(options?.redirect,'error');
      if(url.includes('/agents/fetch?'))
        return new Response('',{status:404});
      return new Response(JSON.stringify({data:[{
        ...example,sessionCookie:'CREDENTIAL_NEVER_RETURN',
      }]}),{status:200});
    });
  assert.deepEqual(diagnosis,{status:'enabled',reason:'verified'});
  assert.deepEqual(calls,[
    '/api/v2/agents/fetch','/api/v2/agents/fetch-all',
  ]);
  assert.doesNotMatch(JSON.stringify(diagnosis),/API_SECRET|CREDENTIAL/);
});

test('sanitized structure identifies missing Phantom form paths without exposing fields',async()=>{
  const {diagnoseSavedPrivateFilter,describeSavedPrivateFilterStructure}=
    await import('../lib/providers/phantombuster-private-filter');
  const privateAgent={...agent({
    igSessionCookie:'VERY_SENSITIVE_COOKIE',
    privateSwitch:true,
  }),manifest:{
    argumentSchema:{properties:{
      igSessionCookie:{type:'string',title:'Connected account'},
    }},
    argumentForm:{steps:[{fields:{
      privateSwitch:{type:'checkbox',label:'Exclude unavailable accounts'},
      connectedSession:{type:'text',label:'Connected account'},
    }}]},
  }};
  const status=diagnoseSavedPrivateFilter(privateAgent,id,ref);
  assert.equal(status.status,'unverified');
  assert.equal(status.reason,'filter-not-described');
  assert.deepEqual(status.structure,{
    schema:'present',form:'present',steps:'array',fields:'map',
    booleanControls:1,privateRelatedLabels:0,exactLabels:0,
  });
  const serialized=JSON.stringify(status);
  assert.doesNotMatch(serialized,/VERY_SENSITIVE_COOKIE|igSessionCookie|privateSwitch|connectedSession/);
  assert.doesNotMatch(serialized,/Exclude unavailable accounts|Connected account/);
  const noForm=describeSavedPrivateFilterStructure({
    argumentSchema:{properties:{flag:{type:'boolean',title:'Privacy setting'}}},
  });
  assert.equal(noForm.form,'absent');
  assert.equal(noForm.booleanControls,1);
});
test('only admin readiness emits sanitized profile and leaves launch guard intact',()=>{
  const route=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  assert.match(route,/privateExclusionStructure/);
  assert.match(route,/operator\?\.role !== 'admin'/);
  const ui=readFileSync('app/(app)/references/_components/social-pilot-panel.tsx','utf8');
  assert.match(ui,/privateExclusionStructure/);
  const runner=readFileSync('app/api/operator/followers-auto-follow-run/route.ts','utf8');
  assert.match(runner,/privateExclusion!=='enabled'/);
});


test('pilot shows the current account name and keeps the original name as evidence',()=>{
  const ui=readFileSync('app/(app)/references/_components/social-pilot-panel.tsx','utf8');
  const readiness=readFileSync('app/api/operator/followers-auto-follow-readiness/route.ts','utf8');
  assert.match(ui,/Conta cadastrada: \{trial\?\.accountName/);
  assert.match(ui,/No teste original:/);
  assert.match(ui,/Confirmo que a sessão ativa é de @\{trial\.accountName\}/);
  assert.doesNotMatch(ui,/Confirmo que a sessão ativa é de @contateste6699/);
  assert.match(readiness,/Nome atual cadastrado:/);
  assert.match(readiness,/accountUsername/);
});
