export const dynamic='force-dynamic';
export const runtime='nodejs';

import { NextRequest,NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { messagingEnabled } from '@/lib/instagram/messaging-oauth';
import {equalSecret,verifyMetaWebhookSignature,
  extractInboundMessagingReceipts} from '@/lib/instagram/messaging-webhook';
const headers={'Cache-Control':'no-store'};
/** Meta callback handshake; configured only after explicit app authorization. */
export async function GET(req:NextRequest){
  const secret=process.env.INSTAGRAM_MESSAGING_WEBHOOK_VERIFY_TOKEN??'';
  const mode=req.nextUrl.searchParams.get('hub.mode');
  const sent=req.nextUrl.searchParams.get('hub.verify_token')??'';
  const challenge=req.nextUrl.searchParams.get('hub.challenge')??'';
  if(!messagingEnabled()||secret.length<24||mode!=='subscribe'||
    !equalSecret(sent,secret)||!/^[a-zA-Z0-9_-]{1,200}$/.test(challenge))
    return new NextResponse(null,{status:403,headers});
  return new NextResponse(challenge,{status:200,headers:{
    ...headers,'Content-Type':'text/plain; charset=utf-8',
  }});
}
/** Signed incoming DMs only; no message bodies saved and no replies sent. */
export async function POST(req:NextRequest){
  const appSecret=process.env.INSTAGRAM_MESSAGING_WEBHOOK_APP_SECRET??'';
  if(!messagingEnabled()||!appSecret)
    return new NextResponse(null,{status:403,headers});
  const declared=req.headers.get('content-length');
  if(declared&&Number(declared)>65536)
    return new NextResponse(null,{status:413,headers});
  const raw=Buffer.from(await req.arrayBuffer());
  if(raw.length>65536)return new NextResponse(null,{status:413,headers});
  if(!verifyMetaWebhookSignature(raw,req.headers.get('x-hub-signature-256'),
    appSecret))return new NextResponse(null,{status:403,headers});
  let payload:unknown;
  try{payload=JSON.parse(raw.toString('utf8')) as unknown;}
  catch{return new NextResponse(null,{status:400,headers});}
  const receipts=extractInboundMessagingReceipts(payload);
  try{
    for(const receipt of receipts){
      // Globally unique business account ID blocks cross-tenant ambiguity.
      const connection=await prisma.instagramMessagingConnection.findUnique({
        where:{instagramUserId:receipt.instagramUserId},
        select:{instagramAccountId:true},
      });
      if(!connection)continue;
      const now=new Date();
      await prisma.instagramMessagingContact.upsert({
        where:{instagramAccountId_senderIgsid:{
          instagramAccountId:connection.instagramAccountId,
          senderIgsid:receipt.senderIgsid,
        }},
        create:{
          instagramAccountId:connection.instagramAccountId,
          senderIgsid:receipt.senderIgsid,
          firstInboundAt:now,lastInboundAt:now,
        },
        update:{lastInboundAt:now},
      });
    }
  }catch{
    // Retryable failure; don't log webhook contents or identifiers.
    return new NextResponse(null,{status:503,headers});
  }
  return new NextResponse(null,{status:200,headers});
}
