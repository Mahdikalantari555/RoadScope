/**
 * UTC-first time utilities. Timestamps are stored in UTC; local calendar fields are derived
 * in the study-area time zone with the Intl API (no extra dependency).
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  dow: number; // 0 = Monday ... 6 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      weekday: "short",
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    dow: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

function offsetMs(utcMs: number, tz: string): number {
  const p = localParts(new Date(utcMs), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wallAsUtc - Math.floor(utcMs / 60000) * 60000;
}

/** Converts a wall-clock time in the given IANA zone to a UTC Date (handles DST transitions). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = offsetMs(guess, tz);
  let t = guess - off1;
  const off2 = offsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/** Parses "YYYY-MM-DDTHH:mm" (local wall-clock) into a UTC Date. Returns null if malformed. */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return zonedToUtc(y, mo, d, h, mi, tz);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function localMonthKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}`;
}

/** Start (00:00 local) of an ISO calendar date, expressed in UTC. */
export function startOfLocalDate(isoDate: string, tz: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return zonedToUtc(y, m, d, 0, 0, tz);
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function seasonOf(month: number): "DJF" | "MAM" | "JJA" | "SON" {
  if (month === 12 || month <= 2) return "DJF";
  if (month <= 5) return "MAM";
  if (month <= 8) return "JJA";
  return "SON";
}

export const SEASON_LABELS: Record<"DJF" | "MAM" | "JJA" | "SON", string> = {
  DJF: "Winter (Dec–Feb)",
  MAM: "Spring (Mar–May)",
  JJA: "Summer (Jun–Aug)",
  SON: "Autumn (Sep–Nov)",
};
