const MILLISECONDS_PER_DAY = 86_400_000;

export type ExpiryUrgency = {
  daysRemaining: number;
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  warning: boolean;
};

function calendarDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
  ) return null;
  return timestamp / MILLISECONDS_PER_DAY;
}

function localCalendarDay(now: Date) {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MILLISECONDS_PER_DAY;
}

export function expiryUrgency(expiresOn?: string | null, now = new Date()): ExpiryUrgency | null {
  if (!expiresOn) return null;
  const expiryDay = calendarDay(expiresOn);
  if (expiryDay === null) return null;
  const daysRemaining = expiryDay - localCalendarDay(now);
  if (daysRemaining > 7) return null;
  return {
    daysRemaining,
    level: Math.max(0, daysRemaining) as ExpiryUrgency["level"],
    warning: daysRemaining <= 0,
  };
}
