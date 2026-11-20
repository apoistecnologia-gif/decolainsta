export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { inspectFollowersAutoFollowAgent } from '@/lib/providers/phantombuster-followers-auto-follow';

const HEADERS = { 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' };

/**
 * Operator-only, read-only readiness check for the already saved follower
 * agent. Does not call /agents/launch, /agents/save or Instagram.
 * A configured provider session must still be checked by the account owner.
 */
export async function GET() {
  if (process.env.VERCEL_ENV !== 'preview')
    return NextResponse.json({ error:'Somente Preview' },
      { status:403, headers:HEADERS });
  const session = await auth();
  const userId = (session?.user as { id?:string } | undefined)?.id;
  if (!userId)
    return NextResponse.json({ error:'Não autorizado' },
      { status:401, headers:HEADERS });
  const operator = await prisma.user.findUnique({
    where:{ id:userId }, select:{ role:true },
  });
  if (operator?.role !== 'admin')
    return NextResponse.json({ error:'Acesso restrito ao operador' },
      { status:403, headers:HEADERS });

  const accountUsername = process.env.PHANTOMBUSTER_SOCIAL_PILOT_ACCOUNT ?? '';
  const referenceUsername = process.env.PHANTOMBUSTER_SOCIAL_PILOT_REFERENCE ?? '';
  const agentId = process.env.PHANTOMBUSTER_SOCIAL_PILOT_FOLLOW_AGENT_ID ?? '';
  const apiKey = process.env.PHANTOMBUSTER_API_KEY;
  const configured = /^[a-z0-9._]{1,30}$/.test(accountUsername) &&
    /^[a-z0-9._]{1,30}$/.test(referenceUsername) &&
    /^\d{10,25}$/.test(agentId) &&
    isConfiguredPhantomBusterKey(apiKey);
  const account = configured ? await prisma.instagramAccount.findFirst({
    where:{ username:accountUsername, userId },
    select:{ id:true },
  }) : null;
  const reference = account ? await prisma.targetAccount.findFirst({
    where:{ instagramAccountId:account.id, username:referenceUsername },
    select:{ id:true },
  }) : null;

  // Only the already registered account/reference may trigger provider reads.
  const providerCheck = reference && configured
    ? await inspectFollowersAutoFollowAgent(apiKey!,agentId,referenceUsername)
    : 'missing-configuration';
  return NextResponse.json({
    accountRegistered:Boolean(account),
    referenceRegistered:Boolean(reference),
    agentConfigured:configured,
    providerCheck,
    referenceMatched:providerCheck === 'matched',
    oneFollowPerLaunchVerified:providerCheck === 'matched',
    sessionAccountSelfReported:true,
    sessionAccountVerifiedByProvider:false,
    agentLaunchEnabled:false,
    instagramActionsExecuted:0,
    note:'A sessão @contateste6699 foi informada pelo titular; a API do provedor não comprovou sua identidade.',
  }, { headers:HEADERS });
}
