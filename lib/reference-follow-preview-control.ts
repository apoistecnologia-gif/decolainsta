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
type Candidate={targetUsername:string|null;details:string|null};
type Reference={id:string;username:string};
export function countPreviewEligible(
  rows:readonly Candidate[], references:readonly Reference[],
  accountUsername:string, protectedUsernames:readonly string[],
  previouslyActioned:readonly string[],
):{eligible:number;excluded:number;indexed:number}{
  const names=new Map(references.map(x=>[x.id,x.username.toLowerCase()]));
  const prohibited=new Set([
    accountUsername.toLowerCase(),
    ...references.map(x=>x.username.toLowerCase()),
    ...protectedUsernames.map(s=>s.toLowerCase()),
    ...previouslyActioned.map(s=>s.toLowerCase()),
  ]);
  const accepted=new Set<string>(),seen=new Set<string>();
  let excluded=0;
  for(const row of rows){
    const evidence=parseCandidateEvidence(row.details);
    const username=row.targetUsername?.toLowerCase();
    if(!username||!evidence||
       names.get(evidence.referenceId)!==evidence.referenceUsername)continue;
    if(seen.has(username))continue;
    seen.add(username);
    if(prohibited.has(username))excluded++;
    else accepted.add(username);
  }
  return {eligible:accepted.size,excluded,indexed:seen.size};
}
