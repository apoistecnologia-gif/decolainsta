/** Read-only selection for a future ONE-action Apify feasibility test.
 * Saved follower candidates are leads, NOT proof that a follow is permitted
 * or happened. This module never writes to Instagram, Apify or the database.
 */
import {parseCandidateEvidence} from '@/lib/reference-candidate-queue';
import {isSelfFollowTarget,type InstagramExecutorIdentity} from '@/lib/providers/apify-one-follow';

export type PilotReference=Readonly<{id:string;username:string;enabled:boolean}>;
export type PilotCandidate=Readonly<{
 id:string;targetUsername:string|null;details:string|null;
}>;
export type PilotSelection=Readonly<{
 eligibleCount:number;
 enabledReferences:number;
 totalReferences:number;
 next:Readonly<{username:string;referenceUsername:string}>|null;
}>;

const validUsername=(value:string):boolean=>/^[a-z0-9._]{1,30}$/.test(value);
/** Intentionally deterministic: same historical source yields same first
 * candidate until a durable follow-attempt record excludes that name.
 */
export function planOneFollowFromSavedReferences(input:Readonly<{
 identity:InstagramExecutorIdentity;
 references:readonly PilotReference[];
 candidates:readonly PilotCandidate[];
 protectedUsernames:readonly string[];
 previouslyAttemptedUsernames:readonly string[];
}>):PilotSelection{
 const enabled=input.references.filter(ref=>ref.enabled&&
  /^[a-zA-Z0-9_-]{1,100}$/.test(ref.id)&&
  validUsername(ref.username.toLowerCase()));
 const names=new Map(enabled.map(ref=>[ref.id,ref.username.toLowerCase()]));
 const excluded=new Set([
  ...input.references.map(ref=>ref.username),
  ...input.protectedUsernames,...input.previouslyAttemptedUsernames,
  input.identity.username,...input.identity.previousUsernames,
 ].map(name=>name.trim().replace(/^@/,'').toLowerCase()));
 const seen=new Set<string>();
 let next:PilotSelection['next']=null;
 for(const candidate of input.candidates){
  if(!candidate.targetUsername)continue;
  const username=candidate.targetUsername.toLowerCase();
  if(!validUsername(username)||seen.has(username)||excluded.has(username)||
    isSelfFollowTarget(username,input.identity))continue;
  const evidence=parseCandidateEvidence(candidate.details);
  if(!evidence||evidence.status!=='identified_unverified')continue;
  const referenceUsername=names.get(evidence.referenceId);
  if(!referenceUsername||referenceUsername!==evidence.referenceUsername)continue;
  seen.add(username);
  if(!next)next={username,referenceUsername};
 }
 return {
  eligibleCount:seen.size,enabledReferences:enabled.length,
  totalReferences:input.references.length,next,
 };
}
