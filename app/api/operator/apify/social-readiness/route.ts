export const dynamic='force-dynamic';
export const runtime='nodejs';

import {NextResponse} from 'next/server';
import {auth} from '@/auth';
import {prisma} from '@/lib/db';
import {inspectApifySocialActors} from '@/lib/providers/apify-social-actors-readiness';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};

/** Operator-only Preview inspection of Apify actor metadata, no social action. */
export async function GET(){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{status:403,headers});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return NextResponse.json({error:'Não autorizado'},{status:401,headers});
  const user=await prisma.user.findUnique({
    where:{id:userId},select:{role:true},
  });
  if(user?.role!=='admin')
    return NextResponse.json({error:'Somente operador'},{status:403,headers});
  const state=await inspectApifySocialActors(process.env.APIFY_API_TOKEN);
  return NextResponse.json(state,{headers});
}
