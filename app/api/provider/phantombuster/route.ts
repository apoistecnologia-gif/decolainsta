export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { checkPhantomBusterWorkspace, type PhantomBusterResult } from '@/lib/providers/phantombuster';
import { getLatestTestProfile } from '@/lib/providers/phantombuster-profile-result';
import { NextResponse } from 'next/server';

function reply(data: PhantomBusterResult, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

type PilotAuth =
  | { ok: true; username: string }
  | { ok: false; status: number; error: string };

/** Shared server-key diagnostic works for any customer account on Preview. */
async function authorizeOwnedAccount(accountId: unknown): Promise<PilotAuth> {
  if (process.env.VERCEL_ENV !== 'preview' ||
      process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes')
    return { ok: false, status: 403, error: 'Diagnóstico desativado' };
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, status: 401, error: 'Não autorizado' };
  if (typeof accountId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(accountId))
    return { ok: false, status: 400, error: 'Conta inválida' };
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId }, select: { username: true },
  });
  return account ? { ok: true, username: account.username } :
    { ok: false, status: 404, error: 'Conta não encontrada' };
}

async function authorizePilot(accountId: unknown): Promise<PilotAuth> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, status: 401, error: 'Não autorizado' };
  if (typeof accountId !== 'string' || !accountId || accountId.length > 100) {
    return { ok: false, status: 400, error: 'Conta inválida' };
  }
  const account = await prisma.instagramAccount.findFirst({
    where: { id: accountId, userId },
    select: { id: true, username: true },
  });
  if (!account) return { ok: false, status: 404, error: 'Conta não encontrada' };

  const pilotById = !!process.env.PHANTOMBUSTER_PILOT_ACCOUNT_ID &&
    process.env.PHANTOMBUSTER_PILOT_ACCOUNT_ID === account.id;
  const pilotByUsername = !!process.env.PHANTOMBUSTER_PILOT_USERNAME &&
    process.env.PHANTOMBUSTER_PILOT_USERNAME.toLowerCase() === account.username.toLowerCase();
  if (process.env.PHANTOMBUSTER_READONLY_ENABLED !== 'yes' || !(pilotById || pilotByUsername)) {
    return { ok: false, status: 403, error: 'Diagnóstico indisponível para esta conta' };
  }
  return { ok: true, username: account.username };
}

/**
 * Only reads metadata about the known user's PhantomBuster agent.
 * Never calls Instagram, starts a Phantom, or stores a provider token.
 */
function pilotAgentId(): string | undefined {
  const id = process.env.PHANTOMBUSTER_PILOT_AGENT_ID;
  return id && /^[0-9]{10,25}$/.test(id) ? id : undefined;
}

export async function GET(req: Request) {
  const accountId = new URL(req.url).searchParams.get('accountId');
  const owned = await authorizeOwnedAccount(accountId);
  if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });
  const key = process.env.PHANTOMBUSTER_API_KEY;
  if (!key) return reply({ status: 'not-configured', instagramConnectionVerified: false, actionsEnabled: false });
  // Do not expose or attach the old pilot Auto Follow agent to a customer's
  // generic workspace check. A verified API key is not Instagram authorization.
  return reply(await checkPhantomBusterWorkspace(key));
}

/**
 * POST is a read-only, one-off credential check. It sends a single provider GET.
 * Key only lives in this request (HTTPS); no database or env writes, no logs,
 * no cookies, no automation launches. Browser clears it immediately afterward.
 */
export async function POST(req: Request) {
  // Require same-origin browser interaction, not a cross-origin form submission.
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: 'Origem inválida' }, { status: 403 });
  }
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 415 });
  }
  const raw = await req.text().catch(() => '');
  if (!raw || raw.length > 2048) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }
  const obj = payload as Record<string, unknown>;
  if (Object.keys(obj).some(key => key !== 'accountId' && key !== 'apiKey' && key !== 'mode') ||
      (obj.mode !== undefined && obj.mode !== 'verify' && obj.mode !== 'profile-summary')) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }

  const pilot = await authorizePilot(obj.accountId);
  if (!pilot.ok) return NextResponse.json({ error: pilot.error }, { status: pilot.status });

  const key = obj.apiKey;
  // Do not accept Instagram session cookies or strings containing newline/space.
  if (typeof key !== 'string' || key.length < 12 || key.length > 512 ||
      !/^[\x21-\x7E]+$/.test(key) || /sessionid|instagram|%3a|[;\s]/i.test(key)) {
    return NextResponse.json({ error: 'Chave API da PhantomBuster inválida' }, { status: 400 });
  }
  if (obj.mode === 'profile-summary') {
    const id = process.env.PHANTOMBUSTER_PROFILE_AGENT_ID;
    if (!id || !/^\d{10,25}$/.test(id)) {
      return NextResponse.json({ error: 'Automação de leitura ainda não configurada' }, { status: 503 });
    }
    return NextResponse.json(await getLatestTestProfile(key, id, pilot.username), {
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  }
  return reply(await checkPhantomBusterWorkspace(key, fetch, pilotAgentId()));
}
