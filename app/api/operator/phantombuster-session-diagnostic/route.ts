export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {inspectPreviousPhantomSessionErrors} from
  '@/lib/providers/phantombuster-session-diagnostic';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

/**
 * Operator-only preview GET. Reads previous provider output, NOT a live
 * Instagram connection test. Does not launch, configure or renew any session.
 */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)
    return NextResponse.json({error:'Não autorizado'},{status:401,headers});
  const operator=await prisma.user.findUnique({
    where:{id:userId},select:{role:true},
  });
  if(operator?.role!=='admin')
    return NextResponse.json({error:'Somente operador'},{status:403,headers});

  const agentId=process.env.PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID??'';
  const apiKey=process.env.PHANTOMBUSTER_API_KEY;
  const accountAlias=process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??'';
  const savedAccount=await prisma.instagramAccount.findFirst({
    where:{userId,username:accountAlias},
    select:{id:true,instagramUserId:true},
  });
  if(!isConfiguredPhantomBusterKey(apiKey) ||
      !/^\d{10,25}$/.test(agentId))
    return NextResponse.json({
      status:'not-configured',agentConfigured:false,
      accountAliasMatched:Boolean(savedAccount),
      officialMetaConnectionRecorded:Boolean(savedAccount?.instagramUserId),
      evidence:'none',instagramSessionVerifiedNow:false,
      passwordChangeImpactConfirmed:false,providerActionsExecuted:0,
    },{headers});

  const checked=await inspectPreviousPhantomSessionErrors(apiKey!,agentId);
  return NextResponse.json({
    ...checked,agentConfigured:true,
    accountAliasMatched:Boolean(savedAccount),
    officialMetaConnectionRecorded:Boolean(savedAccount?.instagramUserId),
  },{headers});
}
