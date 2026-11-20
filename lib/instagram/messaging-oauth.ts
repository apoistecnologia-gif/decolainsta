/**
 * Separate Instagram Business Login authorization. Never reuse a Facebook
 * Business Integration System User token or write encryptedAccessToken.
 * This module does not request permissions until a signed-in owner clicks
 * the dedicated connection action (feature-gated, Preview only).
 */
export type MessagingOAuthConfig={
  clientId:string;clientSecret:string;redirectUri:string;
};
type Fetcher=(url:string,opts:RequestInit)=>Promise<Response>;
const object=(value:unknown):Record<string,unknown>|null=>
  value!==null&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
const validToken=(v:unknown):v is string=>
  typeof v==='string'&&v.length>=10&&v.length<=4096;
const validId=(v:unknown):v is string=>
  typeof v==='string'&&/^\d{5,30}$/.test(v);
export function messagingEnabled(env:NodeJS.ProcessEnv=process.env){
  return env.VERCEL_ENV==='preview'&&
    env.INSTAGRAM_MESSAGING_INTEGRATION_ENABLED==='yes';
}
export function messagingOAuthConfig(
  env:NodeJS.ProcessEnv=process.env,
):MessagingOAuthConfig|null{
  const clientId=env.INSTAGRAM_MESSAGING_APP_ID??'';
  const clientSecret=env.INSTAGRAM_MESSAGING_APP_SECRET??'';
  const redirectUri=env.INSTAGRAM_MESSAGING_REDIRECT_URI??'';
  if(!/^\d{5,30}$/.test(clientId)||clientSecret.length<12||
    clientSecret.length>512||redirectUri.length>512)return null;
  try{
    const url=new URL(redirectUri);
    if(url.protocol!=='https:'||url.username||url.password||
      url.search||url.hash||url.pathname!=='/api/instagram/messaging/callback')
      return null;
    return {clientId,clientSecret,redirectUri};
  }catch{return null;}
}
export function messagingAuthorizationUrl(config:MessagingOAuthConfig,state:string){
  if(!/^[a-zA-Z0-9_-]{15,100}:[a-f0-9]{48}$/.test(state))
    throw Error('Estado de autorização inválido');
  const url=new URL('https://www.instagram.com/oauth/authorize');
  url.search=new URLSearchParams({
    client_id:config.clientId,redirect_uri:config.redirectUri,
    scope:'instagram_business_basic,instagram_business_manage_messages',
    response_type:'code',state,
  }).toString();
  return url.toString();
}
async function boundedJson(res:Response):Promise<Record<string,unknown>|null>{
  if(!res.ok||!res.body||Number(res.headers.get('content-length')??0)>32000)
    return null;
  const reader=res.body.getReader();
  const decoder=new TextDecoder();let bytes=0;let text='';
  try{
    for(;;){
      const block=await reader.read();if(block.done)break;
      bytes+=block.value.byteLength;
      if(bytes>32000){await reader.cancel();return null;}
      text+=decoder.decode(block.value,{stream:true});
    }
    return object(JSON.parse(text+decoder.decode()) as unknown);
  }catch{return null;}finally{reader.releaseLock();}
}
export type MessagingConnectedProfile={
  id:string;username:string;accessToken:string;expiresIn:number;
};
/** Exact host allowlist and no redirects; never log provider payloads. */
export async function exchangeMessagingOAuth(
  config:MessagingOAuthConfig,code:string,fetcher:Fetcher=fetch,
):Promise<MessagingConnectedProfile|null>{
  if(!code||code.length>2000||/\s/.test(code))return null;
  const opts={cache:'no-store' as const,credentials:'omit' as const,
    redirect:'error' as const,signal:AbortSignal.timeout(10000)};
  try{
    const body=new URLSearchParams({
      client_id:config.clientId,client_secret:config.clientSecret,
      grant_type:'authorization_code',redirect_uri:config.redirectUri,code,
    });
    const short=await boundedJson(await fetcher(
      'https://api.instagram.com/oauth/access_token',{
        ...opts,method:'POST',headers:{
          'Content-Type':'application/x-www-form-urlencoded',
        },body:body.toString(),
      }));
    if(!validToken(short?.access_token)||!validId(String(short?.user_id??'')))
      return null;
    const longUrl=new URL('https://graph.instagram.com/access_token');
    longUrl.search=new URLSearchParams({
      grant_type:'ig_exchange_token',
      client_secret:config.clientSecret,access_token:short.access_token,
    }).toString();
    const long=await boundedJson(await fetcher(longUrl.toString(),{
      ...opts,method:'GET',
    }));
    if(!validToken(long?.access_token)||
      typeof long.expires_in!=='number'||!Number.isSafeInteger(long.expires_in)||
      long.expires_in<86400||long.expires_in>5500000)return null;
    const url=new URL('https://graph.instagram.com/v27.0/me');
    url.searchParams.set('fields','user_id,username');
    const profile=await boundedJson(await fetcher(url.toString(),{
      ...opts,method:'GET',
      headers:{Authorization:'Bearer '+long.access_token},
    }));
    if(!validId(String(profile?.user_id??''))||
      String(profile?.user_id)!==String(short.user_id)||
      typeof profile?.username!=='string'||
      !/^[a-z0-9._]{1,30}$/.test(profile.username))
      return null;
    return {
      id:String(profile.user_id),username:profile.username,
      accessToken:long.access_token,expiresIn:long.expires_in,
    };
  }catch{return null;}
}
