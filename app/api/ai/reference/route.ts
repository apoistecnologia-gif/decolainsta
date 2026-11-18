export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { cleanUsername } from '@/lib/instagram/validation';
import {
  buildReferencePrompt, extractResponseText, parseReferenceInsight, validateReferenceContext,
} from '@/lib/ai/reference';
import { countPreviewAIRequest } from '@/lib/ai/preview-limit';

/**
 * Standalone analysis: no Instagram/Meta OAuth, no InstagramAccount needed.
 * Preview-only and behind a NextAuth login; only user-submitted text is analyzed.
 * No DB schema changes and no follower collection.
 */
export async function POST(req: Request) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return NextResponse.json({ error: 'Disponível somente no ambiente experimental.' }, { status: 404 });
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Faça login no DecolaInsta.' }, { status: 401 });

  if (process.env.DECOLAINSTA_AI_ENABLED !== 'true' || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'A IA ainda não está habilitada neste ambiente.' }, { status: 503 });
  }

  // Require the browser's same-origin request, not a cross-site form submission.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.host !== host) {
      return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Envie dados em JSON.' }, { status: 415 });
  }
  const raw = await req.text();
  if (raw.length > 2200) return NextResponse.json({ error: 'Texto muito longo.' }, { status: 413 });

  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  }
  const { referenceUsername, consent, ...other } = data as Record<string, unknown>;
  const username = cleanUsername(referenceUsername);
  const context = validateReferenceContext(other);
  if (!username || username.includes('..') || username.startsWith('.') || username.endsWith('.')
      || consent !== true || !context || (!context.bioPublica && !context.objetivo)) {
    return NextResponse.json({
      error: 'Informe o @, algum contexto e confirme o envio de informações públicas à OpenAI.',
    }, { status: 400 });
  }

  // Preview-only, in-memory throttle. Not durable across Vercel instances.
  if (!countPreviewAIRequest(userId)) {
    return NextResponse.json({ error: 'Limite provisório de análises atingido. Não repita a solicitação.' }, { status: 429 });
  }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(buildReferencePrompt(username, context)),
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({
        error: response.status === 429
          ? 'A API OpenAI atingiu um limite temporário.'
          : 'A OpenAI não concluiu a análise. Verifique créditos, modelo e chave no painel da OpenAI.',
      }, { status: response.status === 429 ? 429 : 502 });
    }
    const data: unknown = await response.json();
    const status = data && typeof data === 'object' ? (data as {status?:unknown}).status : undefined;
    const result = parseReferenceInsight(extractResponseText(data));
    if (status !== 'completed' || !result) {
      return NextResponse.json({ error: 'A IA não retornou uma análise completa e válida.' }, { status: 502 });
    }
    return NextResponse.json({
      ...result,
      referenceUsername: username,
      source: 'analysis_of_user_supplied_text',
      followersIdentified: false,
      realSocialActions: 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Falha na conexão com a OpenAI. Nenhuma ação no Instagram foi executada.' }, { status: 502 });
  }
}
