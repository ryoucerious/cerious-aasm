export interface ScheduleSettings {
  /** 'hourly', 'daily' or 'weekly'; anything else never runs. */
  frequency?: unknown;
  /** 'HH:MM' in the host's local time, for daily and weekly. */
  time?: unknown;
  /** Weekdays for weekly, 0 = Sunday, as numbers or numeric strings. */
  days?: unknown;
}

const HOUR_MS = 60 * 60 * 1000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/** 'HH:MM' as numbers, or null when it is not a time of day. */
export function parseTimeOfDay(time: unknown): { hours: number; minutes: number } | null {
  if (typeof time !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? { hours, minutes } : null;
}

/**
 * The first run strictly after `now`: an hour on for hourly, else the next `time` (host local time)
 * on any day, or on one of `days` for weekly. Null when the settings describe no run at all.
 */
export function computeNextRun(settings: ScheduleSettings, now: Date): Date | null {
  switch (settings.frequency) {
    case 'hourly':
      return new Date(now.getTime() + HOUR_MS);
    case 'daily':
      return nextTimeOnDays(settings.time, EVERY_DAY, now);
    case 'weekly':
      return nextTimeOnDays(settings.time, weekdays(settings.days), now);
    default:
      return null;
  }
}

function nextTimeOnDays(time: unknown, days: number[], now: Date): Date | null {
  const timeOfDay = parseTimeOfDay(time);
  if (!timeOfDay || days.length === 0) return null;

  // Built from calendar fields rather than by adding milliseconds, so a DST change in between
  // does not shift the hour. Today counts only when the time is still ahead.
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, timeOfDay.hours, timeOfDay.minutes);
    if (candidate > now && days.includes(candidate.getDay())) {
      return candidate;
    }
  }
  return null;
}

// A form select sends its values as strings, so '3' counts as Wednesday.
function weekdays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  return days
    .map(day => (typeof day === 'string' && /^[0-6]$/.test(day.trim()) ? Number(day) : day))
    .filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6);
}
