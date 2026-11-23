/** Dedicated, read-only evidence parser for the first Apify follow request.
 * An Instagram UI observation reported by the account operator proves neither
 * follow acceptance nor the third-party Actor's ongoing authorization.
 */
export const APIFY_FOLLOW_OBSERVATION_ACTION=
 'apify_pilot_relationship_observation_v1';
export type OperatorFollowObservation=Readonly<{
 version:1;
 accountInstagramUserId:'17841411544892772';
 targetUsername:string;
 runId:string;
 relationship:'requested_pending';
 source:'operator_reported_instagram_ui';
 followAccepted:false;
 followIndependentlyVerified:false;
 automatedUnfollowEnabled:false;
}>;
const validUsername=(v:unknown):v is string=>
 typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
const validRunId=(v:unknown):v is string=>
 typeof v==='string'&&/^[A-Za-z0-9]{17,24}$/.test(v);
export function parseOperatorFollowObservation(raw:unknown):
 OperatorFollowObservation|null{
 if(typeof raw!=='string'||raw.length>1000)return null;
 let input:unknown;
 try{input=JSON.parse(raw);}catch{return null;}
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const v=input as Record<string,unknown>;
 const allowed=[
  'version','accountInstagramUserId','targetUsername','runId',
  'relationship','source','followAccepted',
  'followIndependentlyVerified','automatedUnfollowEnabled',
 ];
 if(Object.keys(v).length!==allowed.length||
    Object.keys(v).some(k=>!allowed.includes(k))||
    v.version!==1||
    v.accountInstagramUserId!=='17841411544892772'||
    !validUsername(v.targetUsername)||!validRunId(v.runId)||
    v.relationship!=='requested_pending'||
    v.source!=='operator_reported_instagram_ui'||
    v.followAccepted!==false||
    v.followIndependentlyVerified!==false||
    v.automatedUnfollowEnabled!==false)return null;
 return v as OperatorFollowObservation;
}
export function matchOperatorFollowObservation(
 raw:unknown,
 expected:{targetUsername:string;runId:string|null},
):OperatorFollowObservation|null{
 if(!validRunId(expected.runId)||!validUsername(expected.targetUsername))
  return null;
 const obs=parseOperatorFollowObservation(raw);
 return obs&&obs.targetUsername===expected.targetUsername&&
   obs.runId===expected.runId?obs:null;
}
