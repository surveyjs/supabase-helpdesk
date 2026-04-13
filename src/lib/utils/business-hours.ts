import { createServiceRoleClient } from '@/lib/supabase/server';

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type DaySchedule = { start: string; end: string } | null;

export type BusinessHoursConfig = {
  timezone: string;
  schedule: Record<DayOfWeek, DaySchedule>;
};

const DAYS_ORDER: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function getBusinessHoursConfig(): Promise<BusinessHoursConfig> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'sla_business_hours')
    .single();

  if (data?.value) {
    try {
      return JSON.parse(data.value) as BusinessHoursConfig;
    } catch {
      // fall through to default
    }
  }

  return {
    timezone: 'UTC',
    schedule: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: null,
      sunday: null,
    },
  };
}

/**
 * Parse a "HH:MM" time string into total minutes from midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Get the day-of-week for a Date in a given timezone.
 * Returns 0=Sunday .. 6=Saturday.
 */
function getDayInTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday ?? 'Mon'] ?? 1;
}

/**
 * Get the hours and minutes of a Date in a given timezone.
 */
function getTimeInTimezone(date: Date, timezone: string): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);

  let hours = 0;
  let minutes = 0;
  for (const part of parts) {
    if (part.type === 'hour') hours = parseInt(part.value, 10);
    if (part.type === 'minute') minutes = parseInt(part.value, 10);
  }
  // Handle midnight being reported as 24 in some locales
  if (hours === 24) hours = 0;
  return { hours, minutes };
}

/**
 * Get start of day in a given timezone for a specific date, returned as a UTC Date.
 */
function getStartOfDayInTimezone(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = formatter.format(date); // YYYY-MM-DD
  // Create a date at midnight in the target timezone
  const [year, month, day] = dateStr.split('-').map(Number);

  // Use a temporary date to find the UTC offset at midnight for this date
  const tempDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // noon UTC as starting point
  const { hours: tzHours, minutes: tzMinutes } = getTimeInTimezone(tempDate, timezone);
  const noonOffsetMinutes = (tzHours * 60 + tzMinutes) - (12 * 60);

  // midnight in TZ = midnight UTC - offset
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - noonOffsetMinutes * 60000);
}

/**
 * Advance a date by N calendar days (keeping same time).
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Calculate the number of business minutes between two timestamps,
 * accounting for the configured business hours schedule and timezone.
 */
export function calculateBusinessMinutesElapsed(
  startTime: Date,
  endTime: Date,
  config: BusinessHoursConfig,
): number {
  if (endTime <= startTime) return 0;

  let totalMinutes = 0;
  let cursor = new Date(startTime.getTime());

  // Iterate day by day
  while (cursor < endTime) {
    const dayIndex = getDayInTimezone(cursor, config.timezone);
    const dayName = DAYS_ORDER[dayIndex];
    const schedule = config.schedule[dayName];

    if (schedule) {
      const dayStartMin = parseTimeToMinutes(schedule.start);
      const dayEndMin = parseTimeToMinutes(schedule.end);
      // Calculate the start of this business day in UTC
      const dayStartUtc = getStartOfDayInTimezone(cursor, config.timezone);
      const businessStartUtc = new Date(dayStartUtc.getTime() + dayStartMin * 60000);
      const businessEndUtc = new Date(dayStartUtc.getTime() + dayEndMin * 60000);

      // Effective window for this day
      const effectiveStart = cursor > businessStartUtc ? cursor : businessStartUtc;
      const effectiveEnd = endTime < businessEndUtc ? endTime : businessEndUtc;

      if (effectiveStart < effectiveEnd) {
        totalMinutes += Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / 60000);
      }
    }

    // Move to start of next day in the timezone
    const nextDay = getStartOfDayInTimezone(addDays(cursor, 1), config.timezone);
    cursor = nextDay;
  }

  return totalMinutes;
}

/**
 * Calculate the deadline by adding the given number of business minutes
 * to the start time. Returns the calendar datetime when the SLA target expires.
 */
export function addBusinessMinutes(
  startTime: Date,
  minutes: number,
  config: BusinessHoursConfig,
): Date {
  if (minutes <= 0) return new Date(startTime.getTime());

  let remaining = minutes;
  let cursor = new Date(startTime.getTime());

  // Safety: max 365 days iteration
  for (let safety = 0; safety < 365 * 2 && remaining > 0; safety++) {
    const dayIndex = getDayInTimezone(cursor, config.timezone);
    const dayName = DAYS_ORDER[dayIndex];
    const schedule = config.schedule[dayName];

    if (schedule) {
      const dayStartMin = parseTimeToMinutes(schedule.start);
      const dayEndMin = parseTimeToMinutes(schedule.end);
      const dayStartUtc = getStartOfDayInTimezone(cursor, config.timezone);
      const businessStartUtc = new Date(dayStartUtc.getTime() + dayStartMin * 60000);
      const businessEndUtc = new Date(dayStartUtc.getTime() + dayEndMin * 60000);

      // Effective start for this day
      const effectiveStart = cursor > businessStartUtc ? cursor : businessStartUtc;

      if (effectiveStart < businessEndUtc) {
        const availableMinutes = Math.floor(
          (businessEndUtc.getTime() - effectiveStart.getTime()) / 60000,
        );

        if (remaining <= availableMinutes) {
          return new Date(effectiveStart.getTime() + remaining * 60000);
        }

        remaining -= availableMinutes;
      }
    }

    // Move to start of next day in the timezone
    const nextDay = getStartOfDayInTimezone(addDays(cursor, 1), config.timezone);
    cursor = nextDay;
  }

  // Fallback: shouldn't reach here for reasonable SLA durations
  return new Date(startTime.getTime() + minutes * 60000);
}

/**
 * Return percentage (0–100+).
 */
export function calculateSlaPercentage(elapsedMinutes: number, targetMinutes: number): number {
  if (targetMinutes <= 0) return 100;
  return Math.round((elapsedMinutes / targetMinutes) * 100);
}
