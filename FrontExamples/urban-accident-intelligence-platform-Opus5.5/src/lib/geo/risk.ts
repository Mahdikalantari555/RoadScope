/**
 * Transparent, interpretable road-segment risk assessment.
 *
 * Quantities are deliberately kept distinct:
 *   - Observed frequency N_i (count, with exact Poisson CI)
 *   - Density  N_i / (L_i · years)                          [crashes / km / year]
 *   - Rate     N_i / (AADT_i · 365 · years · L_i / 1e6)     [crashes / million vehicle-km]  (exposure-aware)
 *   - EB expected frequency (Hauer 1997; AASHTO HSM method-of-moments variant): shrinks N_i towards the
 *     reference-group mean μ_i to correct regression-to-the-mean. NOT a probability.
 *   - Relative Risk Index (0–100): configurable weighted sum of percentile-ranked indicators.
 *     Unitless, ordinal, uncalibrated — explicitly not an accident probability.
 * Rank uncertainty: Monte-Carlo draws from the Gamma posterior of each segment's mean frequency.
 */
import { mulberry32, poissonCI, gaussian } from "./stats";

export interface RiskSegment {
  id: number;
  name: string;
  roadClass: string;
  lengthM: number;
  speedLimit: number;
  lanes: number;
  lit: boolean;
  aadt: number | null;
}

export interface RiskEvent {
  segmentId: number;
  severity: string;
  adverseWeather: boolean;
  dark: boolean;
  pending: boolean;
}

export interface RiskWeights {
  frequency: number;
  severity: number;
  exposure: number;
  road: number;
  environment: number;
}

export interface RiskConfig {
  years: number;
  epdoWeights: Record<string, number>;
  weights: RiskWeights;
  useEmpiricalBayes: boolean;
  useExposure: boolean;
  topK: number;
  simulations: number;
  seed: number;
}

export interface RiskRow {
  id: number;
  name: string;
  roadClass: string;
  lengthM: number;
  n: number;
  ciLow: number;
  ciHigh: number;
  epdo: number;
  densityKmYr: number;
  epdoKmYr: number;
  ratePerMVKm: number | null;
  expected: number;
  ebWeight: number;
  eb: number;
  psi: number;
  components: Record<keyof RiskWeights, number | null>;
  index: number;
  rankIndex: number;
  rankSafety: number;
  rankLow: number;
  rankHigh: number;
  pTopK: number;
  reliability: "low" | "moderate" | "high";
  pendingShare: number;
}

export interface RiskOutput {
  rows: RiskRow[];
  groups: { roadClass: string; segments: number; meanRateKm: number; overdispersion: number; totalN: number }[];
  coverage: {
    segments: number;
    segmentsWithEvents: number;
    segmentsWithAadt: number;
    lowReliabilityShare: number;
    totalEvents: number;
    pendingEventsUsed: number;
    years: number;
  };
  effectiveWeights: RiskWeights;
  notes: string[];
}

function percentileRanks(values: (number | null)[]): (number | null)[] {
  const valid = values.map((v, i) => [v, i] as const).filter((p): p is readonly [number, number] => p[0] !== null);
  const sorted = [...valid].sort((a, b) => a[0] - b[0]);
  const out: (number | null)[] = values.map(() => null);
  let k = 0;
  while (k < sorted.length) {
    let e = k;
    while (e + 1 < sorted.length && sorted[e + 1][0] === sorted[k][0]) e++;
    const pr = sorted.length > 1 ? (k + e) / 2 / (sorted.length - 1) : 0.5; // mid-rank for ties
    for (let t = k; t <= e; t++) out[sorted[t][1]] = pr;
    k = e + 1;
  }
  return out;
}

