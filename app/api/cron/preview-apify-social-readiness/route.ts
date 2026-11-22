export const dynamic='force-dynamic';
export const runtime='nodejs';

import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {inspectApifySocialActors} from '@/lib/providers/apify-social-actors-readiness';

const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const authorize=(request:Request)=>{
  const secret=process.env.CRON_SECRET;
  if(!secret||secret.length<32)return false;
  const actual=Buffer.from(request.headers.get('authorization')??'','utf8');
  const expected=Buffer.from('Bearer '+secret,'utf8');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
};
/** Read only three publicly listed Apify Actor metadata endpoints.
 * Never creates Actor runs or accesses any Instagram session.
 */
export async function GET(request:Request){
  if(process.env.VERCEL_ENV!=='preview')
    return NextResponse.json({error:'Somente Preview'},{
      status:403,headers});
  if(!authorize(request))
    return NextResponse.json({error:'Não autorizado'},{
      status:401,headers});
  const readiness=await inspectApifySocialActors(process.env.APIFY_API_TOKEN);
  return NextResponse.json(readiness,{headers});
}
