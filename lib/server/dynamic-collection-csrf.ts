/**
 * Same-origin CSRF check for the stable Vercel Preview domain.
 * The public Host seen by the browser may differ from request.url when
 * Vercel internally routes an alias to an immutable deployment hostname.
 * Never trust client-supplied x-forwarded-host or arbitrary preview URLs.
 */
export function isSameOriginDynamicCollectionRequest(
  origin:string|null, requestUrl:string, host:string|null,
):boolean {
  if(!origin)return false;
  let incoming:URL,server:URL;
  try{
    incoming=new URL(origin);
    server=new URL(requestUrl);
  }catch{return false;}
  if(incoming.protocol!=='https:'||incoming.username||incoming.password||
    incoming.pathname!=='/'||incoming.search||incoming.hash)
    return false;
  // Browser navigation must have used exactly this scheme + authority.
  if(incoming.origin===server.origin)return true;
  if(!host||host.length>255||!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host))
    return false;
  // The hostname is supplied by Vercel as the HTTP Host for this request;
  // unlike x-forwarded-host, it is never inferred from user input in code.
  try {
    const publicHost=new URL('https://'+host);
    return incoming.origin===publicHost.origin;
  }catch{return false;}
}
