/**
 * Phase 4 — Exposure-aware risk assessment.
 *
 * Four rigorously separated safety metrics (US-5.1):
 *   1. Raw crash frequency            N
 *   2. Linear crash density           N / L_km
 *   3. Severity-weighted EPDO index   Σ w_k N_k       (w: KABO-style multipliers)
 *   4. Exposure-normalised crash rate N / (VKT/1e6)   crashes per MVKT
 *
 * Empirical Bayes smoothing (US-5.2, Hauer 1997; HSM Part C):
 *   Safety Performance Function (SPF), log-linear in exposure:
 *       μ_i = exp( β0 + β1 · ln(VKT_i) + β2 · ln(L_i) + Σ_c γ_c · 1[class_i = c] )
 *   fitted per road class by Poisson quasi-likelihood (IRLS / Newton).
 *   Overdispersion φ estimated from the method-of-moments Pearson statistic.
 *   EB estimate:      E_i = w_i N_i + (1 − w_i) μ_i ,   w_i = φ / (φ + μ_i)
 *   Excess (PSI):     X_i = N_i − E_i ;   PSI_i = X_i / N_i
 *   95 % credible interval from the Gamma-Poisson posterior
 *       E_i | N_i ~ Gamma(φ + N_i, 1/(φ + μ_i·...))  (Wilson–Hilferty quantile).
 *
 * The composite multi-criteria score (US-5.3) is an explicit, weighted,
 * rank-based heuristic. It is *never* reported as a calibrated crash
 * probability — the UI and API both carry that disclaimer.
 */
import type { GraphLixel, GraphSegment, RoadGraph } from "@/lib/geo/graph";
import { gammaQuantile, normalQuantile } from "@/lib/util/rng";
import { mean, round } from "@/lib/stats/common";

export type MetricLevel = "lixel" | "segment";

export interface IncidentRecord {
  lixelIndex: number;
  segmentId: string;
  weight: number;
  epdo: number;
  severityRank: number;
  isVerified: boolean;
  isVgiOnly: boolean;
  positionalDriftM: number;
}

export interface UnitAggregates {
  unitId: string;
  level: MetricLevel;
  segmentId: string;
  lixelIndices: number[];
  lengthKm: number;
  roadClass: string;
  aadt: number | null;
  vktPerWindow: number | null;
  crashCount: number;
  crashDensityPerKm: number;
  epdo: number;
  epdoPerKm: number;
  crashRatePerMvkt: number | null;
  hasExposure: boolean;
  verifiedCount: number;
  vgiOnlyCount: number;
  meanDriftM: number;
}

