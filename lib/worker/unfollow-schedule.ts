/** Calculates the earliest due time for the demonstration-only unfollow queue. */
export function computeUnfollowScheduledAt(followedAt: Date, afterDays: number): Date {
  if (!(followedAt instanceof Date) || !Number.isFinite(followedAt.getTime())) {
    throw new Error('Data de follow inválida');
  }
  if (!Number.isInteger(afterDays) || afterDays < 1 || afterDays > 365) {
    throw new Error('Prazo de unfollow inválido');
  }
  // Exactly 24 hours per day, independent of DST/calendar transitions.
  return new Date(followedAt.getTime() + afterDays * 24 * 60 * 60 * 1000);
}
