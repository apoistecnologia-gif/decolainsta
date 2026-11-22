export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {inspectApifyPilotConnection} from '@/lib/providers/apify-pilot-readiness';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

/** Admin-only Preview credential check: never launches an Actor or Instagram action. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return NextResponse.json({error:'Não autorizado'},{status:401,headers});
  const operator=await prisma.user.findUnique({
    where:{id:userId},select:{role:true},
  });
  if(operator?.role!=='admin')
    return NextResponse.json({error:'Somente operador'},{status:403,headers});
  const result=await inspectApifyPilotConnection(process.env.APIFY_API_TOKEN);
  return NextResponse.json(result,{headers});
}
