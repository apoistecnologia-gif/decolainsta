export const dynamic='force-dynamic';
export const runtime='nodejs';

import crypto from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { messagingEnabled,messagingOAuthConfig,
  messagingAuthorizationUrl } from '@/lib/instagram/messaging-oauth';
const COOKIE='decola_ig_messaging_oauth';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
/** Explicit browser-click login. Disabled until separate user authorization. */
export async function GET(request:NextRequest){
  if(!messagingEnabled())return NextResponse.json({
    error:'Integração de mensagens ainda não habilitada',
  },{status:403,headers});
  const config=messagingOAuthConfig();
  if(!config||new URL(config.redirectUri).origin!==request.nextUrl.origin)
    return NextResponse.json({error:'Configuração OAuth incompleta'},
      {status:503,headers});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  if(!userId)return NextResponse.json({error:'Sem sessão'},
    {status:401,headers});
  const accountId=request.nextUrl.searchParams.get('accountId')??'';
  if(!/^[a-zA-Z0-9_-]{15,100}$/.test(accountId))
    return NextResponse.json({error:'Conta inválida'},{status:400,headers});
  const account=await prisma.instagramAccount.findFirst({
    where:{id:accountId,userId},select:{id:true},
  });
  if(!account)return NextResponse.json({error:'Conta indisponível'},
    {status:404,headers});
  const state=account.id+':'+crypto.randomBytes(24).toString('hex');
  const response=NextResponse.redirect(messagingAuthorizationUrl(config,state));
  response.cookies.set(COOKIE,state,{
    httpOnly:true,secure:true,sameSite:'lax',maxAge:600,
    path:'/api/instagram/messaging/callback',
  });
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('Referrer-Policy','no-referrer');
  return response;
}
