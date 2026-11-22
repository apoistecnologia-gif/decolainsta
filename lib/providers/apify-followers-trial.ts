/** Single, capped, no-cookie Apify followers collection pilot.
 * No Instagram session, social actions, or raw provider logs are ever accepted.
 */
export const APIFY_PILOT_ACTOR='scraping_solutions~instagram-scraper-followers-following-no-cookies';
export const APIFY_PILOT_ACTION='apify_public_followers_pilot_v1';
export const APIFY_PILOT_SAMPLE_ACTION='apify_public_followers_sample_v1';
export const APIFY_PILOT_RESULTS_LIMIT=25;
export const APIFY_PILOT_MAX_USD=0.25;

type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
type Data=Record<string,unknown>;
const object=(v:unknown):Data|null=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)?v as Data:null;
const username=(v:unknown):v is string=>typeof v==='string'&&
  /^[a-z0-9._]{1,30}$/.test(v);
const apifyId=(v:unknown):v is string=>typeof v==='string'&&
  /^[a-zA-Z0-9]{17,24}$/.test(v);

async function boundedJson(response:Response):Promise<unknown>{
  if(!response.body||Number(response.headers.get('content-length')||0)>90_000)
    return null;
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let text='',n=0;
  try{
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      n+=chunk.value.byteLength;
      if(n>90_000){await reader.cancel();return null;}
      text+=decoder.decode(chunk.value,{stream:true});
    }
    return JSON.parse(text+decoder.decode()) as unknown;
  }catch{return null;}
  finally{reader.releaseLock();}
}
function headers(token:string){
  return {Authorization:'Bearer '+token,Accept:'application/json'};
}
export type ApifyStartResult=
  |{status:'queued';runId:string}
  |{status:'refused'|'unconfirmed';runId:null};

/** Exactly one POST, with a hard spending cap and a provider-defined item limit.
 * Never relaunch on any network/error ambiguity.
 */
export async function startCappedApifyPilot(
  token:string,source:string,fetcher:Fetcher=fetch,
):Promise<ApifyStartResult>{
  if(!token||token.length>512||token.length<12||/[\r\n]/.test(token)||
    !username(source))return {status:'refused',runId:null};
  const url=new URL('https://api.apify.com/v2/acts/'+APIFY_PILOT_ACTOR+'/runs');
  url.searchParams.set('maxTotalChargeUsd',String(APIFY_PILOT_MAX_USD));
  url.searchParams.set('maxItems',String(APIFY_PILOT_RESULTS_LIMIT));
  url.searchParams.set('timeout',String(180));
  try{
    const response=await fetcher(url.toString(),{
      method:'POST',headers:{...headers(token),'Content-Type':'application/json'},
      body:JSON.stringify({Account:[source],resultsLimit:APIFY_PILOT_RESULTS_LIMIT,
        dataToScrape:'Followers'}),
      cache:'no-store',redirect:'error',credentials:'omit',
      signal:AbortSignal.timeout(12000),
    });
    // A documented rejection is not an uncertain remote launch.
    if([400,401,402,403,404,422,429].includes(response.status))
      return {status:'refused',runId:null};
    if(!response.ok)return {status:'unconfirmed',runId:null};
    const root=object(await boundedJson(response));
    const data=object(root?.data);
    const id=data?.id;
    return apifyId(id)?{status:'queued',runId:id}:
      {status:'unconfirmed',runId:null};
  }catch{
    return {status:'unconfirmed',runId:null};
  }
}
export type ApifyRunInspection=
 |{status:'running'|'failed'|'unavailable'|'invalid';datasetId:null;costUsd:null|number}
 |{status:'succeeded';datasetId:string;costUsd:null|number};

export async function inspectCappedApifyRun(
  token:string,runId:string,fetcher:Fetcher=fetch,
):Promise<ApifyRunInspection>{
  const unavailable={status:'unavailable' as const,datasetId:null,costUsd:null};
  if(!token||token.length>512||!apifyId(runId))return unavailable;
  try{
    const response=await fetcher('https://api.apify.com/v2/actor-runs/'+runId,{
      method:'GET',headers:headers(token),cache:'no-store',
      credentials:'omit',redirect:'error',signal:AbortSignal.timeout(9000),
    });
    if(!response.ok)return unavailable;
    const data=object(object(await boundedJson(response))?.data);
    if(!data||data.id!==runId)return unavailable;
    const rawCost=data.usageTotalUsd;
    const cost=typeof rawCost==='number'&&Number.isFinite(rawCost)&&
      rawCost>=0&&rawCost<=100?rawCost:null;
    const status=data.status;
    if(['READY','RUNNING'].includes(String(status)))
      return {status:'running',datasetId:null,costUsd:cost};
    if(['FAILED','TIMED-OUT','ABORTED'].includes(String(status)))
      return {status:'failed',datasetId:null,costUsd:cost};
    if(status!=='SUCCEEDED')
      return {status:'invalid',datasetId:null,costUsd:cost};
    const datasetId=data.defaultDatasetId;
    return apifyId(datasetId)
      ?{status:'succeeded',datasetId,costUsd:cost}
      :{status:'invalid',datasetId:null,costUsd:cost};
  }catch{return unavailable;}
}
export type ApifyRows={status:'verified';usernames:string[]}|
  {status:'unavailable'|'invalid';usernames:[]};

export function validateApifyRows(raw:unknown,source:string):ApifyRows{
  const invalid={status:'invalid' as const,usernames:[] as []};
  if(!Array.isArray(raw)||raw.length>APIFY_PILOT_RESULTS_LIMIT||
     !username(source))return invalid;
  const found:string[]=[];
  for(const item of raw){
    const row=object(item);
    if(!row||row.username_scrape!==source||row.type!=='Followers'||
       !username(row.username)||row.username===source)return invalid;
    if(found.includes(row.username))return invalid;
    found.push(row.username);
  }
  return {status:'verified',usernames:found};
}

export async function readApifyTrialDataset(
  token:string,datasetId:string,source:string,fetcher:Fetcher=fetch,
):Promise<ApifyRows>{
  if(!token||!apifyId(datasetId)||!username(source))
    return {status:'unavailable',usernames:[]};
  const url=new URL('https://api.apify.com/v2/datasets/'+datasetId+'/items');
  url.searchParams.set('format','json');
  url.searchParams.set('clean','true');
  url.searchParams.set('limit',String(APIFY_PILOT_RESULTS_LIMIT+1));
  try{
    const response=await fetcher(url.toString(),{
      method:'GET',headers:headers(token),cache:'no-store',
      redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)return {status:'unavailable',usernames:[]};
    const raw=await boundedJson(response);
    return validateApifyRows(raw,source);
  }catch{return {status:'unavailable',usernames:[]};}
}
