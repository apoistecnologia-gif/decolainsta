export const dynamic='force-dynamic';
export const runtime='nodejs';

import { NextRequest,NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/encryption';
import { equalSecret } from '@/lib/instagram/messaging-webhook';
import { messagingEnabled,messagingOAuthConfig,
  exchangeMessagingOAuth } from '@/lib/instagram/messaging-oauth';

const COOKIE='decola_ig_messaging_oauth';
/** Only a previously authorized, same-user consent redirect can connect. */
export async function GET(request:NextRequest){
  if(!messagingEnabled())
    return NextResponse.json({error:'Integração desativada'},{status:403});
  const config=messagingOAuthConfig();
  if(!config||new URL(config.redirectUri).origin!==request.nextUrl.origin)
    return NextResponse.json({error:'OAuth indisponível'},{status:503});
  const session=await auth();
  const userId=(session?.user as {id?:string}|undefined)?.id;
  const expected=request.cookies.get(COOKIE)?.value??'';
  const supplied=request.nextUrl.searchParams.get('state')??'';
  const code=request.nextUrl.searchParams.get('code')??'';
  let status='not-connected';
  try{
    if(!userId||!expected||!equalSecret(supplied,expected)||
      !/^[a-zA-Z0-9_-]{15,100}:[a-f0-9]{48}$/.test(expected)||
      request.nextUrl.searchParams.has('error')||!code)
      throw Error('invalid');
    const accountId=expected.split(':')[0];
    const account=await prisma.instagramAccount.findFirst({
      where:{id:accountId,userId},select:{id:true,username:true},
    });
    if(!account)throw Error('no-account');
    const token=await exchangeMessagingOAuth(config,code);
    if(!token||token.username.toLowerCase()!==account.username.toLowerCase())
      throw Error('wrong-instagram-account');
    await prisma.instagramMessagingConnection.upsert({
      where:{instagramAccountId:account.id},
      create:{
        instagramAccountId:account.id,instagramUserId:token.id,
        encryptedAccessToken:encrypt(token.accessToken),
        tokenExpiresAt:new Date(Date.now()+token.expiresIn*1000),
      },
      update:{
        instagramUserId:token.id,
        encryptedAccessToken:encrypt(token.accessToken),
        tokenExpiresAt:new Date(Date.now()+token.expiresIn*1000),
      },
    });
    status='connected';
  }catch{
    // No raw codes, tokens or identity information in redirect or logs.
  }
  const redirect=NextResponse.redirect(new URL(
    '/references/diagnostics?messaging='+status,request.nextUrl.origin));
  redirect.cookies.set(COOKIE,'',{
    httpOnly:true,secure:true,sameSite:'lax',maxAge:0,
    path:'/api/instagram/messaging/callback',
  });
  redirect.headers.set('Cache-Control','private, no-store');
  redirect.headers.set('Referrer-Policy','no-referrer');
  return redirect;
}
