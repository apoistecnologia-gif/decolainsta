export const dynamic='force-dynamic';
export const runtime='nodejs';

import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {prisma} from '@/lib/db';
import {
 APIFY_ONE_FOLLOW_ACTION,APIFY_ONE_FOLLOW_ACTOR,
 inspectOneFollow,
} from '@/lib/providers/apify-one-follow';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const EXECUTOR_ID='17841411544892772';
const ORIGINAL_RUN_ID='nd88TvRT6EOn8IC1O';
const OLD_USERNAME='contateste6699';
const respond=(status:string,extra:Record<string,unknown>={})=>
 NextResponse.json({
  status,actorRunsLaunched:0,instagramActionsExecuted:0,
  independentlyVerified:false,unfollowEnabled:false,
  noAutomaticRetry:true,...extra,
 },{headers});
function authorized(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||secret.length<32)return false;
 const received=Buffer.from(request.headers.get('authorization')??'','utf8');
 const expected=Buffer.from('Bearer '+secret,'utf8');
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
/** Server-only reconciliation of the SINGLE previous run.
 * Never sends Instagram cookies, never calls Apify's POST /runs,
 * never launches or schedules Instagram operations.
 * Historical attempt is updated only with a CAS match on its original JSON.
 */
export async function GET(request:Request){
 if(process.env.VERCEL_ENV!=='preview')
  return NextResponse.json({error:'Somente Preview'},{status:403,headers});
 if(!authorized(request))
  return NextResponse.json({error:'Não autorizado'},{status:401,headers});
 const token=process.env.APIFY_API_TOKEN;
 if(!token)return respond('unavailable');
 const accounts=await prisma.instagramAccount.findMany({
  where:{instagramUserId:EXECUTOR_ID},select:{id:true},take:2,
 });
 if(accounts.length!==1)return respond('history-invalid');
 const row=await prisma.activityLog.findFirst({
  where:{instagramAccountId:accounts[0].id,
   action:APIFY_ONE_FOLLOW_ACTION},
  select:{id:true,details:true,targetUsername:true,success:true},
  orderBy:{createdAt:'desc'},
 });
 if(!row)return respond('no-pending-run');
 let data:Record<string,unknown>;
 try{
  const parsed=JSON.parse(row.details??'');
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
   return respond('history-invalid');
  data=parsed as Record<string,unknown>;
 }catch{return respond('history-invalid');}
 if(data.version!==1||data.actor!==APIFY_ONE_FOLLOW_ACTOR||
    data.accountId!==accounts[0].id||
    data.accountUsername!=='apoistecnologia'||
    row.targetUsername!==OLD_USERNAME||
    data.targetUsername!==OLD_USERNAME||
    data.runId!==ORIGINAL_RUN_ID||
    data.independentlyVerified!==false||
    data.automatedUnfollowEnabled!==false||
    row.success!==false)return respond('history-invalid');
 if(data.state!=='launched')
  return respond('no-pending-run',{
   providerReportedFollow:data.providerReportedFollow===true,
   costUsd:typeof data.costUsd==='number'?data.costUsd:null,
  });
 // Exactly ONE read-only remote inspection, with no Instagram credentials.
 const outcome=await inspectOneFollow(token,ORIGINAL_RUN_ID,OLD_USERNAME);
 if(outcome.status==='running'||outcome.status==='unavailable')
  return respond(outcome.status,{costUsd:outcome.costUsd});
 const state=outcome.status;
 const next={...data,state,costUsd:outcome.costUsd,
  providerReportedFollow:outcome.providerReportedFollow,
  independentlyVerified:false,automatedUnfollowEnabled:false};
 try{
  const result=await prisma.activityLog.updateMany({
   where:{id:row.id,instagramAccountId:accounts[0].id,
    action:APIFY_ONE_FOLLOW_ACTION,
    details:row.details,success:false},
   data:{details:JSON.stringify(next),success:false},
  });
  if(result.count!==1)return respond('concurrent');
 }catch{return respond('unavailable');}
 return respond(state,{
  costUsd:outcome.costUsd,
  providerReportedFollow:outcome.providerReportedFollow,
 });
}
