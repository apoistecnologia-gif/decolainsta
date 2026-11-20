/**
 * Read a SINGLE finished PhantomBuster launch's result and console summary.
 * Results are provider claims, not independent Instagram relationship proof.
 *
 * This adapter returns only a validated public username + numeric status.
 * It never returns logs, cookies, arguments, URLs, bios, API keys or images.
 * No Instagram or Phantom action is executed.
 */
import { phantomBusterRequestHeaders } from './phantombuster-request-headers';

type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
export type FollowersReport =
  |{status:'provider-reported';username:string;reportedCount:1}
  |{status:'result-only';username:string;reportedCount:1}
  |{status:'none'|'ambiguous'|'unavailable'|'invalid-key'|'rate-limited'};
const obj=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const numericId=(v:unknown):boolean=>
  typeof v==='string'&&/^\d{10,25}$/.test(v);
const name=(v:unknown):v is string=>
  typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);

function instagramUsername(v:unknown):string|null{
  if(typeof v!=='string'||v.length>160)return null;
  try{
    const u=new URL(v);
    if(u.protocol!=='https:'||!['www.instagram.com','instagram.com'].includes(u.hostname)||
      u.search||u.hash||u.username||u.password||u.port)return null;
    const segments=u.pathname.split('/').filter(Boolean);
    return segments.length===1&&name(segments[0])?segments[0]:null;
  }catch{return null;}
}
async function bounded(res:Response,max:number):Promise<unknown>{
  if(!res.body||Number(res.headers.get('content-length')??0)>max)return null;
  const decoder=new TextDecoder(),reader=res.body.getReader();
  let text='',size=0;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>max){await reader.cancel();return null;}
      text+=decoder.decode(part.value,{stream:true});
    }
    return JSON.parse(text+decoder.decode()) as unknown;
  }catch{return null;}finally{reader.releaseLock();}
}
function runRows(response:unknown):unknown[]|null{
  const envelope=obj(response);
  let payload:unknown=envelope?.resultObject??obj(envelope?.data)?.resultObject;
  if(typeof payload==='string'){
    if(payload.length>40000)return null;
    try{payload=JSON.parse(payload) as unknown;}catch{return null;}
  }
  const payloadObj=obj(payload);
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payloadObj?.data))return payloadObj.data;
  if(Array.isArray(payloadObj?.results))return payloadObj.results;
  if(Array.isArray(payloadObj?.profiles))return payloadObj.profiles;
  return null;
}
export function parseSingleRunProfile(response:unknown,reference:string):string|null{
  if(!name(reference))return null;
  const rows=runRows(response);
  if(!rows||rows.length!==1)return null;
  const row=obj(rows[0]);
  if(!row)return null;
  const username=instagramUsername(row.profileUrl??row.profileURL);
  const fromName=row.profileName??row.username;
  if(!username||!name(fromName)||username!==fromName)return null;
  if(instagramUsername(row.query)!==reference)return null;
  return username;
}
export function parseReportedFollowSummary(value:unknown):boolean{
  const box=obj(value);
  const data=obj(box?.data);
  const raw=box?.output??data?.output;
  if(typeof raw!=='string'||raw.length>100000)return false;
  // Never infer success from merely mentioning 'follow' in an error.
  // Require the provider's exact singular success wording.
  return /\b1\s+profile\s+followed\b/i.test(raw) &&
    !/\b(?:0|[2-9]|[1-9]\d+)\s+profiles?\s+followed\b/i.test(raw);
}
export async function fetchFollowersRunReport(
  apiKey:string,containerId:string,reference:string,fetcher:Fetcher=fetch,
):Promise<FollowersReport>{
  if(!apiKey||apiKey.length>512||!numericId(containerId)||!name(reference))
    return {status:'unavailable'};
  const opts:RequestInit={
    method:'GET',headers:phantomBusterRequestHeaders(apiKey),
    credentials:'omit',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(8000),
  };
  async function query(endpoint:string,max:number){
    const u=new URL('https://api.phantombuster.com/api/v2/containers/'+endpoint);
    u.searchParams.set('id',containerId);
    const res=await fetcher(u.toString(),opts);
    if(res.status===401||res.status===403)
      return {status:'invalid-key' as const,value:null};
    if(res.status===429)return {status:'rate-limited' as const,value:null};
    if(res.status===404||res.status===204)
      return {status:'none' as const,value:null};
    if(!res.ok)return {status:'unavailable' as const,value:null};
    const value=await bounded(res,max);
    if(value===null)return {status:'unavailable' as const,value:null};
    return {status:'ok' as const,value};
  }
  try{
    const result=await query('fetch-result-object',80000);
    if(result.status!=='ok')return {status:result.status};
    const username=parseSingleRunProfile(result.value,reference);
    if(!username){
      const rows=runRows(result.value);
      return {status:rows&&rows.length===0?'none':'ambiguous'};
    }
    const summary=await query('fetch-output',110000);
    if(summary.status==='invalid-key'||summary.status==='rate-limited')
      return {status:summary.status};
    if(summary.status==='ok'&&parseReportedFollowSummary(summary.value))
      return {status:'provider-reported',username,reportedCount:1};
    return {status:'result-only',username,reportedCount:1};
  }catch{return {status:'unavailable'};}
}
