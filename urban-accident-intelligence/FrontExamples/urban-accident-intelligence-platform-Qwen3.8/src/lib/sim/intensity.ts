/**
 * Ground-truth intensity model of the simulator:
 * an Inhomogeneous Spatiotemporal Poisson/Cox Point Process **on a linear
 * network** (Okabe & Sugihara 2012; Rao 2019).
 *
 *   λ(s, t) = Λ(s) · τ(t) · Ξ(s, t)
 *
 *   Λ(s) = β0 · f_class(e) · f_int(m; d_node) · f_exp(AADT) · f_geom · f_env · f_lat(s)
 *   τ(t) = diurnal(h) · weekly(dow) · seasonal(doy)
 *   Ξ(s,t) = 1 + rush-hour × arterial interaction (non-separable term)
 *
 * Λ is expressed as *expected crashes per lixel over the study window*; τ is
 * numerically normalised to mean 1 over a full week × 24 h profile so that the
 * temporal modulation redistributes, but never inflates, the expected count.
 * Because Ξ and all covariate terms are pure functions of persisted parameters,
 * λ can be recomputed exactly at benchmark time (Epic 1 / US-1.4).
 */
import type { GraphLixel } from "@/lib/geo/graph";

export type Scenario =
  | "uniform_baseline"
  | "intersection_clustered"
  | "diurnal_rush_hour_shock"
  | "multi_covariate_complex_urban";

export interface LatentBump {
  x: number;
  y: number;
  amplitude: number;
  sigmaM: number;
}

export interface SimParams {
  scenario: Scenario;
  seed: number;
  studyDays: number;
  windowStartIso: string;
  baseRatePerKmPerYear: number;
  lixelLengthM: number;
  intersectionDecayM: number;
  intersectionWeight: number;
  exposureElasticity: number;
  speedExponent: number;
  laneFactor: number;
  curvatureFactor: number;
  unlitFactor: number;
  wetFactor: number;
  latentBumps: LatentBump[];
  latentAmplitude: number;
  diurnalAmplitude: number;
  weeklyAmplitude: number;
  seasonalAmplitude: number;
  rushHourInteraction: number;
  wetShare: number;
  // VGI observation model
  reportingProbabilityBase: number;
  positionalDriftSigmaM: number;
  driftSigmaScale: number;
  falseAlarmRate: number;
  duplicateBurstMean: number;
  lagMedianSeconds: number;
  severityMisclassificationRate: number;
  attributeNoiseRate: number;
}

export const SCENARIO_LABELS: Record<Scenario, string> = {
  uniform_baseline: "Uniform Baseline (homogeneous network intensity)",
  intersection_clustered: "Intersection-Clustered (exponential node decay)",
  diurnal_rush_hour_shock: "Diurnal Rush-Hour Shock (bimodal τ(t))",
  multi_covariate_complex_urban: "Multi-Covariate Complex Urban (latent Cox field)",
};

export const CLASS_RISK: Record<string, number> = {
  motorway: 0.55,
  primary: 1.45,
  secondary: 1.25,
  tertiary: 1.0,
  residential: 0.72,
  service: 0.45,
};

