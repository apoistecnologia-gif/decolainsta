// Laboratório de simulação isolado. Este módulo nunca executa follows ou unfollows reais.
// Não interpretar falhas aleatórias como bloqueios, limites ou respostas da Meta.

import { prisma } from '@/lib/db';
import { computeUnfollowScheduledAt } from './unfollow-schedule';


// Compare calendar days in the account's configured timezone, not the server timezone.
function calendarDayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return [part('year'), part('month'), part('day')].join('-');
}

interface ActionResult {
  success: boolean;
  action: string;
  target?: string;
  error?: string;
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateFollow(username: string): Promise<ActionResult> {
  // Simulate API call delay
  await sleep(randomDelay(500, 1500));
  const success = Math.random() > 0.05; // 95% success rate in simulation
  return { success, action: 'follow', target: username };
}

async function simulateUnfollow(username: string): Promise<ActionResult> {
  await sleep(randomDelay(500, 1500));
  const success = Math.random() > 0.05;
  return { success, action: 'unfollow', target: username };
}

async function simulateCollectFollowers(targetUsername: string): Promise<string[]> {
  await sleep(randomDelay(1000, 3000));
  // Return simulated follower usernames
  const count = randomDelay(5, 20);
  const followers: string[] = [];
  for (let i = 0; i < count; i++) {
    followers.push(`sim_user_${targetUsername}_${Date.now()}_${i}`);
  }
  return followers;
}

async function isWithinOperatingHours(accountId: string): Promise<boolean> {
  const settings = await prisma.accountSettings.findUnique({
    where: { instagramAccountId: accountId },
  });
  if (!settings) return false;

  const now = new Date();
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  } catch { return false; }
  const start = settings.operationStartHour;
  const end = settings.operationEndHour;
  return start <= end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

async function getEffectiveLimits(accountId: string): Promise<{ maxFollows: number; maxUnfollows: number; maxPerHour: number }> {
  const settings = await prisma.accountSettings.findUnique({
    where: { instagramAccountId: accountId },
  });
  if (!settings) return { maxFollows: 50, maxUnfollows: 40, maxPerHour: 10 };

  let maxFollows = settings.maxFollowsPerDay;
  if (settings.warmupEnabled && settings.warmupDaysCompleted < settings.warmupMaxDays) {
    const progress = settings.warmupDaysCompleted / settings.warmupMaxDays;
    maxFollows = Math.floor(settings.warmupStartFollows + (maxFollows - settings.warmupStartFollows) * progress);
  }

  return {
    maxFollows,
    maxUnfollows: settings.maxUnfollowsPerDay,
    maxPerHour: settings.maxFollowsPerHour,
  };
}

export async function processFollowsForAccount(accountId: string): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    include: { settings: true, targetAccounts: { where: { enabled: true } } },
  });

  if (!account || account.status !== 'active' || !account.dryMode) return;
  if (account.cooldownUntil && new Date(account.cooldownUntil) > new Date()) return;

  const withinHours = await isWithinOperatingHours(accountId);
  if (!withinHours) return;

  const limits = await getEffectiveLimits(accountId);

  // Reset daily counters if needed
  const now = new Date();
  const timeZone = account.settings?.timezone ?? 'America/Sao_Paulo';
  if (!account.dayCounterResetAt || calendarDayKey(now, timeZone) !== calendarDayKey(new Date(account.dayCounterResetAt), timeZone)) {
    await prisma.instagramAccount.update({
      where: { id: accountId },
      data: { followsToday: 0, unfollowsToday: 0, dayCounterResetAt: now },
    });
    account.followsToday = 0;
    account.unfollowsToday = 0;
  }

  // Reset hourly counter
  if (!account.hourCounterResetAt || (now.getTime() - new Date(account.hourCounterResetAt).getTime()) > 3600000) {
    await prisma.instagramAccount.update({
      where: { id: accountId },
      data: { followsThisHour: 0, hourCounterResetAt: now },
    });
    account.followsThisHour = 0;
  }

  // Check limits
  if (account.followsToday >= limits.maxFollows) return;
  if (account.followsThisHour >= limits.maxPerHour) return;

  // Pick a random target account
  const targets = account.targetAccounts ?? [];
  if (targets.length === 0) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  if (!target) return;

  // Collect followers from target (simulated)
  let followers: string[] = [];
  try {
    followers = await simulateCollectFollowers(target.username);
    await prisma.targetAccount.update({
      where: { id: target.id },
      data: { followersCollected: { increment: followers.length }, lastCollectedAt: now },
    });
  } catch (err: any) {
    await prisma.activityLog.create({
      data: {
        instagramAccountId: accountId,
        action: 'error',
        details: `Erro ao coletar seguidores de @${target.username}: ${err?.message ?? 'unknown'}`,
        success: false,
      },
    });
    return;
  }

  // Follow up to remaining daily limit
  const remaining = Math.min(
    limits.maxFollows - account.followsToday,
    limits.maxPerHour - account.followsThisHour,
    3 // max per tick
  );

  for (let i = 0; i < Math.min(remaining, followers.length); i++) {
    const follower = followers[i];
    if (!follower) continue;

    // Check if already followed
    const existing = await prisma.followAction.findFirst({
      where: { instagramAccountId: accountId, targetUsername: follower },
    });
    if (existing) continue;

    const settings = account.settings;
    const delay = randomDelay(
      settings?.minDelaySeconds ?? 25,
      settings?.maxDelaySeconds ?? 90
    );

    // Simulation only. Never claim this is a real action.
    const result = await simulateFollow(follower);

    if (result.success) {
      const followedAt = new Date();
      const unfollowDate = computeUnfollowScheduledAt(followedAt, settings?.unfollowAfterDays ?? 3);

      await prisma.followAction.create({
        data: {
          instagramAccountId: accountId,
          targetUsername: follower,
          action: 'follow',
          followedAt,
          unfollowScheduledAt: unfollowDate,
          sourceTarget: target.username,
          isDryRun: account.dryMode,
        },
      });

      await prisma.instagramAccount.update({
        where: { id: accountId },
        data: {
          followsToday: { increment: 1 },
          followsThisHour: { increment: 1 },
          totalFollows: { increment: 1 },
          lastActivity: now,
        },
      });

      await prisma.activityLog.create({
        data: {
          instagramAccountId: accountId,
          action: 'follow',
          targetUsername: follower,
          details: `Seguiu @${follower} (fonte: @${target.username})${account.dryMode ? ' [SIMULAÇÃO]' : ''}`,
          success: true,
        },
      });
    } else {
      // A random demonstration failure is not evidence of an Instagram restriction.
      // Do not alter account status or issue a real rate-limit alert.
      await prisma.activityLog.create({
        data: {
          instagramAccountId: accountId,
          action: 'simulation_failure',
          details: 'Falha aleatória da demonstração. Nenhuma requisição de follow foi enviada ao Instagram.',
          success: false,
        },
      });
      break;
    }

    // Delay scaled down for simulated actions only.
    await sleep(delay * 100); // scaled down for simulation
  }
}