export function aggregateUnits(
  graph: RoadGraph,
  incidents: IncidentRecord[],
  level: MetricLevel,
  studyDays: number,
): UnitAggregates[] {
  const lixelAgg = new Map<number, { n: number; epdo: number; verified: number; vgi: number; drift: number }>();
  for (const inc of incidents) {
    if (inc.lixelIndex < 0 || inc.lixelIndex >= graph.lixels.length) continue;
    const cur = lixelAgg.get(inc.lixelIndex) ?? { n: 0, epdo: 0, verified: 0, vgi: 0, drift: 0 };
    cur.n += inc.weight;
    cur.epdo += inc.epdo;
    cur.verified += inc.isVerified ? inc.weight : 0;
    cur.vgi += inc.isVgiOnly ? inc.weight : 0;
    cur.drift += inc.positionalDriftM * inc.weight;
    lixelAgg.set(inc.lixelIndex, cur);
  }

  if (level === "lixel") {
    return graph.lixels.map((l, i) => {
      const a = lixelAgg.get(i) ?? { n: 0, epdo: 0, verified: 0, vgi: 0, drift: 0 };
      const seg = graph.segmentById.get(l.segmentId);
      const lengthKm = l.lengthM / 1000;
      const vkt = l.aadt && seg ? (l.aadt * lengthKm * studyDays) / 1e6 : null;
      return {
        unitId: l.id,
        level: "lixel",
        segmentId: l.segmentId,
        lixelIndices: [i],
        lengthKm,
        roadClass: l.roadClass,
        aadt: l.aadt,
        vktPerWindow: vkt,
        crashCount: round(a.n, 4),
        crashDensityPerKm: lengthKm > 0 ? round(a.n / lengthKm, 4) : 0,
        epdo: round(a.epdo, 4),
        epdoPerKm: lengthKm > 0 ? round(a.epdo / lengthKm, 4) : 0,
        crashRatePerMvkt: vkt && vkt > 0 ? round(a.n / vkt, 6) : null,
        hasExposure: Boolean(vkt && vkt > 0),
        verifiedCount: a.verified,
        vgiOnlyCount: a.vgi,
        meanDriftM: a.n > 0 ? round(a.drift / a.n, 3) : 0,
      };
    });
  }

  const bySegment = new Map<string, UnitAggregates>();
  graph.segments.forEach((s: GraphSegment) => {
    const lengthKm = (s.lengthM * s.sinuosity) / 1000;
    const vkt = s.aadt ? (s.aadt * lengthKm * studyDays) / 1e6 : null;
    bySegment.set(s.id, {
      unitId: s.id,
      level: "segment",
      segmentId: s.id,
      lixelIndices: [],
      lengthKm,
      roadClass: s.roadClass,
      aadt: s.aadt,
      vktPerWindow: vkt,
      crashCount: 0,
      crashDensityPerKm: 0,
      epdo: 0,
      epdoPerKm: 0,
      crashRatePerMvkt: null,
      hasExposure: Boolean(vkt && vkt > 0),
      verifiedCount: 0,
      vgiOnlyCount: 0,
      meanDriftM: 0,
    });
  });
  graph.lixels.forEach((l: GraphLixel, i: number) => {
    const u = bySegment.get(l.segmentId);
    if (!u) return;
    u.lixelIndices.push(i);
    const a = lixelAgg.get(i);
    if (!a) return;
    u.crashCount += a.n;
    u.epdo += a.epdo;
    u.verifiedCount += a.verified;
    u.vgiOnlyCount += a.vgi;
    u.meanDriftM += a.drift;
  });
  for (const u of bySegment.values()) {
    u.crashCount = round(u.crashCount, 4);
    u.epdo = round(u.epdo, 4);
    u.crashDensityPerKm = u.lengthKm > 0 ? round(u.crashCount / u.lengthKm, 4) : 0;
    u.epdoPerKm = u.lengthKm > 0 ? round(u.epdo / u.lengthKm, 4) : 0;
    u.crashRatePerMvkt = u.vktPerWindow && u.vktPerWindow > 0 ? round(u.crashCount / u.vktPerWindow, 6) : null;
    u.meanDriftM = u.crashCount > 0 ? round(u.meanDriftM / u.crashCount, 3) : 0;
  }
  return Array.from(bySegment.values());
}

/* ------------------------------------------------------------------ */
/* Safety Performance Function                                         */
/* ------------------------------------------------------------------ */

export interface SpfFit {
  droppedCollinearColumns?: string[];
  keptColumns?: string[];
  beta0: number;
  betaVkt: number;
  betaLength: number;
  classCoefficients: Record<string, number>;
  phi: number;
  deviance: number;
  iterations: number;
  converged: boolean;
  n: number;
  classes: string[];
  predictedMeanMvktRate: number;
}

/**
 * Poisson quasi-likelihood IRLS fit of ln μ = β0 + β1 ln(VKT_M) + β2 ln(L) + γ_class.
 * Units without exposure are excluded from the fit but receive a class-level
 * prior (documented epistemic gap).
 */
