import {parseCandidateEvidence} from '@/lib/reference-candidate-queue';

/**
 * Persistent operator control for a DRY RUN only. No PhantomBuster or
 * Instagram execution, session access, follow/unfollow or background worker.
 */
export const FOLLOW_PREVIEW_CONTROL_ACTION='reference_follow_preview_control_v1';
export type FollowPreviewState='idle'|'simulating'|'paused'|'stopped';
export type FollowPreviewOperation='start'|'pause'|'resume'|'stop';
export type FollowPreviewEvent={
  version:1;mode:'simulation';state:Exclude<FollowPreviewState,'idle'>;
  revision:number;eligibleAtChange:number;createdAt:string;
  realActionsExecuted:0;
};
const validDate=(s:string)=>!Number.isNaN(new Date(s).getTime())&&s.length<=35;

export function makeFollowPreviewEvent(
  state:Exclude<FollowPreviewState,'idle'>,revision:number,
  eligibleAtChange:number,createdAt:string,
):FollowPreviewEvent|null{
  if(!['simulating','paused','stopped'].includes(state)||
     !Number.isSafeInteger(revision)||revision<1||revision>10000||
     !Number.isSafeInteger(eligibleAtChange)||eligibleAtChange<0||
     eligibleAtChange>2000||!validDate(createdAt))return null;
  return {version:1,mode:'simulation',state,revision,eligibleAtChange,
    createdAt,realActionsExecuted:0};
}
export function parseFollowPreviewEvent(raw:unknown):FollowPreviewEvent|null{
  if(typeof raw!=='string'||raw.length>600)return null;
  let v:unknown;
  try{v=JSON.parse(raw) as unknown;}catch{return null;}
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const o=v as Record<string,unknown>;
  if(o.version!==1||o.mode!=='simulation'||o.realActionsExecuted!==0||
     Object.keys(o).sort().join('|')!==
     ['createdAt','eligibleAtChange','mode','realActionsExecuted','revision','state','version']
       .sort().join('|'))return null;
  const event=makeFollowPreviewEvent(
    o.state as Exclude<FollowPreviewState,'idle'>,o.revision as number,
    o.eligibleAtChange as number,o.createdAt as string);
  return event&&JSON.stringify(event)===JSON.stringify(o)?event:null;
}
export function transitionFollowPreview(
  current:FollowPreviewState,op:FollowPreviewOperation,
):FollowPreviewState|null{
  if(op==='start'&&(current==='idle'||current==='stopped'))
    return 'simulating';
  if(op==='pause'&&current==='simulating')return 'paused';
  if(op==='resume'&&current==='paused')return 'simulating';
  if(op==='stop'&&(current==='simulating'||current==='paused'))
    return 'stopped';
  return null;
}

export const FOLLOW_PREVIEW_DECISION_ACTION='reference_follow_preview_decision_v1';
export const FOLLOW_PREVIEW_BATCH_SIZE=5;
export const FOLLOW_PREVIEW_BATCH_MIN_MS=7000;
export const FOLLOW_PREVIEW_MAX_CONTROLS=500;
export type PreviewCandidate={
  username:string;referenceId:string;referenceUsername:string;
};
type Candidate={targetUsername:string|null;details:string|null};
type Reference={id:string;username:string};
const isName=(value:unknown):value is string=>
  typeof value==='string'&&/^[a-z0-9._]{1,30}$/.test(value);
const isId=(value:unknown):value is string=>
  typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);

/** Inert candidates from current references only. Old/orphaned references
 * and unverified index records never enter this plan. Reference.enabled is
 * intentionally ignored for SIMULATION, never for a real action.
 */
