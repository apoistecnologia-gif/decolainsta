export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { buildReferencePrompt, extractResponseText, parseReferenceInsight, validateReferenceContext, labelReferenceInsight } from '@/lib/ai/reference';

// OFF by default. Requires explicit server-only configuration of OpenAI API key.
export async function POST(req: Request, {
  params,
}: { params: Promise<{ id: string; targetId: string }> }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  if (process.env.DECOLAINSTA_AI_ENABLED !== 'true' || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'Análise com IA ainda não configurada pelo administrador.' }, { status: 503 });
  }
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Origem não permitida' }, { status: 403 });
  }
  const { id, targetId } = await params;
  const target = await prisma.targetAccount.findFirst({
    where: { id: targetId, instagramAccountId: id, instagramAccount: { userId } },
    select: { username: true },
  });
  if (!target) return NextResponse.json({ error: 'Conta de referência não encontrada' }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 4000) return NextResponse.json({ error: 'Entrada muito grande' }, { status: 413 });
  let data: unknown;
  try { data = JSON.parse(raw); }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const context = validateReferenceContext(data);
  if (!context) {
    return NextResponse.json({ error: 'Descrição pública ou objetivo inválido. Não envie dados privados.' }, { status: 400 });
  }

  // Basic server-side per-account and per-user cost caps. Further edge limits
  // should be added before offering this feature to large audiences.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [accountCalls, userCalls] = await Promise.all([
    prisma.activityLog.count({
      where: { instagramAccountId: id, action: 'ai_reference_request', createdAt: { gte: since } },
    }),
    prisma.activityLog.count({
      where: { action: 'ai_reference_request', instagramAccount: { userId }, createdAt: { gte: since } },
    }),
  ]);
  if (accountCalls >= 3 || userCalls >= 10) {
    return NextResponse.json({ error: 'Limite de análises atingido nas últimas 24 horas.' }, { status: 429 });
  }

  try {
    // Charge each attempt against the daily budget, even if the provider errors.
    // No user-supplied prompt or response content is written to the audit log.
    await prisma.activityLog.create({
      data: {
        instagramAccountId: id,
        action: 'ai_reference_request',
        targetUsername: target.username,
        details: 'opt_in_public_reference_strategy_only',
        success: false,
      },
    });
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(buildReferencePrompt(target.username, context)),
      cache: 'no-store',
    });
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return NextResponse.json({
        error: status === 429 ? 'Limite temporário da API de IA.' : 'Não foi possível obter a análise da IA.',
      }, { status });
    }
    const output = await response.json();
    const insight = parseReferenceInsight(extractResponseText(output));
    if (!insight || output.status !== 'completed') {
      return NextResponse.json({ error: 'A IA não retornou uma análise válida. Nenhuma ação foi realizada.' }, { status: 502 });
    }
    await prisma.activityLog.create({
      data: {
        instagramAccountId: id,
        action: 'ai_reference_analysis',
        targetUsername: target.username,
        details: JSON.stringify({
          type: 'content_strategy_hypotheses',
          model: typeof output.model === 'string' ? output.model.slice(0, 60) : 'unknown',
          dataSource: 'user_supplied_public_context',
          followersIdentified: false,
        }),
        success: true,
      },
    });
    return NextResponse.json({
      ...labelReferenceInsight(insight, context),
      referenceUsername: target.username,
      source: 'gpt_analysis_of_user_supplied_text',
      followersIdentified: false,
      realSocialActions: 0,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({
      error: 'Erro na conexão com a API de IA. Verifique a configuração do servidor.',
    }, { status: 502 });
  }
}