export async function processUnfollowsForAccount(accountId: string): Promise<void> {
  const account = await prisma.instagramAccount.findUnique({
    where: { id: accountId },
    include: { settings: true, whitelist: true },
  });

  if (!account || account.status !== 'active' || !account.dryMode) return;
  if (account.cooldownUntil && new Date(account.cooldownUntil) > new Date()) return;
  if (!(await isWithinOperatingHours(accountId))) return;

  const now = new Date();
  const timeZone = account.settings?.timezone ?? 'America/Sao_Paulo';
  // Unfollow can run without a preceding follow tick: reset counters here too.
  if (!account.dayCounterResetAt || calendarDayKey(now, timeZone) !== calendarDayKey(new Date(account.dayCounterResetAt), timeZone)) {
    await prisma.instagramAccount.update({
      where: { id: accountId },
      data: { followsToday: 0, unfollowsToday: 0, dayCounterResetAt: now },
    });
    account.unfollowsToday = 0;
  }

  const limits = await getEffectiveLimits(accountId);
  if (account.unfollowsToday >= limits.maxUnfollows) return;
  const whitelistUsernames = (account.whitelist ?? []).map((w: any) => w?.username).filter(Boolean);

  // Find follows that are due for unfollow
  const dueForUnfollow = await prisma.followAction.findMany({
    where: {
      instagramAccountId: accountId,
      action: 'follow',
      isDryRun: true,
      unfollowedAt: null,
      unfollowScheduledAt: { lte: now },
      followedBack: account.settings?.neverUnfollowFollowers ? false : undefined,
      targetUsername: whitelistUsernames.length > 0 ? { notIn: whitelistUsernames } : undefined,
    },
    take: Math.min(2, limits.maxUnfollows - account.unfollowsToday),
    orderBy: { unfollowScheduledAt: 'asc' },
  });

  for (const action of dueForUnfollow) {
    const result = await simulateUnfollow(action?.targetUsername ?? '');

    if (result.success) {
      await prisma.followAction.update({
        where: { id: action.id },
        data: { unfollowedAt: now },
      });

      await prisma.instagramAccount.update({
        where: { id: accountId },
        data: {
          unfollowsToday: { increment: 1 },
          totalUnfollows: { increment: 1 },
          lastActivity: now,
        },
      });

      await prisma.activityLog.create({
        data: {
          instagramAccountId: accountId,
          action: 'unfollow',
          targetUsername: action?.targetUsername ?? '',
          details: `Deixou de seguir @${action?.targetUsername ?? ''}${account.dryMode ? ' [SIMULAÇÃO]' : ''}`,
          success: true,
        },
      });
    }

    const delay = randomDelay(
      account.settings?.minDelaySeconds ?? 25,
      account.settings?.maxDelaySeconds ?? 90
    );
    await sleep(delay * 100);
  }
}

export async function runEngineTick(userId: string): Promise<{ processed: number }> {
  const activeAccounts = await prisma.instagramAccount.findMany({
    where: {
      status: 'active',
      userId,
      dryMode: true,
    },
  });

  // Also check cooldown accounts that may have expired
  const cooldownAccounts = await prisma.instagramAccount.findMany({
    where: {
      status: 'cooldown',
      userId,
      dryMode: true,
      cooldownUntil: { lte: new Date() },
    },
  });

  for (const acc of cooldownAccounts) {
    await prisma.instagramAccount.update({
      where: { id: acc.id },
      data: { status: 'active', cooldownUntil: null },
    });
  }

  let processed = 0;
  for (const account of activeAccounts) {
    try {
      await processFollowsForAccount(account.id);
      await processUnfollowsForAccount(account.id);
      processed++;
    } catch (err: any) {
      console.error(`Engine error for account ${account?.username}:`, err);
      await prisma.activityLog.create({
        data: {
          instagramAccountId: account.id,
          action: 'error',
          details: `Erro do motor: ${err?.message ?? 'desconhecido'}`,
          success: false,
        },
      });
    }
  }

  return { processed };
}
