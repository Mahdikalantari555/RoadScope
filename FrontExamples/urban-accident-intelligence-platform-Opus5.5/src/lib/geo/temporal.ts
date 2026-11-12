/** Temporal aggregation and environmental comparison (exposure-normalised Poisson rate ratios). */
import { chiSquareSf, poissonCI, rateRatio } from "./stats";
import { localParts, season } from "./time";

export interface TemporalEvent {
  t: number;
  weather: string | null;
  light: string | null;
}

export function temporalProfile(events: TemporalEvent[]) {
  const hour = new Array<number>(24).fill(0);
  const weekday = new Array<number>(7).fill(0);
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const monthly = new Map<string, number>();
  const seasons: Record<string, number> = { Winter: 0, Spring: 0, Summer: 0, Autumn: 0 };
  const monthOfYear = new Array<number>(12).fill(0);
  for (const e of events) {
    const p = localParts(e.t);
    hour[p.hour]++;
    weekday[p.weekday]++;
    matrix[p.weekday][p.hour]++;
    monthOfYear[p.month - 1]++;
    const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
    monthly.set(key, (monthly.get(key) ?? 0) + 1);
    seasons[season(p.month)]++;
  }
  const n = events.length;
  const gof = (obs: number[]) => {
    const exp = n / obs.length;
    const chi = exp > 0 ? obs.reduce((a, o) => a + (o - exp) ** 2 / exp, 0) : 0;
    return { chi2: chi, df: obs.length - 1, p: exp > 0 ? chiSquareSf(chi, obs.length - 1) : 1 };
  };
  const peak = (h: number[]) => h[7] + h[8] + h[16] + h[17] + h[18];
  return {
    n,
    hour,
    weekday,
    matrix,
    monthOfYear,
    seasons,
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
    tests: {
      hourUniformity: gof(hour),
      weekdayUniformity: gof(weekday),
      peakShare: n ? peak(hour) / n : 0,
      peakShareExpectedUniform: 5 / 24,
    },
  };
}

export interface ExposureHours {
  [condition: string]: number;
}

export interface RateComparisonRow {
  level: string;
  events: number;
  exposure: number;
  rate: number;
  rateLow: number;
  rateHigh: number;
  rr: number;
  rrLow: number;
  rrHigh: number;
  p: number;
  reference: boolean;
}

/** Compare event rates across levels of a factor, normalised by exposure (hours, km·years, MVkm). */
export function compareRates(counts: Record<string, number>, exposure: Record<string, number>, reference: string, scale: number): RateComparisonRow[] {
  const ref = { n: counts[reference] ?? 0, e: exposure[reference] ?? 0 };
  return Object.keys(exposure)
    .filter((k) => exposure[k] > 0)
    .map((level) => {
      const nEv = counts[level] ?? 0;
      const e = exposure[level];
      const [lo, hi] = poissonCI(nEv);
      const rr = level === reference ? { rr: 1, lower: 1, upper: 1, p: 1 } : rateRatio(nEv, e, ref.n, ref.e);
      return {
        level,
        events: nEv,
        exposure: e,
        rate: (nEv / e) * scale,
        rateLow: (lo / e) * scale,
        rateHigh: (hi / e) * scale,
        rr: rr.rr,
        rrLow: rr.lower,
        rrHigh: rr.upper,
        p: rr.p,
        reference: level === reference,
      };
    });
}
