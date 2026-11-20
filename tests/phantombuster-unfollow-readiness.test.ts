import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {inspectAutoUnfollowDocument,
  inspectExistingAutoUnfollowAgent} from
  '../lib/providers/phantombuster-unfollow-readiness';
const id='1838046655144199';
const base={
  id,script:'Instagram Auto Unfollow.js',launchType:'manually',
  argument:JSON.stringify({numberOfProfilesToProcess:1,actionMode:'protect'}),
  manifest:{argumentForm:{steps:[{fields:{
    actionMode:{label:'Unfollow action',options:[
      {label:'Unfollow',value:'unfollow'},
      {label:"Unfollow only if they don't follow you",value:'protect'},
    ]},
  }}]}},
};
test('only matching manual one-profile agent with documented protective value passes',()=>{
  assert.equal(inspectAutoUnfollowDocument(base,id),'ready-for-review');
  assert.equal(inspectAutoUnfollowDocument({...base,launchType:'repeatedly'},id),
    'scheduled');
  assert.equal(inspectAutoUnfollowDocument({...base,
    argument:JSON.stringify({numberOfProfilesToProcess:4,actionMode:'protect'})},
    id),'unsafe-limit');
  assert.equal(inspectAutoUnfollowDocument({...base,
    argument:JSON.stringify({numberOfProfilesToProcess:1,actionMode:'unfollow'})},
    id),'unverified-filter');
  assert.equal(inspectAutoUnfollowDocument({...base,manifest:null},id),
    'unverified-manifest');
  assert.equal(inspectAutoUnfollowDocument({...base,script:'Other.js'},id),
    'wrong-agent');
});
test('read-only inspection never launches, saves or leaks private data',async()=>{
  let count=0;
  const result=await inspectExistingAutoUnfollowAgent('KEY_SECRET',id,
    async(url,opts)=>{
      count++;
      assert.equal(new URL(url).pathname,'/api/v2/agents/fetch');
      assert.equal(new URL(url).searchParams.get('withManifest'),'true');
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      return Response.json({data:{...base,
        instagramSessionCookie:'SHOULD_NOT_LEAK'}});
    });
  assert.equal(result,'ready-for-review');
  assert.equal(count,1);
  assert.doesNotMatch(result,/SECRET|COOKIE/);
  const src=readFileSync(
    'lib/providers/phantombuster-unfollow-readiness.ts','utf8');
  assert.doesNotMatch(src,/agents\/launch|agents\/save/);
  const route=readFileSync(
    'app/api/operator/phantombuster-unfollow-readiness/route.ts','utf8');
  assert.match(route,/safeToExecuteAutomatically:false/);
  assert.match(route,/process.env.VERCEL_ENV!=='preview'/);
});
