/** YYYY-MM-DD (UTC). Used on both server and client so range comparisons agree. */
export const dayStr = (d: Date) => d.toISOString().slice(0, 10);

/** Range ending today; `days === null` means "all time" starting at `earliestDate`. */
export function presetRange(days: number | null, earliestDate: string, now = new Date()) {
  if (days === null) return { start: earliestDate, end: dayStr(now) };
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { start: dayStr(start), end: dayStr(now) };
}

const DAY_MS = 86400000;
const utcMs = (s: string) => new Date(`${s}T00:00:00Z`).getTime();

/** YYYY-MM-DD of the day after `end` (UTC); queries filter `created_at < endExclusive(end)`. */
export function endExclusive(end: string): string {
  return dayStr(new Date(utcMs(end) + DAY_MS));
}

/** Daily buckets over more than 366 inclusive days would produce thousands of points, so fall back to weekly. */
export function effectiveGroupBy(
  start: string,
  end: string,
  groupBy: 'day' | 'week' | 'month',
): 'day' | 'week' | 'month' {
  if (groupBy !== 'day') return groupBy;
  const days = (utcMs(end) - utcMs(start)) / DAY_MS + 1;
  return days > 366 ? 'week' : groupBy;
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isValidDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utcMs(s)) && dayStr(new Date(utcMs(s))) === s;
}
