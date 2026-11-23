import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {makeApifyCandidateEvidence} from '../lib/reference-candidate-queue';
import {planOneFollowFromSavedReferences} from '../lib/providers/apify-pilot-candidate-selection';

const identity={
 instagramUserId:'17841411544892772',
 username:'apoistecnologia',
 previousUsernames:['contateste6699'],
};
const reference={id:'cmwptx8ho0003jw08h07b2zrp',
 username:'prefeituradepetrolina',enabled:true};
const evidence=JSON.stringify(makeApifyCandidateEvidence(
 reference.id,reference.username,'cmwr76fiy0001mn02q7plhm1n',
 'NyjWX6l7ULqZft3Rd'));
const item=(id:string,targetUsername:string,details=evidence)=>
 ({id,targetUsername,details});

test('disabled collection flag preserves saved candidates for read-only planning',()=>{
 const plan=planOneFollowFromSavedReferences({
  identity,references:[{...reference,enabled:false}],
  candidates:[item('a','perfil_publico_teste')],
  protectedUsernames:[],previouslyAttemptedUsernames:[],
 });
 assert.deepEqual(plan,{totalReferences:1,enabledReferences:0,
  eligibleCount:1,next:{username:'perfil_publico_teste',
   referenceUsername:'prefeituradepetrolina'}});
});

test('one candidate automatically chosen only from enabled, matching reference',()=>{
 const plan=planOneFollowFromSavedReferences({
  identity,references:[reference],
  candidates:[
   item('self','contateste6699'),item('self2','apoistecnologia'),
   item('ref','prefeituradepetrolina'),
   item('bad','outro_perfil',JSON.stringify({
    ...JSON.parse(evidence),referenceUsername:'another_reference',
   })),
   item('protected','protegida'),
   item('already','seguida'),
   item('valid','destino_valido'),
   item('duplicate','destino_valido'),
   item('last','outro_destino'),
  ],
  protectedUsernames:['protegida'],
  previouslyAttemptedUsernames:['seguida'],
 });
 assert.deepEqual(plan,{
  totalReferences:1,enabledReferences:1,eligibleCount:2,
  next:{username:'destino_valido',referenceUsername:'prefeituradepetrolina'},
 });
});

test('removed references, malformed and mismatched evidence never become selectable',()=>{
 const plan=planOneFollowFromSavedReferences({
  identity,references:[reference],
  candidates:[
   item('a','legit',JSON.stringify({
    ...JSON.parse(evidence),referenceId:'reference_removed',
   })),
   item('b','legit2','{}'),
   item('c','legit3',JSON.stringify({...JSON.parse(evidence),
    actionsEnabled:true})),
   item('d','bad username'),
  ],
  protectedUsernames:[],previouslyAttemptedUsernames:[],
 });
 assert.equal(plan.eligibleCount,0);
 assert.equal(plan.next,null);
});

test('Preview status uses real saved references and never launches follow',()=>{
 const route=readFileSync('app/api/operator/apify/one-follow/route.ts','utf8');
 const ui=readFileSync(
  'app/(app)/references/_components/apify-one-follow-test.tsx','utf8');
 assert.match(route,/enabled:true/);
 assert.match(route,/planOneFollowFromSavedReferences/);
 assert.match(route,/account\.dryMode/);
 assert.match(route,/historical-run-unresolved/);
 assert.match(route,/canLaunch:false/);
 assert.match(ui,/Referências cadastradas:/);
 assert.match(ui,/Candidatos das referências cadastradas/);
 assert.match(ui,/Novo follow bloqueado/);
 assert.doesNotMatch(route,/startOneFollow\(/);
});
