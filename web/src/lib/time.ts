// Pure date and time helpers shared by every module. Instants are written in the brand's timezone;
// calendar dates (YYYY-MM-DD, the plan's days and weeks) are arithmetic in UTC so no zone shifts them.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The zone if the runtime knows it, else UTC (a brand with a bad zone name must still render). */
export function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

const inZone = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: safeTz(tz), hourCycle: 'h23', ...o });

/** "Tue 1 Dec", or "Tue 1 Dec 2026" with `year`. */
export const dayLabel = (iso: string, tz: string, year = false) =>
  inZone(tz, { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).format(new Date(iso)).replace(',', '');
/** "10:00" */
export const timeLabel = (iso: string, tz: string) => inZone(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** YYYY-MM-DD of the instant in the timezone. */
export const dayKey = (iso: string | Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: safeTz(tz) }).format(new Date(iso));
/** "Tue 1 Dec, 10:00": the text of an instant without its zone name (`Time` adds the name). */
export const instantLabel = (iso: string, tz: string, o: { day?: boolean; year?: boolean } = {}) =>
  `${o.day === false ? '' : `${dayLabel(iso, tz, o.year)}, `}${timeLabel(iso, tz)}`;

function offsetMinutes(tz: string, ms: number): number {
  const parts = Object.fromEntries(
    inZone(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** A wall-clock date (YYYY-MM-DD) and time (HH:MM) in the brand's timezone, as ISO 8601 with that zone's offset, whatever the browser's zone is. */
export function wallToIso(date: string, time: string, tz: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let off = offsetMinutes(tz, wall);
  off = offsetMinutes(tz, wall - off * 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const hh = (n: number) => String(n).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh(Math.floor(a / 60))}:${hh(a % 60)}`;
}

// ---- calendar dates ----------------------------------------------------------------------------

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
export const addDays = (ymd: string, n: number): string => new Date(utc(ymd).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** A calendar date as text; "29 Nov" unless told otherwise. */
export const formatYmd = (ymd: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => utc(ymd).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
/** 0 (Sunday) to 6. */
export const weekdayOf = (ymd: string) => utc(ymd).getUTCDay();
/** The first day of the week (0 = Sunday) on or before the date. */
export const weekStartOf = (ymd: string, first: number) => addDays(ymd, -((weekdayOf(ymd) - first + 7) % 7));
/** "29 Nov – 5 Dec 2026" for the week that starts on `start`. */
export const weekRange = (start: string) => `${formatYmd(start)} – ${formatYmd(addDays(start, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
/** The date part of an ISO string as a calendar date with its year ("31 Dec 2026"): for "valid until" dates the owner typed as a day. */
export const formatDateOnly = (iso: string) => formatYmd(iso.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' });