export function planPreviewEligible(
  rows:readonly Candidate[], references:readonly Reference[],
  accountUsername:string, protectedUsernames:readonly string[],
  previouslyActioned:readonly string[],
):{candidates:PreviewCandidate[];excluded:number;indexed:number}{
  const refs=new Map(references.filter(r=>isId(r.id)&&isName(r.username))
    .map(r=>[r.id,r.username.toLowerCase()]));
  const prohibited=new Set([
    accountUsername.toLowerCase(),...references.map(x=>x.username.toLowerCase()),
    ...protectedUsernames.map(s=>s.toLowerCase()),
    ...previouslyActioned.map(s=>s.toLowerCase()),
  ]);
  const byReference=new Map<string,PreviewCandidate[]>();
  const seen=new Set<string>();
  let excluded=0;
  for(const row of rows){
    const evidence=parseCandidateEvidence(row.details);
    const username=row.targetUsername?.toLowerCase();
    if(!username||!isName(username)||!evidence||
      refs.get(evidence.referenceId)!==evidence.referenceUsername||
      seen.has(username))continue;
    seen.add(username);
    if(prohibited.has(username)){excluded++;continue;}
    const bucket=byReference.get(evidence.referenceId)??[];
    bucket.push({username,referenceId:evidence.referenceId,
      referenceUsername:evidence.referenceUsername});
    byReference.set(evidence.referenceId,bucket);
  }
  // Stable, fair round robin across references (not arbitrary DB row order).
  const buckets=[...byReference.entries()].sort((a,b)=>
    (refs.get(a[0])??'').localeCompare(refs.get(b[0])??''))
    .map(([,value])=>value.sort((a,b)=>a.username.localeCompare(b.username)));
  const candidates:PreviewCandidate[]=[];
  for(let index=0;index<2000;index++){
    let added=false;
    for(const bucket of buckets){
      if(index<bucket.length){candidates.push(bucket[index]);added=true;}
    }
    if(!added)break;
  }
  return {candidates,excluded,indexed:seen.size};
}
export function countPreviewEligible(
  rows:readonly Candidate[], references:readonly Reference[],
  accountUsername:string, protectedUsernames:readonly string[],
  previouslyActioned:readonly string[],
):{eligible:number;excluded:number;indexed:number}{
  const planned=planPreviewEligible(rows,references,accountUsername,
    protectedUsernames,previouslyActioned);
  return {eligible:planned.candidates.length,
    excluded:planned.excluded,indexed:planned.indexed};
}
export type PreviewDecision={
  version:1;mode:'simulation';outcome:'would_follow';
  runId:string;referenceId:string;referenceUsername:string;realActionsExecuted:0;
};
export function makePreviewDecision(
  runId:string,referenceId:string,referenceUsername:string,
):PreviewDecision|null{
  if(!isId(runId)||!isId(referenceId)||!isName(referenceUsername))return null;
  return {version:1,mode:'simulation',outcome:'would_follow',
    runId,referenceId,referenceUsername,realActionsExecuted:0};
}
export function parsePreviewDecision(raw:unknown):PreviewDecision|null{
  if(typeof raw!=='string'||raw.length>500)return null;
  let value:unknown;
  try{value=JSON.parse(raw) as unknown;}catch{return null;}
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const r=value as Record<string,unknown>;
  if(Object.keys(r).sort().join('|')!==
    ['version','mode','outcome','runId','referenceId','referenceUsername',
      'realActionsExecuted'].sort().join('|')||
    r.version!==1||r.mode!=='simulation'||r.outcome!=='would_follow'||
    r.realActionsExecuted!==0)return null;
  const event=makePreviewDecision(r.runId as string,r.referenceId as string,
    r.referenceUsername as string);
  return event&&JSON.stringify(event)===JSON.stringify(r)?event:null;
}
export type PreviewControlRow={id:string;details:string|null};
/** The first start after the previous stop is the immutable run key.
 * Pause/resume never change it; stop preserves progress for viewing.
 * Fail closed on missing/corrupt/out-of-order control history.
 */
export function resolvePreviewRun(
  controls:readonly PreviewControlRow[],
):{state:FollowPreviewState;runId:string|null;revision:number}|null{
  let state:FollowPreviewState='idle',runId:string|null=null,revision=0;
  for(const row of controls){
    if(!isId(row.id))return null;
    const event=parseFollowPreviewEvent(row.details);
    if(!event||event.revision!==revision+1)return null;
    if(event.state==='simulating'&&(state==='idle'||state==='stopped'))
      runId=row.id;
    else if(event.state==='simulating'&&state!=='paused')return null;
    else if(event.state==='paused'&&state!=='simulating')return null;
    else if(event.state==='stopped'&&
       state!=='simulating'&&state!=='paused')return null;
    state=event.state;revision=event.revision;
  }
  return {state,runId,revision};
}
