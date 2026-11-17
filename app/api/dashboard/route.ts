export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!(session?.user as { id?: string } | undefined)?.id) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  const accounts = await prisma.instagramAccount.findMany({
    where: { userId, dryMode: true },
    include: { settings: true },
  });

  const accountIds = accounts.map((a: any) => a?.id).filter(Boolean);

  // All existing follow/unfollow counters are demonstration statistics, not Instagram metrics.
  // KPIs
  const totalFollows = accounts.reduce((sum: number, a: any) => sum + (a?.totalFollows ?? 0), 0);
  const totalUnfollows = accounts.reduce((sum: number, a: any) => sum + (a?.totalUnfollows ?? 0), 0);
  const totalFollowBacks = accounts.reduce((sum: number, a: any) => sum + (a?.totalFollowBacks ?? 0), 0);
  const activeAccounts = accounts.filter((a: any) => a?.status === 'active').length;
  const followBackRate = totalFollows > 0 ? totalFollowBacks / totalFollows : 0;

  // Daily stats for last 14 days
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recentActions = accountIds.length > 0 ? await prisma.followAction.findMany({
    where: {
      instagramAccountId: { in: accountIds },
      createdAt: { gte: fourteenDaysAgo },
    },
    select: { action: true, createdAt: true, followedAt: true, followedBack: true, unfollowedAt: true },
  }) : [];

  // Group by day
  const dailyStats: Record<string, { date: string; follows: number; unfollows: number; follow_backs: number }> = {};
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0] ?? '';
    dailyStats[key] = { date: key, follows: 0, unfollows: 0, follow_backs: 0 };
  }

  for (const action of recentActions) {
    const followDay = new Date(action.followedAt ?? action.createdAt).toISOString().slice(0, 10);
    if (dailyStats[followDay] && action.action === 'follow') {
      dailyStats[followDay].follows++;
      if (action.followedBack) dailyStats[followDay].follow_backs++;
    }
    const unfollowDay = action.unfollowedAt?.toISOString().slice(0, 10);
    if (unfollowDay && dailyStats[unfollowDay]) dailyStats[unfollowDay].unfollows++;
  }

  const dailyData = Object.values(dailyStats).sort((a: any, b: any) => (a?.date ?? '').localeCompare(b?.date ?? ''));

  // Account status breakdown
  const statusCounts: Record<string, number> = {};
  for (const acc of accounts) {
    const s = acc?.status ?? 'inactive';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const statusData = Object.entries(statusCounts).map(([status, count]) => ({
    category: status === 'active' ? 'Ativa' : status === 'inactive' ? 'Inativa' : status === 'paused' ? 'Pausada' : status === 'cooldown' ? 'Cooldown' : status === 'checkpoint' ? 'Checkpoint' : status,
    value: count,
  }));

  // Recent activity
  const recentLogs = accountIds.length > 0 ? await prisma.activityLog.findMany({
    where: { instagramAccountId: { in: accountIds } },
    include: { instagramAccount: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  }) : [];

  const activityData = recentLogs.map((log: any) => ({
    hora: new Date(log?.createdAt ?? '').toLocaleString('pt-BR', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }),
    conta: `@${log?.instagramAccount?.username ?? '?'}`,
    acao: log?.action === 'follow' ? 'Seguiu (demo)' : log?.action === 'unfollow' ? 'Unfollow (demo)' : log?.action === 'cooldown' ? 'Cooldown' : log?.action === 'error' ? 'Erro' : log?.action ?? '',
    alvo: log?.targetUsername ? `@${log.targetUsername}` : '-',
    status: log?.success ? 'healthy' : 'at-risk',
  }));

  // Unread alerts count
  const unreadAlerts = accountIds.length > 0 ? await prisma.alert.count({
    where: { instagramAccountId: { in: accountIds }, read: false },
  }) : 0;

  const kpis = [
    {
      metric: 'follows',
      region: 'All',
      label: 'Follows simulados',
      value: totalFollows,
      format: 'integer',
      delta: accounts?.[0]?.followsToday ?? 0,
      delta_label: 'hoje',
      good_when: 'up',
      spark: dailyData.map((d: any) => d?.follows ?? 0),
    },
    {
      metric: 'unfollows',
      region: 'All',
      label: 'Unfollows simulados',
      value: totalUnfollows,
      format: 'integer',
      delta: accounts?.[0]?.unfollowsToday ?? 0,
      delta_label: 'hoje',
      good_when: 'up',
      spark: dailyData.map((d: any) => d?.unfollows ?? 0),
    },
    {
      metric: 'followback',
      region: 'All',
      label: 'Follow-Back simulado',
      value: followBackRate,
      format: 'percent',
      delta: 0,
      delta_label: '',
      good_when: 'up',
      spark: [],
    },
    {
      metric: 'contas',
      region: 'All',
      label: 'Simulações ativas',
      value: activeAccounts,
      format: 'integer',
      delta: accounts.length,
      delta_label: 'total',
      good_when: 'up',
      spark: [],
    },
  ];

  return NextResponse.json({
    data_as_of: new Date().toISOString(),
    data: {
      kpis,
      daily_trend: dailyData,
      status_breakdown: statusData.length > 0 ? statusData : [{ category: 'Sem contas', value: 0 }],
      recent_activity: activityData,
    },
  });
}
