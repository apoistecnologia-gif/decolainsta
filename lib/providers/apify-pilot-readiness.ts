type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type ApifyPilotStatus='connected'|'not-configured'|'invalid-token'|'rate-limited'|'unavailable';
export type ApifyPilotReadiness=Readonly<{
  status:ApifyPilotStatus;
  authenticationChecked:boolean;
  actorRunsExecuted:0;
  instagramActionsExecuted:0;
  collectionEnabled:false;
}>;

/**
 * Read-only API credential check. Only the Apify account identity endpoint
 * is called; no Actor is started and no dataset is downloaded.
 * Do not return, log, store or forward a token, account, or API response body.
 */
export async function inspectApifyPilotConnection(
  token:string|undefined,fetcher:Fetcher=fetch,
):Promise<ApifyPilotReadiness>{
  const result=(status:ApifyPilotStatus,authenticationChecked:boolean):
    ApifyPilotReadiness=>({
      status,authenticationChecked,actorRunsExecuted:0,
      instagramActionsExecuted:0,collectionEnabled:false,
    });
  if(!token)return result('not-configured',false);
  if(token.length<12||token.length>512||/[\r\n]/.test(token))
    return result('invalid-token',false);
  try{
    const response=await fetcher('https://api.apify.com/v2/users/me',{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      cache:'no-store',redirect:'error',credentials:'omit',
      signal:AbortSignal.timeout(8000),
    });
    if(response.status===401||response.status===403)return result('invalid-token',true);
    if(response.status===429)return result('rate-limited',true);
    if(!response.ok)return result('unavailable',true);
    return result('connected',true);
  }catch{
    return result('unavailable',true);
  }
}