export function fitSpf(units: UnitAggregates[]): { fit: SpfFit | null; excluded: number } {
  const usable = units.filter((u) => u.hasExposure && (u.vktPerWindow ?? 0) > 0);
  const excluded = units.length - usable.length;
  if (usable.length < 12) return { fit: null, excluded };

  const classes = Array.from(new Set(usable.map((u) => u.roadClass))).sort();
  const n = usable.length;
  const columnNames = ["intercept", "ln_vkt", "ln_length", ...classes.slice(1).map((c) => `class_${c}`)];
  const Xall: number[][] = usable.map((u) => {
    const row = [1, Math.log(Math.max(1e-6, u.vktPerWindow as number)), Math.log(Math.max(1e-6, u.lengthKm))];
    for (let c = 1; c < classes.length; c++) row.push(u.roadClass === classes[c] ? 1 : 0);
    return row;
  });
  // Rank guard: at a fixed lixel resolution ln(L) is constant and therefore
  // collinear with the intercept. Constant columns are dropped and reported so
  // the fitted SPF stays interpretable and the information matrix invertible.
  const dropped: string[] = [];
  const keepCols: number[] = [];
  for (let c = 0; c < Xall[0].length; c++) {
    if (c === 0) { keepCols.push(c); continue; }
    const vals = Xall.map((r) => r[c]);
    const m = mean(vals);
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, vals.length));
    if (sd < 1e-10) dropped.push(columnNames[c]);
    else keepCols.push(c);
  }
  const X: number[][] = Xall.map((r) => keepCols.map((c) => r[c]));
  const keptNames = keepCols.map((c) => columnNames[c]);
  const p = keepCols.length;
  const y = usable.map((u) => u.crashCount);

  let beta0 = 0;
  let betaVkt = 0;
  let betaLength = 0;
  let beta = new Array(p).fill(0);
  beta[0] = Math.log(Math.max(1e-6, mean(y)) || 1e-6);
  if (keptNames.includes("ln_vkt")) beta[keptNames.indexOf("ln_vkt")] = 0.5;
  let converged = false;
  let iterations = 0;
  for (let it = 0; it < 60; it++) {
    iterations = it + 1;
    const mu = X.map((row) => Math.exp(clamp(row.reduce((s, v, i) => s + v * beta[i], 0), -20, 12)));
    // score and information
    const score = new Array(p).fill(0);
    const info: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < p; a++) score[a] += X[i][a] * (y[i] - mu[i]);
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) info[a][b] += X[i][a] * X[i][b] * mu[i];
    }
    // Tikhonov regularisation keeps the normal equations invertible.
    for (let a = 0; a < p; a++) info[a][a] += 1e-8;
    const delta = solve(info, score);
    if (!delta) break;
    const step = 1;
    for (let a = 0; a < p; a++) beta[a] += step * delta[a];
    const maxAbs = Math.max(...delta.map((d) => Math.abs(d)));
    if (maxAbs < 1e-8) {
      converged = true;
      break;
    }
  }

  const mu = X.map((row) => Math.exp(clamp(row.reduce((s, v, i) => s + v * beta[i], 0), -20, 12)));
  let pearson = 0;
  let deviance = 0;
  for (let i = 0; i < n; i++) {
    pearson += (y[i] - mu[i]) ** 2 / Math.max(1e-9, mu[i]);
    deviance += 2 * (y[i] > 0 ? y[i] * Math.log(y[i] / mu[i]) : 0) - 2 * (y[i] - mu[i]);
  }
  const dof = Math.max(1, n - p);
  // Method of moments on E[(N−μ)²/μ] = 1 + φ·μ  ⇒  φ̂ = (χ²/dof − 1) / mean(μ).
  const dispersion = pearson / dof;
  const phi = Math.max(0.05, Math.min(50, (dispersion - 1) / Math.max(1e-9, mean(mu))));
  const classCoefficients: Record<string, number> = {};
  classes.forEach((c) => { classCoefficients[c] = 0; });
  keptNames.forEach((name, idx) => {
    if (name.startsWith("class_")) classCoefficients[name.slice(6)] = round(beta[idx], 6);
  });
  const coefficientOf = (name: string) => {
    const idx = keptNames.indexOf(name);
    return idx >= 0 ? beta[idx] : 0;
  };
  beta0 = coefficientOf("intercept");
  betaVkt = coefficientOf("ln_vkt");
  betaLength = coefficientOf("ln_length");
  return {
    fit: {
      beta0: round(beta0, 6),
      betaVkt: round(betaVkt, 6),
      betaLength: round(betaLength, 6),
      droppedCollinearColumns: dropped,
      keptColumns: keptNames,
      classCoefficients,
      phi: round(phi, 6),
      deviance: round(deviance, 4),
      iterations,
      converged,
      n,
      classes,
      predictedMeanMvktRate: round(mean(mu.map((m, i) => m / Math.max(1e-9, usable[i].vktPerWindow as number))), 6),
    },
    excluded,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function spfPredict(u: UnitAggregates, fit: SpfFit): number {
  const vkt = u.vktPerWindow ?? 0;
  if (vkt <= 0) {
    // Class-level prior: mean observed density for that class × length.
    return Math.max(1e-6, (fit.predictedMeanMvktRate || 0.5) * u.lengthKm * 0.5);
  }
  const kept = fit.keptColumns ?? ["intercept", "ln_vkt", "ln_length"];
  const lp =
    fit.beta0 +
    (kept.includes("ln_vkt") ? fit.betaVkt * Math.log(Math.max(1e-6, vkt)) : 0) +
    (kept.includes("ln_length") ? fit.betaLength * Math.log(Math.max(1e-6, u.lengthKm)) : 0) +
    (fit.classCoefficients[u.roadClass] ?? 0);
  return Math.max(1e-6, Math.exp(clamp(lp, -20, 12)));
}

/* ------------------------------------------------------------------ */
/* Empirical Bayes                                                     */
/* ------------------------------------------------------------------ */

export interface EbRow {
  spfExpected: number;
  phi: number;
  weight: number;
  estimate: number;
  lower95: number;
  upper95: number;
  excess: number;
  psi: number;
}

export function empiricalBayes(observed: number, mu: number, phi: number): EbRow {
  // Prior  λ ~ Gamma(shape = 1/φ, scale = φμ)  ⇒  E[λ] = μ, Var(λ) = φμ².
  // Likelihood N ~ Poisson(λ).
  // Posterior λ|N ~ Gamma(shape = N + 1/φ, scale = φμ/(1+φμ)).
  // Posterior mean = w·N + (1−w)·μ with w = φμ/(1+φμ): exposure-increasing, so
  // well-exposed segments trust their observed count and thin segments are
  // shrunk onto the SPF prior (this is what removes regression-to-the-mean).
  const safeMu = Math.max(1e-9, mu);
  const safePhi = Math.max(1e-9, phi);
  const w = (safePhi * safeMu) / (1 + safePhi * safeMu);
  const estimate = w * observed + (1 - w) * safeMu;
  const shape = observed + 1 / safePhi;
  const scale = w;
  const lower95 = gammaQuantile(0.025, shape, scale);
  const upper95 = gammaQuantile(0.975, shape, scale);
  const excess = observed - estimate;
  return {
    spfExpected: round(safeMu, 6),
    phi: round(safePhi, 6),
    weight: round(w, 6),
    estimate: round(estimate, 6),
    lower95: round(lower95, 6),
    upper95: round(upper95, 6),
    excess: round(excess, 6),
    psi: observed > 0 ? round(excess / observed, 6) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Uncertainty (US-5.4)                                                */
/* ------------------------------------------------------------------ */

export interface UncertaintyComponents {
  sampleSparsity: number;
  exposureGap: number;
  vgiRatio: number;
  positionalDrift: number;
}

/**
 * Epistemic + aleatoric uncertainty in [0,1]; 1 = maximally uncertain.
 *  • sampleSparsity: Poisson coefficient of variation of the EB posterior,
 *  • exposureGap   : AADT/VKT missing or imputed,
 *  • vgiRatio      : share of evidence that is unverified crowd input,
 *  • positionalDrift: mean map-matching residual normalised by lixel length.
 */
export function uncertainty(
  u: UnitAggregates,
  eb: EbRow | null,
  lixelLengthM: number,
): { total: number; components: UncertaintyComponents } {
  const sampleSparsity = eb && eb.estimate > 0 ? Math.min(1, 1 / Math.sqrt(Math.max(0.25, eb.estimate))) : 1;
  const exposureGap = u.hasExposure ? (u.aadt === null ? 0.8 : 0.08) : 0.85;
  const totalObs = u.verifiedCount + u.vgiOnlyCount;
  const vgiRatio = totalObs > 0 ? Math.min(1, u.vgiOnlyCount / totalObs) : 0.6;
  const positionalDrift = Math.min(1, u.meanDriftM / Math.max(10, lixelLengthM * 2));
  const total = round(
    Math.min(1, 0.4 * sampleSparsity + 0.25 * exposureGap + 0.2 * vgiRatio + 0.15 * positionalDrift),
    4,
  );
  return {
    total,
    components: {
      sampleSparsity: round(sampleSparsity, 4),
      exposureGap: round(exposureGap, 4),
      vgiRatio: round(vgiRatio, 4),
      positionalDrift: round(positionalDrift, 4),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Multi-criteria composite (explicitly heuristic)                     */
/* ------------------------------------------------------------------ */

export interface CompositeWeights {
  ebRisk: number;
  severity: number;
  geometry: number;
  environment: number;
  exposure: number;
}

export const DEFAULT_COMPOSITE_WEIGHTS: CompositeWeights = {
  ebRisk: 0.4,
  severity: 0.25,
  geometry: 0.15,
  environment: 0.1,
  exposure: 0.1,
};

export function normalizeWeights(w: CompositeWeights): CompositeWeights {
  const total = Object.values(w).reduce((s, v) => s + Math.max(0, v), 0) || 1;
  return {
    ebRisk: w.ebRisk / total,
    severity: w.severity / total,
    geometry: w.geometry / total,
    environment: w.environment / total,
    exposure: w.exposure / total,
  };
}

function rankTransform(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  order.forEach((o, r) => {
    out[o.i] = order.length <= 1 ? 0 : r / (order.length - 1);
  });
  return out;
}

export interface CompositeInput {
  ebEstimate: number;
  epdoPerKm: number;
  curvaturePerKm: number;
  sinuosity: number;
  speedLimitKph: number;
  lanes: number;
  unlitShare: number;
  wetShare: number;
  exposureGapPenalty: number;
}

export function compositeScore(inputs: CompositeInput[], weights: CompositeWeights): { scores: number[]; facets: Record<string, number[]> } {
  const w = normalizeWeights(weights);
  const facets = {
    ebRisk: rankTransform(inputs.map((i) => i.ebEstimate)),
    severity: rankTransform(inputs.map((i) => i.epdoPerKm)),
    geometry: rankTransform(inputs.map((i) => 0.5 * i.curvaturePerKm + 0.3 * (i.sinuosity - 1) * 10 + 0.2 * (i.speedLimitKph / 120) * i.lanes)),
    environment: rankTransform(inputs.map((i) => i.unlitShare * 1.4 + i.wetShare)),
    exposure: rankTransform(inputs.map((i) => i.exposureGapPenalty)),
  };
  const scores = inputs.map((_, idx) =>
    round(
      w.ebRisk * facets.ebRisk[idx] +
        w.severity * facets.severity[idx] +
        w.geometry * facets.geometry[idx] +
        w.environment * facets.environment[idx] +
        w.exposure * facets.exposure[idx],
      6,
    ),
  );
  return { scores, facets };
}

/** Relative-precision (standard error of the rate) for confidence-interval bands. */
export function rateConfidenceInterval(count: number, exposure: number, z = 1.96): { lower: number; upper: number } {
  if (exposure <= 0) return { lower: 0, upper: 0 };
  const rate = count / exposure;
  const se = Math.sqrt(Math.max(count, 1)) / exposure;
  return { lower: Math.max(0, rate - z * se), upper: rate + z * se };
}

export function zFromP(p: number): number {
  return normalQuantile(1 - p / 2);
}
