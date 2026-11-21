export const dynamic='force-dynamic';
export const runtime='nodejs';
import {timingSafeEqual} from 'node:crypto';
import {NextResponse} from 'next/server';
import {runPreviewFollowSimulationCron} from '@/lib/server/reference-follow-preview-cron';

const HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
function authorized(request:Request){
 const secret=process.env.CRON_SECRET;
 if(!secret||secret.length<32)return false;
 const given=Buffer.from(request.headers.get('authorization')??'','utf8');
 const expected=Buffer.from('Bearer '+secret,'utf8');
 return given.length===expected.length&&timingSafeEqual(given,expected);
}
export async function GET(request:Request){
 if(process.env.VERCEL_ENV!=='preview')
   return NextResponse.json({error:'Somente Preview'}, {status:403,headers:HEADERS});
 if(!authorized(request))
   return NextResponse.json({error:'Não autorizado'}, {status:401,headers:HEADERS});
 return NextResponse.json(await runPreviewFollowSimulationCron(),{headers:HEADERS});
}
