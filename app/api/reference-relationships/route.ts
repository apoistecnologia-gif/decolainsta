export const dynamic='force-dynamic';
export const runtime='nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { FOLLOWERS_TRIAL_ACTION } from '@/lib/reference-followers-trial';
import { summarizeTrialRelationships } from '@/lib/reference-trial-relationship-summary';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function GET(req:Request){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers:HEADERS});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return NextResponse.json({error:'Não autorizado'},
    {status:401,headers:HEADERS});
  const accountId=new URL(req.url).searchParams.get('accountId');
  if(!accountId||accountId.length>100||!/^[a-zA-Z0-9_-]+$/.test(accountId))
    return NextResponse.json({error:'Conta inválida'},
      {status:400,headers:HEADERS});
  const account=await prisma.instagramAccount.findFirst({
    where:{id:accountId,userId},select:{id:true},
  });
  if(!account)return NextResponse.json({error:'Conta não encontrada'},
    {status:404,headers:HEADERS});
  const rows=await prisma.activityLog.findMany({
    where:{instagramAccountId:account.id,action:FOLLOWERS_TRIAL_ACTION},
    select:{details:true,createdAt:true},
    orderBy:[{createdAt:'desc'},{id:'desc'}],take:1001,
  });
  if(rows.length>1000)
    return NextResponse.json({error:'Histórico exige revisão do operador'},
      {status:409,headers:HEADERS});
  return NextResponse.json(summarizeTrialRelationships(rows),{headers:HEADERS});
}