/** Marsaglia–Tsang Gamma(shape, scale=1) sampler. */
function gammaSample(shape: number, rng: () => number): number {
  if (shape < 1) return gammaSample(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function assessRisk(segments: RiskSegment[], events: RiskEvent[], cfg: RiskConfig): RiskOutput {
  const notes: string[] = [];
  const idx = new Map(segments.map((s, i) => [s.id, i]));
  const n = new Array<number>(segments.length).fill(0);
  const epdo = new Array<number>(segments.length).fill(0);
  const adverse = new Array<number>(segments.length).fill(0);
  const pend = new Array<number>(segments.length).fill(0);
  let pendingUsed = 0;
  for (const e of events) {
    const i = idx.get(e.segmentId);
    if (i === undefined) continue;
    n[i]++;
    epdo[i] += cfg.epdoWeights[e.severity] ?? 1;
    if (e.adverseWeather || e.dark) adverse[i]++;
    if (e.pending) {
      pend[i]++;
      pendingUsed++;
    }
  }
  const years = Math.max(cfg.years, 1 / 365);
  const hasAadt = segments.filter((s) => s.aadt && s.aadt > 0).length;
  const useExposure = cfg.useExposure && hasAadt === segments.length;
  if (cfg.useExposure && !useExposure) notes.push("Exposure (AADT) missing for some segments — exposure-aware terms disabled.");
  const exposureOf = (s: RiskSegment) => (useExposure ? (s.lengthM / 1000) * (s.aadt as number) * 365 * years / 1e6 : (s.lengthM / 1000) * years);

  // Reference groups (road class) — method-of-moments EB.
  const groupStats = new Map<string, { lambda: number; phi: number; idxs: number[] }>();
  for (const cls of new Set(segments.map((s) => s.roadClass))) {
    const idxs = segments.map((s, i) => (s.roadClass === cls ? i : -1)).filter((i) => i >= 0);
    const sumN = idxs.reduce((a, i) => a + n[i], 0);
    const sumE = idxs.reduce((a, i) => a + exposureOf(segments[i]), 0);
    const lambda = sumE > 0 ? sumN / sumE : 0;
    let num = 0;
    let den = 0;
    for (const i of idxs) {
      const mu = lambda * exposureOf(segments[i]);
      num += (n[i] - mu) ** 2 - n[i];
      den += mu * mu;
    }
    groupStats.set(cls, { lambda, phi: den > 0 ? Math.max(0, num / den) : 0, idxs });
  }

  const totalEvents = n.reduce((a, b) => a + b, 0);
  const meanAdverse = totalEvents ? adverse.reduce((a, b) => a + b, 0) / totalEvents : 0;
  const rows: RiskRow[] = segments.map((s, i) => {
    const g = groupStats.get(s.roadClass)!;
    const mu = g.lambda * exposureOf(s);
    const w = cfg.useEmpiricalBayes ? 1 / (1 + g.phi * mu) : 0;
    const eb = w * mu + (1 - w) * n[i];
    const [lo, hi] = poissonCI(n[i]);
    const km = s.lengthM / 1000;
    const relWidth = n[i] > 0 ? (hi - lo) / n[i] : Infinity;
    return {
      id: s.id,
      name: s.name,
      roadClass: s.roadClass,
      lengthM: s.lengthM,
      n: n[i],
      ciLow: lo,
      ciHigh: hi,
      epdo: epdo[i],
      densityKmYr: n[i] / km / years,
      epdoKmYr: epdo[i] / km / years,
      ratePerMVKm: s.aadt ? n[i] / ((km * s.aadt * 365 * years) / 1e6) : null,
      expected: mu,
      ebWeight: w,
      eb,
      psi: eb - mu,
      components: { frequency: null, severity: null, exposure: null, road: null, environment: null },
      index: 0,
      rankIndex: 0,
      rankSafety: 0,
      rankLow: 0,
      rankHigh: 0,
      pTopK: 0,
      reliability: n[i] < 3 || relWidth > 3 ? "low" : relWidth > 1.25 ? "moderate" : "high", // relative width of the exact 95% Poisson CI
      pendingShare: n[i] ? pend[i] / n[i] : 0,
    };
  });

  // Indicators (higher = worse), then percentile ranks.
  const freqRaw = rows.map((r) => (cfg.useEmpiricalBayes ? r.eb : r.n) / (r.lengthM / 1000) / years);
  const sevRaw = rows.map((r) => r.epdoKmYr);
  const expRaw = rows.map((r) => (useExposure ? r.ratePerMVKm : null));
  const roadRaw = segments.map((s) => (Math.min(s.speedLimit, 80) / 80) * 0.5 + (s.lanes > 2 ? 0.25 : 0) + (s.lit ? 0 : 0.25));
  const envRaw = rows.map((r, i) => (adverse[i] + 5 * meanAdverse) / (r.n + 5)); // shrunk share in adverse conditions
  const P = {
    frequency: percentileRanks(freqRaw),
    severity: percentileRanks(sevRaw),
    exposure: percentileRanks(expRaw),
    road: percentileRanks(roadRaw),
    environment: percentileRanks(envRaw),
  };
  const ew: RiskWeights = { ...cfg.weights };
  if (!useExposure) ew.exposure = 0;
  const wsum = Object.values(ew).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  (Object.keys(ew) as (keyof RiskWeights)[]).forEach((k) => (ew[k] = Math.max(0, ew[k]) / wsum));
  rows.forEach((r, i) => {
    let score = 0;
    (Object.keys(ew) as (keyof RiskWeights)[]).forEach((k) => {
      const v = P[k][i];
      r.components[k] = v;
      score += (v ?? 0) * ew[k];
    });
    r.index = Math.round(score * 1000) / 10;
  });
  [...rows].sort((a, b) => b.index - a.index).forEach((r, k) => (r.rankIndex = k + 1));

  // Primary safety metric ranking (EB or observed density) with posterior rank uncertainty.
  const metric = rows.map((r, i) => freqRaw[i]);
  [...rows.keys()].sort((a, b) => metric[b] - metric[a]).forEach((i, k) => (rows[i].rankSafety = k + 1));
  const rng = mulberry32(cfg.seed);
  const S = Math.max(0, Math.min(1000, cfg.simulations));
  const rankSamples: number[][] = rows.map(() => []);
  const topCount = new Array<number>(rows.length).fill(0);
  for (let sIdx = 0; sIdx < S; sIdx++) {
    const draws = rows.map((r) => {
      const g = groupStats.get(r.roadClass)!;
      let theta: number;
      if (cfg.useEmpiricalBayes && g.phi > 0 && r.expected > 0) {
        const shape = 1 / g.phi + r.n;
        const rate = 1 / (g.phi * r.expected) + 1;
        theta = gammaSample(shape, rng) / rate;
      } else theta = gammaSample(r.n + 0.5, rng); // Jeffreys posterior
      return theta / (r.lengthM / 1000) / years;
    });
    [...draws.keys()].sort((a, b) => draws[b] - draws[a]).forEach((i, k) => {
      rankSamples[i].push(k + 1);
      if (k < cfg.topK) topCount[i]++;
    });
  }
  rows.forEach((r, i) => {
    if (!S) {
      r.rankLow = r.rankHigh = r.rankSafety;
      return;
    }
    const sr = rankSamples[i].sort((a, b) => a - b);
    r.rankLow = sr[Math.floor(0.05 * (sr.length - 1))];
    r.rankHigh = sr[Math.ceil(0.95 * (sr.length - 1))];
    r.pTopK = topCount[i] / S;
  });

  const groups = [...groupStats.entries()].map(([roadClass, g]) => ({
    roadClass,
    segments: g.idxs.length,
    meanRateKm: useExposure ? g.lambda : g.lambda,
    overdispersion: g.phi,
    totalN: g.idxs.reduce((a, i) => a + n[i], 0),
  }));
  if (cfg.useEmpiricalBayes)
    notes.push("EB reference model: group mean rate × exposure per road class (no covariate SPF). Calibrate a negative-binomial SPF before operational use.");
  notes.push("The Relative Risk Index is an ordinal, uncalibrated composite. It is not a probability of accident occurrence.");
  return {
    rows,
    groups,
    coverage: {
      segments: segments.length,
      segmentsWithEvents: n.filter((v) => v > 0).length,
      segmentsWithAadt: hasAadt,
      lowReliabilityShare: rows.filter((r) => r.reliability === "low").length / Math.max(1, rows.length),
      totalEvents,
      pendingEventsUsed: pendingUsed,
      years,
    },
    effectiveWeights: ew,
    notes,
  };
}