export function scenarioParams(scenario: Scenario, seed: number, lixelLengthM: number, extent: { minX: number; minY: number; maxX: number; maxY: number }, startIso: string): SimParams {
  const base: SimParams = {
    scenario,
    seed,
    studyDays: 365,
    windowStartIso: startIso,
    baseRatePerKmPerYear: 5.2,
    lixelLengthM,
    intersectionDecayM: 55,
    intersectionWeight: 0.5,
    exposureElasticity: 0.45,
    speedExponent: 1.25,
    laneFactor: 0.16,
    curvatureFactor: 0.6,
    unlitFactor: 1.42,
    wetFactor: 1.55,
    latentBumps: [],
    latentAmplitude: 0,
    diurnalAmplitude: 0.35,
    weeklyAmplitude: 0.18,
    seasonalAmplitude: 0.12,
    rushHourInteraction: 0,
    wetShare: 0.22,
    reportingProbabilityBase: 0.72,
    positionalDriftSigmaM: 16,
    driftSigmaScale: 1,
    falseAlarmRate: 0.045,
    duplicateBurstMean: 0.55,
    lagMedianSeconds: 900,
    severityMisclassificationRate: 0.11,
    attributeNoiseRate: 0.08,
  };

  const w = extent.maxX - extent.minX;
  const h = extent.maxY - extent.minY;
  const bumps: LatentBump[] = [];
  const bumpCount = scenario === "multi_covariate_complex_urban" ? 9 : scenario === "intersection_clustered" ? 3 : 0;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < bumpCount; i++) {
    bumps.push({
      x: extent.minX + rnd() * w,
      y: extent.minY + rnd() * h,
      amplitude: 0.5 + rnd() * 1.9,
      sigmaM: 260 + rnd() * 620,
    });
  }

  switch (scenario) {
    case "uniform_baseline":
      return { ...base, latentBumps: bumps, intersectionWeight: 0.0, diurnalAmplitude: 0.06, weeklyAmplitude: 0.03, baseRatePerKmPerYear: 4.4 };
    case "intersection_clustered":
      return {
        ...base,
        latentBumps: bumps,
        latentAmplitude: 0.55,
        intersectionWeight: 2.6,
        intersectionDecayM: 42,
        diurnalAmplitude: 0.22,
      };
    case "diurnal_rush_hour_shock":
      return {
        ...base,
        latentBumps: bumps,
        latentAmplitude: 0.4,
        intersectionWeight: 0.9,
        diurnalAmplitude: 1.5,
        weeklyAmplitude: 0.3,
        rushHourInteraction: 0.65,
        baseRatePerKmPerYear: 4.8,
      };
    case "multi_covariate_complex_urban":
      return {
        ...base,
        latentBumps: bumps,
        latentAmplitude: 1.25,
        intersectionWeight: 1.75,
        intersectionDecayM: 48,
        diurnalAmplitude: 0.95,
        weeklyAmplitude: 0.32,
        seasonalAmplitude: 0.22,
        rushHourInteraction: 0.4,
        exposureElasticity: 0.62,
        speedExponent: 1.55,
        wetShare: 0.28,
        baseRatePerKmPerYear: 6.1,
        positionalDriftSigmaM: 21,
        falseAlarmRate: 0.062,
        duplicateBurstMean: 0.78,
      };
  }
}

/* ---------------------------------------------------------------- */
/* Spatial intensity Λ(s)                                            */
/* ---------------------------------------------------------------- */

export function latentField(x: number, y: number, p: SimParams): number {
  if (p.latentAmplitude <= 0 || p.latentBumps.length === 0) return 1;
  let acc = 0;
  for (const b of p.latentBumps) {
    const d2 = (x - b.x) ** 2 + (y - b.y) ** 2;
    acc += b.amplitude * Math.exp(-d2 / (2 * b.sigmaM * b.sigmaM));
  }
  return Math.max(0.08, 1 + p.latentAmplitude * (acc - 1));
}

export function intersectionFactor(distToNodeM: number, p: SimParams): number {
  if (p.intersectionWeight <= 0) return 1;
  return 1 + p.intersectionWeight * Math.exp(-distToNodeM / p.intersectionDecayM);
}

export function exposureFactor(aadt: number | null, p: SimParams): number {
  if (aadt === null || aadt <= 0) return 1;
  return Math.pow(aadt / 10000, p.exposureElasticity);
}

/**
 * Expected crashes for one lixel across the whole study window (Λ(s)).
 * Units: crashes · lixel⁻¹ · window⁻¹.
 */
export function lambdaLixel(l: GraphLixel, p: SimParams, wetMultiplier: number): number {
  const perKmYear =
    p.baseRatePerKmPerYear *
    (CLASS_RISK[l.roadClass] ?? 1) *
    intersectionFactor(l.distToNodeM, p) *
    exposureFactor(l.aadt, p) *
    Math.pow(l.speedLimitKph / 50, p.speedExponent) *
    (1 + p.laneFactor * Math.max(0, l.lanes - 2)) *
    latentField(l.x, l.y, p) *
    (1 + p.wetShare * (wetMultiplier - 1)) *
    (1 + p.curvatureFactor * 0.02);
  return Math.max(0, perKmYear * (l.lengthM / 1000) * (p.studyDays / 365));
}

