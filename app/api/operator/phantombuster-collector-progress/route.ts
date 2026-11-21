export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {isConfiguredPhantomBusterKey} from '@/lib/reference-audience-readiness';
import {inspectExistingReferenceCollector} from
  '@/lib/providers/phantombuster-collector-progress';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

/** Operator-only Preview read: never starts an Instagram collection. */
export async function GET() {
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers:HEADERS});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId) return NextResponse.json({error:'Não autorizado'},
    {status:401,headers:HEADERS});
  const operator=await prisma.user.findUnique({
    where:{id:userId},select:{role:true},
  });
  if(operator?.role!=='admin')
    return NextResponse.json({error:'Somente operador'},
      {status:403,headers:HEADERS});

  const reference=process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE??'';
  const apiKey=process.env.PHANTOMBUSTER_API_KEY;
  if(!isConfiguredPhantomBusterKey(apiKey) ||
    !/^[a-z0-9._]{1,30}$/.test(reference))
    return NextResponse.json({
      status:'not-configured',reference:null,latestRunSeen:false,
      instagramSessionVerifiedByProvider:false,
      resultsAttributedToSavedReference:false,
      newFollowersOnOwnAccount:0,followsExecutedByDiagnostic:0,
    },{headers:HEADERS});
  const progress=await inspectExistingReferenceCollector(apiKey!,reference);
  return NextResponse.json(progress,{headers:HEADERS});
}
