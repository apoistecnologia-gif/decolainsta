import type { Prisma } from '@prisma/client';
export const USERNAME_RE = /^[a-zA-Z0-9._]{1,30}$/;
export function cleanUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const username = value.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(username) ? username : null;
}

const SETTINGS_NUMBER_BOUNDS: Record<string, [number, number]> = {
  minDelaySeconds: [10, 3600], maxDelaySeconds: [10, 3600],
  maxFollowsPerDay: [0, 1000], maxFollowsPerHour: [0, 1000],
  maxUnfollowsPerDay: [0, 1000], unfollowAfterDays: [1, 365],
  operationStartHour: [0, 23], operationEndHour: [1, 24],
};
const SETTINGS_BOOLEAN_KEYS = ['warmupEnabled', 'skipPrivateProfiles', 'skipNoPhoto', 'neverUnfollowFollowers'] as const;
export function validateSettings(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configurações inválidas');
  const record = input as Record<string, unknown>;
  const result: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key in SETTINGS_NUMBER_BOUNDS) {
      const [min, max] = SETTINGS_NUMBER_BOUNDS[key];
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`Valor inválido: ${key}`);
      result[key] = value as number;
    } else if ((SETTINGS_BOOLEAN_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`Valor inválido: ${key}`);
      result[key] = value;
    } else throw new Error(`Configuração não permitida: ${key}`);
  }
  if (result.minDelaySeconds !== undefined && result.maxDelaySeconds !== undefined && result.minDelaySeconds > result.maxDelaySeconds) {
    throw new Error('Delay mínimo deve ser menor que o máximo');
  }
  return result as Prisma.AccountSettingsCreateWithoutInstagramAccountInput;
}
