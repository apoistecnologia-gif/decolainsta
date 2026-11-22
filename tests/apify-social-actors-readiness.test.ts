import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {
  inspectApifySocialActors,APIFY_SOCIAL_ACTORS,
} from '../lib/providers/apify-social-actors-readiness';
const token='apify_api_test_token_123456';
test('three read-only metadata calls, never starts actor or sends session',async()=>{
 const seen:string[]=[];
 const status=await inspectApifySocialActors(token,async(url,init)=>{
   const parsed=new URL(url);
   seen.push(parsed.pathname);
   assert.equal(parsed.hostname,'api.apify.com');
   assert.equal(init?.method,'GET');
   assert.equal(init?.body,undefined);
   assert.equal((init?.headers as Record<string,string>).Authorization,
     'Bearer '+token);
   assert.equal(String(init?.body).includes('sessionid'),false);
   const id=parsed.pathname.split('/').slice(-1)[0]??'';
   const [username,name]=id.split('~');
   return Response.json({data:{username,name,isPublic:true,
     actorPermissionLevel:id===APIFY_SOCIAL_ACTORS.unfollow
      ?'FULL_PERMISSIONS':'LIMITED_PERMISSIONS',
     stats:{totalUsers30Days:4,actorReviewCount:2}}});
 });
 assert.equal(seen.length,3);
 assert.deepEqual(seen.sort(),Object.values(APIFY_SOCIAL_ACTORS)
   .map(x=>'/v2/acts/'+x).sort());
 assert.equal(status.combined.status,'listed');
 assert.equal(status.follow.status,'listed');
 assert.equal(status.unfollow.status,'listed');
 assert.equal(status.unfollow.permissions,'full');
 assert.equal(status.follow.permissions,'limited');
 assert.equal(status.unfollow.requiresInstagramCookie,true);
 assert.equal(status.unfollow.realActionVerified,false);
 assert.equal(status.liveActionsEnabled,false);
 assert.equal(status.actorRunsExecuted,0);
 assert.equal(status.verifiedFollows,0);
 assert.equal(status.verifiedUnfollows,0);
 assert.equal(JSON.stringify(status).includes(token),false);
});
test('absence, access error, ambiguous metadata never grants action readiness',async()=>{
 const missing=await inspectApifySocialActors(undefined,async()=>{
  throw Error('unexpected request');
 });
 assert.equal(missing.combined.status,'not-configured');
 const inaccessible=await inspectApifySocialActors(token,
   async()=>new Response(null,{status:403}));
 assert.equal(inaccessible.combined.status,'unauthorized');
 const malformed=await inspectApifySocialActors(token,
   async()=>Response.json({data:{name:'instagram-auto-follow',
     username:'wrong',isPublic:true}}));
 assert.equal(malformed.follow.status,'metadata-mismatch');
 assert.equal(malformed.instagramActionsExecuted,0);
});
test('operator-only preview endpoint and visible UI with no cookies or actions',()=>{
 const route=readFileSync('app/api/operator/apify/social-readiness/route.ts','utf8');
 const ui=readFileSync('app/(app)/references/_components/apify-social-readiness.tsx','utf8');
 assert.match(route,/VERCEL_ENV!=='preview'/);
 assert.match(route,/await auth\(\)/);
 assert.match(route,/user\?\.role!=='admin'/);
 assert.match(route,/process\.env\.APIFY_API_TOKEN/);
 assert.match(ui,/Verificar executores/);
 assert.match(ui,/Follows e unfollows reais verificados: 0/);
 assert.doesNotMatch(route+ui,/agents\/launch|actors\/.*runs|user_follow|user_unfollow|sessionCookie|sessionid['"]:/);
});
