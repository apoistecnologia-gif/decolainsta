export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { isConfiguredPhantomBusterKey } from '@/lib/reference-audience-readiness';
import { inspectFollowersAutoFollowAgent } from '@/lib/providers/phantombuster-followers-auto-follow';
import { inspectSavedPrivateFilterDetails } from '@/lib/providers/phantombuster-private-filter';

const HEADERS = { 'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer' };

/**
 * Operator-only, read-only readiness check for the already saved follower
 * agent. Never performs provider writes or Instagram actions.
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
    select:{ id:true,settings:{select:{skipPrivateProfiles:true}} },
  }) : null;
  const reference = account ? await prisma.targetAccount.findFirst({
    where:{ instagramAccountId:account.id, username:referenceUsername },
    select:{ id:true },
  }) : null;

  // Only the already registered account/reference may trigger provider reads.
  const providerCheck = reference && configured
    ? await inspectFollowersAutoFollowAgent(apiKey!,agentId,referenceUsername)
    : 'missing-configuration';
  const privateExclusionRequested=account?.settings?.skipPrivateProfiles??true;
  const exclusion=providerCheck==='matched'&&reference
    ? await inspectSavedPrivateFilterDetails(apiKey!,agentId,referenceUsername)
    : {status:'unverified' as const,reason:'agent-mismatch' as const};
  const privateExclusionStatus=exclusion.status;
  return NextResponse.json({
    privateExclusionRequested,
    privateExclusionStatus,
    privateExclusionReason:exclusion.reason,
    privateExclusionStructure:'structure' in exclusion
      ? (exclusion.structure??null) : null,
    privateExclusionVerified:privateExclusionRequested&&privateExclusionStatus==='enabled',
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
    note:`No teste original, o titular informou a sessão @contateste6699. Nome atual cadastrado: @${accountUsername}. A API do provedor não comprovou a identidade.`,
  }, { headers:HEADERS });
}
