/** Signed Meta messaging webhook validation; never exports message bodies. */
import crypto from 'node:crypto';
const object=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)
    ?v as Record<string,unknown>:null;
const numeric=(v:unknown):v is string=>
  typeof v==='string'&&/^\d{5,30}$/.test(v);
export function equalSecret(a:string,b:string){
  const first=Buffer.from(a);const second=Buffer.from(b);
  return first.length===second.length&&crypto.timingSafeEqual(first,second);
}
export function verifyMetaWebhookSignature(
  raw:Buffer,signature:string|null,appSecret:string,
):boolean{
  if(!appSecret||appSecret.length<12||appSecret.length>512||
    !signature||!/^sha256=[a-fA-F0-9]{64}$/.test(signature))
    return false;
  const digest=crypto.createHmac('sha256',appSecret).update(raw).digest('hex');
  return equalSecret(digest,signature.slice(7).toLowerCase());
}
export type InboundMessagingReceipt={
  instagramUserId:string;
  senderIgsid:string;
  // Observed by a signature-verified webhook, not a general marketing opt-in.
  source:'meta-signed-inbound-message';
};
export function extractInboundMessagingReceipts(value:unknown):
  InboundMessagingReceipt[]{
  const payload=object(value);
  if(!payload||payload.object!=='instagram'||!Array.isArray(payload.entry)||
    payload.entry.length>20)return [];
  const receipts:InboundMessagingReceipt[]=[];
  const dedupe=new Set<string>();
  for(const item of payload.entry){
    const entry=object(item);
    if(!entry||!numeric(entry.id)||!Array.isArray(entry.messaging)||
      entry.messaging.length>50)continue;
    for(const raw of entry.messaging){
      const event=object(raw),sender=object(event?.sender);
      const recipient=object(event?.recipient);
      const message=object(event?.message);
      if(!numeric(sender?.id)||!numeric(recipient?.id)||
        recipient.id!==entry.id||sender.id===recipient.id||
        !message||typeof message.mid!=='string'||
        message.mid.length<3||message.mid.length>400||
        message.is_echo===true)continue;
      const key=entry.id+':'+sender.id;
      if(!dedupe.has(key)){
        dedupe.add(key);
        receipts.push({instagramUserId:entry.id,senderIgsid:sender.id,
          source:'meta-signed-inbound-message'});
      }
    }
  }
  return receipts.slice(0,100);
}
