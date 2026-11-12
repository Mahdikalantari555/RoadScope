/**
 * US-1.4 — Algorithmic ground-truth evaluation.
 *
 * Because the simulator is an inhomogeneous network point process with a known
 * λ(s,t), every estimated surface can be scored against the oracle.
 *
 *   RRI(k)  = a_k / A                     recapture rate: share of true events
 *                                          captured by the top-k% of units
 *   PAI(k)  = (a_k / A) / (n_k / N)       prediction accuracy index: RRI
 *                                          normalised by the share of units used
 *   RMSE    = √( mean_i (λ̂_i − λ_i)² )     on a common scale (expected counts
 *                                          per lixel per window)
 * plus Spearman ρ, Pearson r, R², Gini/Lorenz concentration and a full
 * capture-rate curve for publication figures.
 */
import { mae, mean, pearson, r2, rmse, round, spearman, gini } from "@/lib/stats/common";

export interface BenchmarkInput {
  /** Estimated surface, expected crashes per lixel over the study window. */
  predicted: number[];
  /** Oracle Λ(s) integrated over the study window. */
  trueLambda: number[];
  /** Oracle realised counts (a single stochastic realisation of the process). */
  realizedCounts: number[];
  lixelLengthM?: number[];
  topPercent?: number[];
  label?: string;
}

export interface CurvePoint {
  percentUnits: number;
  units: number;
  capturedTrue: number;
  rri: number;
  pai: number;
  cumulativeShare: number;
}

export interface BenchmarkResult {
  label: string;
  n: number;
  curve: CurvePoint[];
  pai10: number;
  pai5: number;
  rri10: number;
  rri5: number;
  rmseVsLambda: number;
  maeVsLambda: number;
  rmseVsRealized: number;
  r2VsLambda: number;
  spearmanVsLambda: number;
  pearsonVsLambda: number;
  spearmanVsRealized: number;
  biasRatio: number;
  gini: number;
  scaleNote: string;
  runtimeMs: number;
}

export function evaluateAgainstGroundTruth(input: BenchmarkInput): BenchmarkResult {
  const t0 = Date.now();
  const n = Math.min(input.predicted.length, input.trueLambda.length, input.realizedCounts.length);
  if (n === 0) {
    const empty = { label: input.label ?? "layer", n: 0, curve: [] as CurvePoint[], pai10: 0, pai5: 0, rri10: 0, rri5: 0, rmseVsLambda: 0, maeVsLambda: 0, rmseVsRealized: 0, r2VsLambda: 0, spearmanVsLambda: 0, pearsonVsLambda: 0, spearmanVsRealized: 0, biasRatio: 0, gini: 0, scaleNote: "empty input", runtimeMs: Date.now() - t0 };
    return empty;
  }
  const predicted = input.predicted.slice(0, n);
  const truth = input.trueLambda.slice(0, n);
  const realized = input.realizedCounts.slice(0, n);

  // Rescale the estimate onto the oracle's expected-count scale.
  const sumPred = predicted.reduce((a, b) => a + b, 0);
  const sumTruth = truth.reduce((a, b) => a + b, 0);
  const scale = sumPred > 1e-12 ? sumTruth / sumPred : 1;
  const scaled = predicted.map((v) => v * scale);

  const totalTrue = realized.reduce((a, b) => a + b, 0);
  const order = predicted.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const percents = input.topPercent ?? [1, 2, 5, 10, 20, 30, 50];
  const curve: CurvePoint[] = percents.map((pct) => {
    const k = Math.max(1, Math.round((n * pct) / 100));
    let captured = 0;
    for (let i = 0; i < k; i++) captured += realized[order[i].i];
    const rri = totalTrue > 0 ? captured / totalTrue : 0;
    const pai = (k / n) > 0 ? rri / (k / n) : 0;
    return {
      percentUnits: pct,
      units: k,
      capturedTrue: captured,
      rri: round(rri, 5),
      pai: round(pai, 4),
      cumulativeShare: round(captured / Math.max(1, totalTrue), 5),
    };
  });

  const at = (pct: number) => curve.find((c) => c.percentUnits === pct) ?? curve[0];

  return {
    label: input.label ?? "layer",
    n,
    curve,
    pai10: at(10).pai,
    pai5: at(5).pai,
    rri10: at(10).rri,
    rri5: at(5).rri,
    rmseVsLambda: round(rmse(scaled, truth), 6),
    maeVsLambda: round(mae(scaled, truth), 6),
    rmseVsRealized: round(rmse(scaled, realized), 6),
    r2VsLambda: round(r2(truth, scaled), 5),
    spearmanVsLambda: round(spearman(predicted, truth), 5),
    pearsonVsLambda: round(pearson(predicted, truth), 5),
    spearmanVsRealized: round(spearman(predicted, realized), 5),
    biasRatio: round(sumPred > 0 ? sumTruth / sumPred : 0, 5),
    gini: round(gini(truth), 5),
    scaleNote: `Estimate rescaled by ${round(scale, 6)} so Σλ̂ = Σλ (scale-free shape comparison); PAI/RRI use the realised oracle counts.`,
    runtimeMs: Date.now() - t0,
  };
}

/** Compare two estimated surfaces (e.g. NKDE vs planar KDE) without ground truth. */
export function compareSurfacesOnly(a: number[], b: number[], labelA = "A", labelB = "B") {
  const n = Math.min(a.length, b.length);
  const sa = a.slice(0, n);
  const sb = b.slice(0, n);
  return {
    n,
    pearson: round(pearson(sa, sb), 5),
    spearman: round(spearman(sa, sb), 5),
    rmse: round(rmse(sa, sb), 6),
    mae: round(mae(sa, sb), 6),
    meanA: round(mean(sa), 6),
    meanB: round(mean(sb), 6),
    labelA,
    labelB,
  };
}
