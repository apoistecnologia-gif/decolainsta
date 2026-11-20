/**
 * PhantomBuster may resolve a different workspace without the explicit
 * X-Phantombuster-Org header. Server-controlled only; never accept a client
 * provided org or send these headers to URLs outside api.phantombuster.com.
 *
 * The environment variable is optional, and the existing behavior remains
 * unchanged for deployments without an authorized org ID.
 */
export function phantomBusterRequestHeaders(
  apiKey: string,
  orgId: string | undefined = process.env.PHANTOMBUSTER_ORG_ID,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Phantombuster-Key': apiKey,
  };
  if (orgId && /^[0-9]{10,25}$/.test(orgId))
    headers['X-Phantombuster-Org'] = orgId;
  return headers;
}
