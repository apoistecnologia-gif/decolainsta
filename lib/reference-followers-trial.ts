/**
 * One-shot Followers Auto Follow request evidence. Unlike a manual follower
 * report, a launch cannot prove an Instagram follow (provider picks recipient).
 */
export const FOLLOWERS_TRIAL_ACTION = 'reference_followers_trial_v1';
export const FOLLOWERS_TRIAL_APPROVAL = 'AUTHORIZE_ONE_FOLLOWERS_PHANTOM_TEST';
export const FOLLOWERS_RELATIONSHIP_OBSERVATION_ACTION =
  'reference_followers_relationship_observation_v1';
export type ObservedRelationship = 'requested' | 'following' | 'none';
export function observedRelationship(v:unknown):v is ObservedRelationship {
  return v==='requested'||v==='following'||v==='none';
}
export function shouldStartUnfollowClock(input:{
  relationship:ObservedRelationship|'unknown';
  verifiedFollowAt:Date|null;
}):boolean{
  // A pending request cannot start the 48-hour countdown.
  // For a 'following' observation, verification must still be independent.
  return input.relationship==='following' && input.verifiedFollowAt instanceof Date &&
    Number.isFinite(input.verifiedFollowAt.getTime());
}


export type TrialStage = 'reserved' | 'launch-accepted' | 'uncertain' |
  'container-finished' | 'container-failed' | 'provider-reported';
export type TrialEvidence = {
  version: 1;
  referenceId: string;
  agentId: string;
  stage: TrialStage;
  containerId?: string;
  followConfirmed: false;
  sessionOwnerVerifiedByProvider: false;
  recipientKnown: false;
  providerReportedUsername?: string;
  providerReportedCount?: 1;
  relationshipObservation?: ObservedRelationship;
  relationshipObservedAt?: string;
  relationshipSource?: 'owner-visual-check';
};
const id=(value:unknown):value is string=>typeof value==='string'&&
  /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const agent=(value:unknown):value is string=>typeof value==='string'&&
  /^\d{10,25}$/.test(value);
export function makeTrialEvidence(value:TrialEvidence):TrialEvidence|null {
  if(value.version!==1||!id(value.referenceId)||!agent(value.agentId)||
      !['reserved','launch-accepted','uncertain','container-finished',
        'container-failed','provider-reported'].includes(value.stage)||
      value.followConfirmed!==false||value.sessionOwnerVerifiedByProvider!==false||
      value.recipientKnown!==false||
      (value.containerId!==undefined&&!agent(value.containerId))||
      (['launch-accepted','container-finished','container-failed',
        'provider-reported'].includes(value.stage)&&!value.containerId)||
      (value.stage==='provider-reported'
        ? !(typeof value.providerReportedUsername==='string'&&
            /^[a-z0-9._]{1,30}$/.test(value.providerReportedUsername)&&
            value.providerReportedCount===1)
        : value.providerReportedUsername!==undefined||
          value.providerReportedCount!==undefined)||
      (value.relationshipObservation!==undefined &&
        (value.stage!=='provider-reported'||
          !observedRelationship(value.relationshipObservation)||
          value.relationshipSource!=='owner-visual-check'||
          typeof value.relationshipObservedAt!=='string'||
          !/^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$/.test(value.relationshipObservedAt)||
          !Number.isFinite(Date.parse(value.relationshipObservedAt))))||
      (value.relationshipObservation===undefined &&
        (value.relationshipObservedAt!==undefined||
          value.relationshipSource!==undefined)))
    return null;
  return {...value};
}
export function parseTrialEvidence(input:unknown):TrialEvidence|null {
  if(typeof input!=='string'||input.length>600)return null;
  let decoded:unknown;
  try{decoded=JSON.parse(input) as unknown;}catch{return null;}
  if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))return null;
  const r=decoded as Record<string,unknown>;
  if(Object.keys(r).some(key=>![
    'version','referenceId','agentId','stage','containerId',
    'followConfirmed','sessionOwnerVerifiedByProvider','recipientKnown',
    'providerReportedUsername','providerReportedCount',
    'relationshipObservation','relationshipObservedAt','relationshipSource',
  ].includes(key)))return null;
  return makeTrialEvidence(r as TrialEvidence);
}
