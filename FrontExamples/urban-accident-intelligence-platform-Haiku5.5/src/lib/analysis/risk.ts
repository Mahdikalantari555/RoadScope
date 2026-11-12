/**
 * Transparent, configurable relative risk index for road segments.
 *
 * IMPORTANT: the output is a weighted, normalised ranking aid on a 0–100 scale. It is NOT a
 * calibrated probability of collision and has not been validated against independent outcomes.
 */
import { poissonInterval, percentileRanks, quantile } from "../stats";

export const RISK_INDICATORS = ["count", "density", "severity", "exposure", "darkness", "speed"] as const;
export type RiskIndicator = (typeof RISK_INDICATORS)[number];
export type RiskWeights = Record<RiskIndicator, number>;

export const INDICATOR_LABELS: Record<RiskIndicator, string> = {
  count: "Frequency (count)",
  density: "Density (per km)",
  severity: "Severity-weighted density",
  exposure: "Exposure rate (per M veh-km)",
  darkness: "Darkness (1 − lighting)",
  speed: "Speed limit",
};

export interface RiskInput {
  segmentId: number;
  name: string;
  roadClass: string;
  count: number;
  lengthM: number;
  severityWeightSum: number;
  exposureRate: number | null;
  lighting: number;
  speedLimitKmh: number;
}

export interface RiskRow {
  segmentId: number;
  name: string;
  roadClass: string;
  count: number;
  lengthM: number;
  perKm: number;
  severityPerKm: number;
  exposureRate: number | null;
  lighting: number;
  speedLimitKmh: number;
  raw: Record<RiskIndicator, number | null>;
  normalized: Record<RiskIndicator, number | null>;
  score: number;
  coverage: number;
  ciLow: number;
  ciHigh: number;
  uncertainty: "low" | "moderate" | "high";
  rank: number;
}

export const DEFAULT_WEIGHTS: RiskWeights = {
  count: 0.15,
  density: 0.2,
  severity: 0.25,
  exposure: 0.2,
  darkness: 0.1,
  speed: 0.1,
};

export function computeRiskScores(inputs: RiskInput[], weights: RiskWeights, normalization: "percentile" | "minmax"): RiskRow[] {
  const n = inputs.length;
  const raw: Record<RiskIndicator, (number | null)[]> = {
    count: [],
    density: [],
    severity: [],
    exposure: [],
    darkness: [],
    speed: [],
  };
  for (const r of inputs) {
    const km = Math.max(r.lengthM, 1) / 1000;
    raw.count.push(r.count);
    raw.density.push(r.count / km);
    raw.severity.push(r.severityWeightSum / km);
    raw.exposure.push(r.exposureRate);
    raw.darkness.push(1 - r.lighting);
    raw.speed.push(r.speedLimitKmh);
  }

  const normalized: Record<RiskIndicator, (number | null)[]> = {} as Record<RiskIndicator, (number | null)[]>;
  for (const key of RISK_INDICATORS) {
    const present = raw[key].map((v, i) => ({ v, i })).filter((e): e is { v: number; i: number } => e.v !== null);
    const out: (number | null)[] = new Array(n).fill(null);
    if (present.length) {
      const values = present.map((e) => e.v);
      if (normalization === "percentile") {
        const pr = percentileRanks(values);
        present.forEach((e, k) => (out[e.i] = pr[k]!));
      } else {
        const lo = quantile(values, 0) ?? 0;
        const hi = quantile(values, 1) ?? 0;
        present.forEach((e) => (out[e.i] = hi > lo ? (e.v - lo) / (hi - lo) : 0));
      }
    }
    normalized[key] = out;
  }

  const totalWeight = RISK_INDICATORS.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  const rows: RiskRow[] = inputs.map((r, i) => {
    let weighted = 0;
    let availableWeight = 0;
    const rawRow = {} as Record<RiskIndicator, number | null>;
    const normRow = {} as Record<RiskIndicator, number | null>;
    for (const key of RISK_INDICATORS) {
      rawRow[key] = raw[key][i]!;
      normRow[key] = normalized[key][i]!;
      const w = Math.max(0, weights[key]);
      if (w > 0 && normRow[key] !== null) {
        weighted += w * (normRow[key] as number);
        availableWeight += w;
      }
    }
    const interval = poissonInterval(r.count, 0.05);
    const uncertainty: RiskRow["uncertainty"] = r.count < 5 ? "high" : r.count < 15 ? "moderate" : "low";
    return {
      segmentId: r.segmentId,
      name: r.name,
      roadClass: r.roadClass,
      count: r.count,
      lengthM: r.lengthM,
      perKm: raw.density[i] as number,
      severityPerKm: raw.severity[i] as number,
      exposureRate: r.exposureRate,
      lighting: r.lighting,
      speedLimitKmh: r.speedLimitKmh,
      raw: rawRow,
      normalized: normRow,
      score: availableWeight > 0 ? Math.round((100 * weighted) / availableWeight * 10) / 10 : 0,
      coverage: totalWeight > 0 ? availableWeight / totalWeight : 0,
      ciLow: Math.round(interval.low * 10) / 10,
      ciHigh: Math.round(interval.high * 10) / 10,
      uncertainty,
      rank: 0,
    };
  });

  const order = rows.map((_, i) => i).sort((a, b) => rows[b]!.score - rows[a]!.score || rows[b]!.count - rows[a]!.count);
  order.forEach((idx, rank) => (rows[idx]!.rank = rank + 1));
  return rows;
}
