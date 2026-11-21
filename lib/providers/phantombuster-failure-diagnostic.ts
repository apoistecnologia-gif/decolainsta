import {phantomBusterRequestHeaders} from './phantombuster-request-headers';

/**
 * Read-only classification of the exact FAILED container's own console output.
 * Output may include Instagram usernames, URLs, cookies and session details:
 * never return, log or persist it. Only fixed allowlisted categories escape.
 */
export type DynamicFailureCategory =
  'session-invalid'|'login-challenge'|'invalid-input'|'private-target'|
  'platform-limited'|'workspace-limit'|'execution-timeout'|'runtime-error'|
  'followers-load-failed'|'profile-load-failed'|'terms-update'|
  'credentials-missing'|'no-matches'|'proxy-failure'|
  'unknown'|'empty-output'|'output-too-large'|'provider-unavailable';
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
const safeContainer=(id:string)=>/^\d{10,25}$/.test(id);
const MAX_LOG_BYTES=96_000;

async function boundedRawOutput(response:Response):Promise<string|null>{
  if(!response.body||Number(response.headers.get('content-length')||0)>MAX_LOG_BYTES)
    return null;
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,output='';
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      bytes+=part.value.byteLength;
      if(bytes>MAX_LOG_BYTES){await reader.cancel();return null;}
      output+=decoder.decode(part.value,{stream:true});
    }
    return output+decoder.decode();
  }catch{return null;}
  finally{reader.releaseLock();}
}

export function classifyDynamicFailureOutput(raw:string):DynamicFailureCategory{
  const text=raw.slice(0,MAX_LOG_BYTES).toLowerCase();
  if(!text.trim())return 'empty-output';
  if(/manual action required[: -]+instagram terms update|instagram terms (?:update|of service)|accept (?:the )?(?:new |updated )?terms|terms of service (?:must|need) (?:be |to be )?accepted/.test(text))
    return 'terms-update';
  if(/challenge_required|checkpoint_required|security challenge|two[- ]factor authentication|verification code required|verify your identity|checkpoint blocked/.test(text))
    return 'login-challenge';
  // Match the concrete errors used by Instagram-specific PhantomBuster guides
  // before generic network/rate-limit fallbacks.
  if(/error loading followers|could(?:n['’]t| not) load followers|failed to (?:load|retrieve|fetch) followers/.test(text))
    return 'followers-load-failed';
  if(/error opening page|could(?:n['’]t| not) load profile|failed to (?:open|load) (?:the )?(?:instagram )?(?:profile|page)|unable to open (?:the )?(?:profile|page)/.test(text))
    return 'profile-load-failed';
  if(/no matches found|no profiles? (?:to process|found|matched)|empty (?:or already processed )?input/.test(text))
    return 'no-matches';
  if(/no valid credentials found|missing (?:session )?cookie|session cookie required|a session cookie is required|not authenticated/.test(text))
    return 'credentials-missing';
  if(/can['’]?t connect through this proxy|proxy (?:connection|authentication) (?:failed|error)|unable to connect (?:to |through )?(?:the )?proxy/.test(text))
    return 'proxy-failure';
  if(/session (?:cookie )?(?:has )?(?:expired|invalid)|(?:invalid|expired) (?:instagram )?(?:session|cookie)|login required|not logged in|could not log in|failed to log in|login failed|authentication failed|invalid sessioncookie|cookie is invalid/.test(text))
    return 'session-invalid';
  if(/private (?:instagram )?(?:account|profile)|profile is private|account is private|this account is private/.test(text))
    return 'private-target';
  if(/feedback_required|rate limit(?:ed)?|too many requests|temporarily blocked|429 too many requests|instagram (?:has )?(?:blocked|restricted)/.test(text))
    return 'platform-limited';
  if(/invalid (?:input|url|argument|spreadsheet)|malformed (?:url|argument)|missing (?:required )?(?:field|url|input|argument|spreadsheet)|could not validate (?:input|data)|no (?:profiles|url) (?:provided|found in input)/.test(text))
    return 'invalid-input';
  if(/quota exceeded|insufficient credits|credit limit|workspace limit|storage (?:full|limit)|lead capacity|credits exhausted/.test(text))
    return 'workspace-limit';
  if(/timed? out|time limit (?:reached|exceeded)|maximum (?:run|execution) time|sigkill|out of memory|execution context was destroyed|context destroyed/.test(text))
    return 'execution-timeout';
  if(/uncaught exception|typeerror:|referenceerror:|syntaxerror:|internal server error|fatal error/.test(text))
    return 'runtime-error';
  return 'unknown';
}

export async function inspectDynamicFailureOutput(
  apiKey:string,containerId:string,fetcher:Fetcher=fetch,
):Promise<DynamicFailureCategory>{
  if(!apiKey||apiKey.length>512||!safeContainer(containerId))
    return 'provider-unavailable';
  const url=new URL('https://api.phantombuster.com/api/v2/containers/fetch-output');
  url.searchParams.set('id',containerId);
  url.searchParams.set('mode','raw');
  try{
    const response=await fetcher(url.toString(),{
      method:'GET',headers:phantomBusterRequestHeaders(apiKey),
      cache:'no-store',credentials:'omit',redirect:'error',
      signal:AbortSignal.timeout(8000),
    });
    if(response.status===204)return 'empty-output';
    if(!response.ok)return 'provider-unavailable';
    const raw=await boundedRawOutput(response);
    if(raw===null)return 'output-too-large';
    return classifyDynamicFailureOutput(raw);
  }catch{return 'provider-unavailable';}
}
