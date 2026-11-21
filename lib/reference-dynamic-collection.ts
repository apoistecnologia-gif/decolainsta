/** Durable one-reference-per-run queue, keyed by container launch receipt.
 * No customer selects a PhantomBuster URL. Unknown remote writes are
 * deliberately unretryable until an operator reconciles them.
 */
export const DYNAMIC_COLLECTION_ACTION='reference_dynamic_collection_v1';
export const MAX_DYNAMIC_COLLECTION_LOGS=5000;
export type DynamicJobState='claimed'|'launched'|'finished'|'finished-unverified'|
  'unconfirmed'|'rejected';
export type DynamicJobEvent=Readonly<{
  version:1;
  state:DynamicJobState;
  accountId:string;
  referenceId:string;
  referenceUsername:string;
  agentId:string;
  claimId:string;
  containerId:string|null;
}>;
const local=(v:unknown):v is string=>typeof v==='string'&&
  /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const refname=(v:unknown):v is string=>typeof v==='string'&&
  /^[a-z0-9._]{1,30}$/.test(v);
const agent=(v:unknown):v is string=>typeof v==='string'&&
  /^\d{10,25}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const states:DynamicJobState[]=['claimed','launched','finished',
  'finished-unverified','unconfirmed','rejected'];
export function makeDynamicJobEvent(input:Omit<DynamicJobEvent,'version'>):DynamicJobEvent|null{
  if(!states.includes(input.state)||!local(input.accountId)||!local(input.referenceId)||
    !refname(input.referenceUsername)||!agent(input.agentId)||
    !uuid(input.claimId)||
    (input.containerId!==null&&!agent(input.containerId))||
    (input.state==='launched'&&input.containerId===null))return null;
  return {version:1,...input};
}
export function parseDynamicJobEvent(raw:unknown):DynamicJobEvent|null{
  if(typeof raw!=='string'||raw.length>900)return null;
  let decoded:unknown;
  try{decoded=JSON.parse(raw) as unknown;}catch{return null;}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))return null;
  const v=decoded as Record<string,unknown>;
  if(Object.keys(v).length!==8||v.version!==1)return null;
  return makeDynamicJobEvent({
    state:v.state as DynamicJobState,
    accountId:v.accountId as string,
    referenceId:v.referenceId as string,
    referenceUsername:v.referenceUsername as string,
    agentId:v.agentId as string,
    claimId:v.claimId as string,
    containerId:v.containerId as string|null,
  });
}
export type ReferenceForDynamicPlan={id:string;username:string};
export type DynamicQueuePlan=Readonly<{
  total:number;attempted:number;
  next:{id:string;username:string}|null;
  unresolved:boolean;
  completed:number;
  attributionUnverified:number;
}>;
export function planDynamicReferenceQueue(
  references:readonly ReferenceForDynamicPlan[],
  events:readonly DynamicJobEvent[],
  agentId:string,
):DynamicQueuePlan{
  if(!agent(agentId))return {
    total:references.length,attempted:0,next:null,unresolved:true,
    completed:0,attributionUnverified:0,
  };
  const jobs=events.filter(e=>e.agentId===agentId);
  const attemptedIds=new Set(jobs.map(e=>e.referenceId));
  const unresolved=jobs.some(e=>!['finished','finished-unverified','rejected'].includes(e.state));
  const next=unresolved?null:references.find(r=>
    refname(r.username)&&local(r.id)&&!attemptedIds.has(r.id))??null;
  return {
    total:references.length,attempted:[...attemptedIds].length,next,
    unresolved,completed:jobs.filter(e=>e.state==='finished').length,
    attributionUnverified:jobs.filter(e=>e.state==='finished-unverified').length,
  };
}

/** A single, explicitly authorized recovery is possible only after a
 * verified failed container, with no concurrent/global unresolved claims.
 * Every earlier attempt remains in the append-only ActivityLog.
 */
export function planFailedDynamicReferenceRetry(
  references:readonly ReferenceForDynamicPlan[],
  events:readonly DynamicJobEvent[],
  accountId:string,agentId:string,
):ReferenceForDynamicPlan|null{
  if(!local(accountId)||!agent(agentId)||events.length===0)return null;
  const latest=events[0];
  if(latest.accountId!==accountId||latest.agentId!==agentId||
     latest.state!=='finished-unverified'||!latest.containerId)return null;
  if(events.some(event=>event.agentId===agentId&&
     !['finished','finished-unverified','rejected'].includes(event.state)))
    return null;
  const attempts=events.filter(e=>e.accountId===accountId&&
    e.agentId===agentId&&e.referenceId===latest.referenceId);
  // One original attempt, at most one controlled retry.
  if(attempts.length!==1)return null;
  return references.find(ref=>ref.id===latest.referenceId&&
    ref.username===latest.referenceUsername&&local(ref.id)&&
    refname(ref.username))??null;
}
