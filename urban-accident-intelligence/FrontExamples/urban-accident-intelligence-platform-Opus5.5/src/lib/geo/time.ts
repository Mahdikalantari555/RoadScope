/** Time utilities: study-area local time (all DB timestamps are UTC) and solar position. */
export const CITY_TIMEZONE = "Europe/Vienna";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CITY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Mon … 6=Sun
}

export function localParts(ms: number): LocalParts {
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WD[get("weekday")] ?? 0,
  };
}

/** Convert local wall-clock time in CITY_TIMEZONE to a UTC epoch (ms). */
export function localToUtc(year: number, month: number, day: number, hour: number, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(t);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t += guess - asUtc;
  }
  return t;
}

export function season(month: number): "Winter" | "Spring" | "Summer" | "Autumn" {
  if (month === 12 || month <= 2) return "Winter";
  if (month <= 5) return "Spring";
  if (month <= 8) return "Summer";
  return "Autumn";
}

/** Solar elevation angle (degrees) — NOAA simplified algorithm. */
export function solarElevation(ms: number, lat: number, lon: number): number {
  const d = new Date(ms);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = Math.floor((ms - start) / 86400000) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqt + 4 * lon;
  const ha = ((tst / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  return 90 - (Math.acos(Math.max(-1, Math.min(1, cosZ))) * 180) / Math.PI;
}

/** Light condition from solar elevation (civil twilight threshold −6°). */
export function lightCondition(ms: number, lat: number, lon: number): "daylight" | "twilight" | "dark" {
  const e = solarElevation(ms, lat, lon);
  if (e > 0) return "daylight";
  if (e > -6) return "twilight";
  return "dark";
}
