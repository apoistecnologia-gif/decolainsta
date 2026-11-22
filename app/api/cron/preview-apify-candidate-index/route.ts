export const dynamic='force-dynamic';
export const runtime='nodejs';

import {timingSafeEqual} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {NextResponse} from 'next/server';
import {prisma} from '@/lib/db';
import {indexSavedApifyCandidates} from '@/lib/server/apify-candidate-index';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const deny=(status:number)=>NextResponse.json({
  status:'blocked',indexed:0,instagramActionsExecuted:0,
  providerRunsExecuted:0,
},{status,headers});
function authorized(request:Request):boolean{
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32)return false;
  const actual=Buffer.from(request.headers.get('authorization')??'');
  const expected=Buffer.from('Bearer '+secret);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

/** Index only the existing, finished Apify trial, no provider calls.
 * Production, other customers, follow/unfollow and automatic Instagram
 * execution remain unavailable.
 */
export async function POST(request:Request){
  if(process.env.VERCEL_ENV!=='preview'||
     process.env.PREVIEW_APIFY_INDEX_ENABLED!=='yes')
    return deny(403);
  if(!authorized(request))return deny(401);
  if(!request.headers.get('content-type')?.startsWith('application/json'))
    return deny(415);
  const raw=await request.text().catch(()=>'');
  if(raw!=='{"operation":"index-existing"}')return deny(400);
  if(process.env.PREVIEW_APIFY_PILOT_REFERENCE!=='prefeituradepetrolina')
    return deny(409);
  const alias=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT
    ?.replace(/^@/,'').toLowerCase()??'';
  if(!/^[a-z0-9._]{1,30}$/.test(alias))return deny(409);
  const accounts=await prisma.instagramAccount.findMany({
    where:{username:alias},select:{id:true},take:2,
  });
  if(accounts.length!==1)return deny(409);
  const accountId=accounts[0].id;
  const refs=await prisma.targetAccount.findMany({
    where:{instagramAccountId:accountId,username:'prefeituradepetrolina'},
    select:{id:true,username:true},take:2,
  });
  if(refs.length!==1)return deny(409);
  for(let n=0;n<3;n++){
    try{
      const result=await prisma.$transaction(async tx=>{
        const lock=await tx.$queryRaw<Array<{acquired:boolean}>>`
          SELECT pg_try_advisory_xact_lock(
            hashtext('decolainsta_apify_25_index_v1'),
            hashtext(${accountId})
          ) AS acquired
        `;
        if(lock.length!==1||lock[0].acquired!==true)return null;
        return indexSavedApifyCandidates(
          tx,accountId,refs[0].id,refs[0].username);
      },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
      if(!result)return deny(409);
      return NextResponse.json({...result,providerRunsExecuted:0,
        actionsEnabled:false},{headers});
    }catch(err){
      if((err as {code?:string})?.code!=='P2034'||n===2)return deny(503);
    }
  }
  return deny(503);
}