/* ---------------------------------------------------------------- */
/* Temporal intensity τ(t)                                           */
/* ---------------------------------------------------------------- */

function gauss(x: number, mu: number, sigma: number): number {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

/** Bimodal commute profile + night trough. Mean ≈ 1 after normalisation. */
export function diurnalFactor(hourDecimal: number, p: SimParams): number {
  const a = p.diurnalAmplitude;
  const peaks = gauss(hourDecimal, 8.0, 1.25) + gauss(hourDecimal, 17.6, 1.55) + 0.42 * gauss(hourDecimal, 22.4, 2.0);
  const trough = 1 - 0.62 * gauss(hourDecimal, 3.6, 2.4);
  return Math.max(0.05, trough * (1 + a * (peaks - 0.55)));
}

export function weeklyFactor(dayOfWeek: number, p: SimParams): number {
  // 0 = Sunday
  const w = [0.82, 0.94, 0.98, 1.0, 1.05, 1.24, 1.16][dayOfWeek] ?? 1;
  return 1 + p.weeklyAmplitude * (w - 1);
}

export function seasonalFactor(dayOfYear: number, p: SimParams): number {
  return 1 + p.seasonalAmplitude * Math.cos(((dayOfYear - 15) / 365) * 2 * Math.PI);
}

/** Non-separable interaction: rush-hour exposure amplifies arterial risk. */
export function interactionFactor(hourDecimal: number, classOrdinal: number, p: SimParams): number {
  if (p.rushHourInteraction <= 0) return 1;
  const rush = gauss(hourDecimal, 8.0, 1.2) + gauss(hourDecimal, 17.6, 1.5);
  const arterial = classOrdinal <= 3 ? 1 : 0.25;
  return 1 + p.rushHourInteraction * rush * arterial * 0.6;
}

export function temporalFactor(date: Date, classOrdinal: number, p: SimParams): number {
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = Math.floor((date.getTime() - start) / 86400000);
  return (
    diurnalFactor(hour, p) *
    weeklyFactor(date.getUTCDay(), p) *
    seasonalFactor(doy, p) *
    interactionFactor(hour, classOrdinal, p)
  );
}

let normCache: { key: string; value: number } | null = null;
/** Numeric mean of τ over a week × 24 h so the profile is intensity-preserving. */
export function temporalNormalisation(p: SimParams, classOrdinal = 3): number {
  const key = `${p.seed}|${p.diurnalAmplitude}|${p.weeklyAmplitude}|${p.seasonalAmplitude}|${p.rushHourInteraction}|${classOrdinal}`;
  if (normCache && normCache.key === key) return normCache.value;
  let sum = 0;
  let n = 0;
  const base = new Date(Date.UTC(2025, 5, 15, 0, 0, 0));
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(base.getTime() + d * 86400000 + h * 3600000);
      const hour = h;
      const doy = 166 + d;
      sum +=
        diurnalFactor(hour, p) *
        weeklyFactor(t.getUTCDay(), p) *
        seasonalFactor(doy, p) *
        interactionFactor(hour, classOrdinal, p);
      n++;
    }
  }
  const value = sum / Math.max(1, n);
  normCache = { key, value };
  return value;
}

/** Hourly sampling profile (168 slots) used for inverse-CDF time assignment. */
export function hourlyProfile(p: SimParams, classOrdinal = 3): number[] {
  const norm = temporalNormalisation(p, classOrdinal);
  const base = new Date(Date.UTC(2025, 5, 15, 0, 0, 0)); // Sunday
  const out: number[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const t = new Date(base.getTime() + d * 86400000);
      const doy = 166 + d;
      out.push(
        (diurnalFactor(h, p) * weeklyFactor(t.getUTCDay(), p) * seasonalFactor(doy, p) * interactionFactor(h, classOrdinal, p)) / norm,
      );
    }
  }
  return out;
}
