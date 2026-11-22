/** Read-only discovery of Instagram social-action actors on Apify.
 * An actor being listed is NOT evidence that a follow or unfollow works.
 * No Instagram cookies, password, input, runs or billing involved.
 */
export const APIFY_SOCIAL_ACTORS={
  combined:'dead00~instagram-follow-unfollow-bot',
  follow:'synk~instagram-auto-follow',
  unfollow:'synk~instagram-auto-unfollow',
} as const;
export type SocialActorRole=keyof typeof APIFY_SOCIAL_ACTORS;
export type ActorCheck=Readonly<{
  status:'listed'|'not-configured'|'not-found'|'unauthorized'|
    'rate-limited'|'metadata-mismatch'|'unavailable';
  permissions:'limited'|'full'|'unknown';
  users30Days:number|null;
  reviewCount:number|null;
  requiresInstagramCookie:true;
  realActionVerified:false;
}>;
export type ApifySocialReadiness=Readonly<{
  combined:ActorCheck;follow:ActorCheck;unfollow:ActorCheck;
  verifiedFollows:0;verifiedUnfollows:0;
  actorRunsExecuted:0;instagramActionsExecuted:0;
  liveActionsEnabled:false;
}>;

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const fallback=(status:ActorCheck['status']):ActorCheck=>({
  status,permissions:'unknown',users30Days:null,reviewCount:null,
  requiresInstagramCookie:true,realActionVerified:false,
});
const obj=(value:unknown):Record<string,unknown>|null=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
const count=(v:unknown):number|null=>
  typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000
    ?v:null;

async function inspectActor(
  token:string|undefined,actorId:string,fetcher:Fetcher,
):Promise<ActorCheck>{
  if(!token||token.length<12||token.length>512||/[\r\n]/.test(token))
    return fallback('not-configured');
  const [owner,name]=actorId.split('~');
  try{
    const response=await fetcher(
      'https://api.apify.com/v2/acts/'+actorId,{
        method:'GET',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        cache:'no-store',credentials:'omit',redirect:'error',
        signal:AbortSignal.timeout(6000),
      });
    if(response.status===401||response.status===403)
      return fallback('unauthorized');
    if(response.status===404)return fallback('not-found');
    if(response.status===429)return fallback('rate-limited');
    if(!response.ok)return fallback('unavailable');
    const length=response.headers.get('content-length');
    if(length&&Number(length)>500000)return fallback('unavailable');
    // The Actor metadata API can contain source files. We never return,
    // persist or log its full response.
    const data=obj(obj(await response.json())?.data);
    if(!data||data.username!==owner||data.name!==name||
       data.isPublic!==true||data.isDeprecated===true)
      return fallback('metadata-mismatch');
    const stats=obj(data.stats);
    return {
      status:'listed',
      permissions:data.actorPermissionLevel==='FULL_PERMISSIONS'
        ?'full':data.actorPermissionLevel==='LIMITED_PERMISSIONS'
          ?'limited':'unknown',
      users30Days:count(stats?.totalUsers30Days),
      reviewCount:count(stats?.actorReviewCount),
      requiresInstagramCookie:true,realActionVerified:false,
    };
  }catch{return fallback('unavailable');}
}
/** Three GETs only, never executes an Actor or alters Instagram. */
export async function inspectApifySocialActors(
  token:string|undefined,fetcher:Fetcher=fetch,
):Promise<ApifySocialReadiness>{
  const [combined,follow,unfollow]=await Promise.all([
    inspectActor(token,APIFY_SOCIAL_ACTORS.combined,fetcher),
    inspectActor(token,APIFY_SOCIAL_ACTORS.follow,fetcher),
    inspectActor(token,APIFY_SOCIAL_ACTORS.unfollow,fetcher),
  ]);
  return {combined,follow,unfollow,
    verifiedFollows:0,verifiedUnfollows:0,
    actorRunsExecuted:0,instagramActionsExecuted:0,
    liveActionsEnabled:false};
}
