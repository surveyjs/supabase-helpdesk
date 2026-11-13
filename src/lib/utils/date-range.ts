/** YYYY-MM-DD (UTC). Used on both server and client so range comparisons agree. */
export const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/** Range ending today; `days === null` means "all time" starting at `earliestDate`. */
export function presetRange(days: number | null, earliestDate: string, now = new Date()) {
  if (days === null) return { start: earliestDate, end: dayStr(now) };
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { start: dayStr(start), end: dayStr(now) };
}
