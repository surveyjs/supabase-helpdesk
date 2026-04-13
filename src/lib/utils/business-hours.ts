/**
 * Business hours calculator for SLA tracking.
 *
 * All SLA times are measured in business minutes — calendar time
 * outside configured business hours does not count.
 */

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type DaySchedule = { start: string; end: string } | null;

export type BusinessHoursConfig = {
  timezone: string;
  schedule: Record<DayOfWeek, DaySchedule>;
};

const _DAY_NAMES: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Parse an "HH:MM" string into total minutes from midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Get the day-of-week name for a Date interpreted in the given timezone.
 */
function getDayName(date: Date, timezone: string): DayOfWeek {
  const _dayIndex = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'narrow' })
      .formatToParts(date)
      .find((p) => p.type === 'weekday')?.value ?? '0',
    10,
  );
  // Intl weekday: narrow gives the first letter, not useful for index.
  // Use a numeric approach instead.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayShort = formatter.format(date); // "Mon", "Tue", etc.
  const map: Record<string, DayOfWeek> = {
    Sun: 'sunday',
    Mon: 'monday',
    Tue: 'tuesday',
    Wed: 'wednesday',
    Thu: 'thursday',
    Fri: 'friday',
    Sat: 'saturday',
  };
  return map[dayShort] ?? 'monday';
}

/**
 * Get the current time-of-day in minutes (from midnight) for a Date
 * interpreted in the given timezone.
 */
function getMinutesInDay(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

/**
 * Advance a Date by one calendar day at the same wall-clock time,
 * set to start of day (00:00) in the given timezone.
 */
function advanceToNextDay(date: Date, timezone: string): Date {
  // Move forward 25 hours to guarantee crossing midnight, then snap to midnight
  const next = new Date(date.getTime() + 25 * 60 * 60 * 1000);
  return snapToMidnight(next, timezone);
}

/**
 * Snap a Date to midnight (00:00:00) in the given timezone.
 */
function snapToMidnight(date: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value ?? '2000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';

  // Build an ISO string for midnight in UTC, then adjust for timezone offset
  const isoGuess = `${year}-${month}-${day}T00:00:00`;

  // Create date in the timezone by using a known offset calculation
  const utcDate = new Date(isoGuess + 'Z');
  // Get the offset between UTC and the timezone at this point
  const tzMinutes = getMinutesInDay(utcDate, timezone);
  // Adjust: if UTC midnight shows as e.g. 05:00 in the timezone, we need to subtract 5h
  return new Date(utcDate.getTime() - tzMinutes * 60 * 1000);
}

/**
 * Get a Date set to a specific time of day in the given timezone,
 * on the same calendar day as `date`.
 */
function setTimeInTimezone(date: Date, minutesFromMidnight: number, timezone: string): Date {
  const midnight = snapToMidnight(date, timezone);
  return new Date(midnight.getTime() + minutesFromMidnight * 60 * 1000);
}

/**
 * Get the business minutes available on a given day's schedule.
 */
function _getBusinessMinutesForDay(schedule: DaySchedule): number {
  if (!schedule) return 0;
  const start = parseTimeToMinutes(schedule.start);
  const end = parseTimeToMinutes(schedule.end);
  return Math.max(0, end - start);
}

/**
 * Calculate the number of business minutes between two timestamps.
 */
export function calculateBusinessMinutesElapsed(
  startTime: Date,
  endTime: Date,
  config: BusinessHoursConfig,
): number {
  if (endTime <= startTime) return 0;

  let totalMinutes = 0;
  let cursor = new Date(startTime);

  // Iterate day-by-day
  while (cursor < endTime) {
    const dayName = getDayName(cursor, config.timezone);
    const schedule = config.schedule[dayName];

    if (schedule) {
      const dayStart = parseTimeToMinutes(schedule.start);
      const dayEnd = parseTimeToMinutes(schedule.end);

      const cursorMinutes = getMinutesInDay(cursor, config.timezone);

      // Effective start of business on this day for counting
      const effectiveStart = Math.max(cursorMinutes, dayStart);

      // End of business today as a Date
      const dayEndDate = setTimeInTimezone(cursor, dayEnd, config.timezone);

      // The effective end for counting is the earlier of endTime or end of business
      const _effectiveEndDate = endTime < dayEndDate ? endTime : dayEndDate;
      const effectiveEndMinutes = endTime < dayEndDate
        ? getMinutesInDay(endTime, config.timezone)
        : dayEnd;

      // Check if same calendar day
      const _cursorDay = getDayName(cursor, config.timezone);
      const _endDay = getDayName(endTime, config.timezone);
      const sameDay = cursor.getTime() < dayEndDate.getTime() && endTime <= dayEndDate;

      if (effectiveStart < dayEnd) {
        const endMins = sameDay
          ? Math.min(effectiveEndMinutes, dayEnd)
          : dayEnd;
        const contribution = Math.max(0, endMins - effectiveStart);
        totalMinutes += contribution;
      }

      if (sameDay) break;
    }

    // Move to next day at midnight
    cursor = advanceToNextDay(cursor, config.timezone);
  }

  return totalMinutes;
}

/**
 * Calculate the deadline by adding business minutes to a start time.
 */
export function addBusinessMinutes(
  startTime: Date,
  minutes: number,
  config: BusinessHoursConfig,
): Date {
  if (minutes <= 0) return new Date(startTime);

  let remaining = minutes;
  let cursor = new Date(startTime);

  while (remaining > 0) {
    const dayName = getDayName(cursor, config.timezone);
    const schedule = config.schedule[dayName];

    if (schedule) {
      const dayStart = parseTimeToMinutes(schedule.start);
      const dayEnd = parseTimeToMinutes(schedule.end);
      const cursorMinutes = getMinutesInDay(cursor, config.timezone);

      // If before business hours, snap to start
      const effectiveStart = Math.max(cursorMinutes, dayStart);

      if (effectiveStart < dayEnd) {
        const availableMinutes = dayEnd - effectiveStart;

        if (remaining <= availableMinutes) {
          // Deadline falls on this day
          return setTimeInTimezone(cursor, effectiveStart + remaining, config.timezone);
        }

        remaining -= availableMinutes;
      }
    }

    // Move to next day
    cursor = advanceToNextDay(cursor, config.timezone);
  }

  // Shouldn't reach here, but return cursor as fallback
  return cursor;
}

/**
 * Calculate percentage of SLA target elapsed (0–100+).
 */
export function calculateSlaPercentage(
  elapsedMinutes: number,
  targetMinutes: number,
): number {
  if (targetMinutes <= 0) return 100;
  return Math.round((elapsedMinutes / targetMinutes) * 100);
}

/**
 * Format minutes into a human-readable duration string (e.g., "4h 30m").
 */
export function formatBusinessMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
