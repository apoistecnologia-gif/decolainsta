export const dynamic='force-dynamic';
export const runtime='nodejs';
import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {inspectExistingAutoUnfollowAgent} from
  '@/lib/providers/phantombuster-unfollow-readiness';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
/** Read-only status; never starts or updates any PhantomBuster agent. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers});
  const session=await auth();
  const uid=(session?.user as {id?:string}|undefined)?.id;
  if(!uid)return NextResponse.json({error:'Não autorizado'},
    {status:401,headers});
  const operator=await prisma.user.findUnique({
    where:{id:uid},select:{role:true},
  });
  if(operator?.role!=='admin')
    return NextResponse.json({error:'Somente operador'},
      {status:403,headers});
  const account=await prisma.instagramAccount.findFirst({
    where:{userId:uid,username:process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT??''},
    select:{id:true},
  });
  const id=process.env.PHANTOMBUSTER_SOCIAL_PILOT_UNFOLLOW_AGENT_ID??'';
  const apiKey=process.env.PHANTOMBUSTER_API_KEY;
  const linked=Boolean(account&&/^\d{10,25}$/.test(id));
  const result=linked&&isConfiguredPhantomBusterKey(apiKey)
    ?await inspectExistingAutoUnfollowAgent(apiKey!,id)
    :'unconfigured';
  return NextResponse.json({
    linked,verification:result,
    providerProtectsFollowBack:result==='ready-for-review',
    safeToExecuteAutomatically:false,
    actionEnabled:false,
    scheduleEnabled:false,
    reason:!linked?'separate_agent_not_registered':
      result==='ready-for-review'?'requires_verified_target_and_consent':
      'provider_protection_unverified',
  },{headers});
}
