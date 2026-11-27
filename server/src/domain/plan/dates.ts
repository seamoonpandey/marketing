// Calendar dates are plain YYYY-MM-DD strings, never timestamps, so no timezone can shift them.
export const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const addDays = (s: string, n: number): string => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 0 Sunday … 6 Saturday. */
export const weekdayOf = (s: string): number => new Date(`${s}T00:00:00Z`).getUTCDay();
/** Today's date in a timezone; an invalid timezone falls back to UTC so one brand never breaks a query. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
/** The first day of the week (weekStarts: 0 Sunday … 6) that holds `day`. */
export const weekStartOf = (day: string, weekStarts: number): string => addDays(day, -((weekdayOf(day) - weekStarts + 7) % 7));
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
