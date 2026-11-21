/**
 * Use the already configured Decola Social Meta App Secret for Instagram
 * webhook HMAC validation only when explicitly approved and on the SAME app.
 * Never forward the secret to clients or diagnostic endpoints.
 */
export function resolveMessagingWebhookAppSecret(
  env:Record<string,string|undefined>=process.env,
):string{
  const dedicated=env.INSTAGRAM_MESSAGING_WEBHOOK_APP_SECRET;
  if(dedicated&&dedicated.length>=12&&dedicated.length<=512)return dedicated;
  if(env.VERCEL_ENV!=='preview'||
    env.INSTAGRAM_MESSAGING_REUSE_EXISTING_META_APP!=='yes'||
    !/^\d{5,30}$/.test(env.INSTAGRAM_APP_ID??'')||
    (env.INSTAGRAM_MESSAGING_APP_ID&&
      env.INSTAGRAM_MESSAGING_APP_ID!==env.INSTAGRAM_APP_ID))
    return '';
  const sameAppSecret=env.INSTAGRAM_APP_SECRET??'';
  return sameAppSecret.length>=12&&sameAppSecret.length<=512
    ?sameAppSecret:'';
}
