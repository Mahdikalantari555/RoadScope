/**
 * Transparent, configurable road-segment risk engine.
 *
 * This produces a *relative risk index*, not a calibrated probability of a crash
 * occurring. Components are interpretable and publicly documented:
 *   frequency      — accident count (with optional Poisson stability weighting)
 *   severity       — severity-weighted count (PDO 1, slight 3, serious 7, fatal 12)
 *   density        — events per kilometre of segment
 *   exposure       — events per 100 million vehicle-kilometres (AADT × length),
 *                    inverted so that a higher rate means higher risk
 *   environment    — observed wet/dark share plus segment attributes
 *                    (unlit, non-asphalt surface, posted speed)
 *
 * Weighted blends use min-max normalisation across the analysed network; the
 * weights are user-editable and every component remains visible for audit.
 */
import { mean, minMax, normalise, quantile, standardise, stdev } from "./stats";
import type { SegmentAggregate } from "./analytics";

export type RiskWeights = {
  frequency: number;
  severity: number;
  density: number;
  exposure: number;
  environment: number;
};

export type RiskOptions = {
  weights: RiskWeights;
  useExposure: boolean;
  stabilityK: number;
  normalisation: "minmax" | "zscore" | "rank";
};

export const DEFAULT_RISK_OPTIONS: RiskOptions = {
  weights: { frequency: 0.26, severity: 0.3, density: 0.18, exposure: 0.12, environment: 0.14 },
  useExposure: true,
  stabilityK: 3,
  normalisation: "minmax",
};

export type RiskSegment = SegmentAggregate & {
  components: {
    frequency: number;
    severity: number;
    density: number;
    exposure: number;
    environment: number;
  };
  rawScore: number;
  riskIndex: number;
  rank: number;
  stability: number;
  uncertainty: number;
  ratePer100mVehKm: number | null;
  coverage: { exposure: boolean; environmentalContext: number; segmentAssigned: boolean };
  evidenceClass: "sparse" | "moderate" | "established";
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type RiskResult = {
  options: RiskOptions;
  segments: RiskSegment[];
  summary: {
    analysedSegments: number;
    segmentsWithEvents: number;
    highRiskSegments: number;
    networkKm: number;
    eventsAnalysed: number;
    exposureCoverage: number;
    environmentalCoverage: number;
    medianRiskIndex: number;
    p90RiskIndex: number;
    meanSeverityDensity: number;
    stabilityK: number;
  };
  methodology: { title: string; detail: string }[];
  limitations: string[];
};

function normaliseComponent(values: number[], mode: RiskOptions["normalisation"]): number[] {
  if (values.length === 0) return [];
  if (mode === "rank") {
    const sorted = [...values].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array(values.length).fill(0);
    sorted.forEach((item, rank) => {
      out[item.i] = values.length > 1 ? rank / (values.length - 1) : 0;
    });
    return out;
  }
  if (mode === "zscore") {
    const m = mean(values);
    const s = stdev(values);
    const zs = values.map((v) => standardise(v, m, s));
    const { min, max } = minMax(zs);
    return zs.map((z) => normalise(z, min, max));
  }
  const { min, max } = minMax(values);
  return values.map((v) => normalise(v, min, max));
}

export function computeRisk(aggregates: SegmentAggregate[], options: RiskOptions): RiskResult {
  const usable = aggregates;
  const exposureValues = usable.map((a) => {
    if (!a.aadt || a.lengthM <= 0) return null;
    const vehKm = (a.aadt * 365 * a.lengthM) / 1000;
    return vehKm > 0 ? (a.count / vehKm) * 1e8 : null;
  });
  const exposurePresent = exposureValues.filter((v): v is number => v !== null);
  const exposureMean = exposurePresent.length ? mean(exposurePresent) : 0;

  const frequencyN = normaliseComponent(usable.map((a) => a.count), options.normalisation);
  const severityN = normaliseComponent(usable.map((a) => a.severityWeighted), options.normalisation);
  const densityN = normaliseComponent(usable.map((a) => a.densityPerKm), options.normalisation);
  const exposureN = normaliseComponent(
    exposureValues.map((v) => v ?? exposureMean),
    options.normalisation,
  );
  const envRaw = usable.map(
    (a) =>
      0.4 * a.wetShare +
      0.3 * a.darkShare +
      0.15 * (a.isLit ? 0 : 1) +
      0.1 * Math.min(1, a.speedLimitKmh / 80) +
      0.05 * (a.surface === "asphalt" ? 0 : 1),
  );
  const envN = normaliseComponent(envRaw, options.normalisation);

  const weights = options.weights;
  const totalWeight =
    weights.frequency +
    weights.severity +
    weights.density +
    (options.useExposure ? weights.exposure : 0) +
    weights.environment;

  const scored = usable.map((segment, i) => {
    const components = {
      frequency: frequencyN[i],
      severity: severityN[i],
      density: densityN[i],
      exposure: options.useExposure ? exposureN[i] : 0,
      environment: envN[i],
    };
    const raw =
      (components.frequency * weights.frequency +
        components.severity * weights.severity +
        components.density * weights.density +
        components.exposure * (options.useExposure ? weights.exposure : 0) +
        components.environment * weights.environment) /
      Math.max(totalWeight, 1e-9);
    const stability = segment.count === 0 ? 0 : segment.count / (segment.count + options.stabilityK);
    const adjusted = raw * (0.35 + 0.65 * stability);
    const uncertainty = Math.min(
      1,
      1 / Math.sqrt(segment.count + 1) +
        (segment.aadt ? 0 : 0.3) +
        0.35 * segment.unknownContextShare,
    );
    const rate = exposureValues[i];
    return {
      ...segment,
      components,
      rawScore: raw,
      riskIndex: adjusted * 100,
      stability,
      uncertainty,
      ratePer100mVehKm: rate,
      rank: 0,
      coverage: {
        exposure: Boolean(segment.aadt),
        environmentalContext: 1 - segment.unknownContextShare,
        segmentAssigned: true,
      },
      evidenceClass: (segment.count >= 8 ? "established" : segment.count >= 3 ? "moderate" : "sparse") as RiskSegment["evidenceClass"],
    };
  });

  scored.sort((a, b) => b.riskIndex - a.riskIndex);
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });

  const riskValues = scored.map((s) => s.riskIndex);
  const networkKm = usable.reduce((s, a) => s + a.lengthM / 1000, 0);
  const withEvents = scored.filter((s) => s.count > 0);
  const exposureCoverage = usable.length ? usable.filter((a) => a.aadt !== null).length / usable.length : 0;
  const envCoverage = mean(usable.map((a) => 1 - a.unknownContextShare));

  return {
    options,
    segments: scored,
    summary: {
      analysedSegments: usable.length,
      segmentsWithEvents: withEvents.length,
      highRiskSegments: riskValues.filter((v) => v >= quantile(riskValues, 0.9)).length,
      networkKm,
      eventsAnalysed: usable.reduce((s, a) => s + a.count, 0),
      exposureCoverage,
      environmentalCoverage: Number.isFinite(envCoverage) ? envCoverage : 0,
      medianRiskIndex: riskValues.length ? quantile(riskValues, 0.5) : 0,
      p90RiskIndex: riskValues.length ? quantile(riskValues, 0.9) : 0,
      meanSeverityDensity: mean(usable.map((a) => a.severityDensityPerKm)),
      stabilityK: options.stabilityK,
    },
    methodology: [
      {
        title: "Frequency & severity",
        detail:
          "Accident counts and severity-weighted counts (PDO 1 / slight 3 / serious 7 / fatal 12) are normalised across the filtered network. Weights sum to one after the exposure component is included.",
      },
      {
        title: "Density & exposure",
        detail:
          "Events per kilometre control for unequal segment lengths. When AADT is available, an exposure-aware rate (events per 100 million vehicle-kilometres) is added; the rate is inverted so a higher component means higher risk.",
      },
      {
        title: "Environmental factor",
        detail:
          "Observed wet and dark shares (from the joined environmental context) are combined with static segment attributes: unlit carriageway, non-asphalt surface and posted speed.",
      },
      {
        title: `Stability weighting (k = ${options.stabilityK})`,
        detail:
          "The blended score is multiplied by n/(n+k) to damp small-sample instability, then scaled 0–100. This is a stability adjustment, not Bayesian inference: no prior crash distribution is estimated and no predictive claim is made.",
      },
    ],
    limitations: [
      "The index is relative and ordinal within the analysed network; it is not a calibrated probability of a future collision.",
      "Exposure data are synthetic proxy AADT values. Where exposure is missing the component falls back to the network mean, which compresses differences between segments.",
      "Environmental associations are descriptive co-occurrences, not causal effects. Reporting bias (citizens report what they witness) is not removed by weighting.",
      "No independent validation has been carried out. Predictive performance, transferability and calibration must be assessed before operational use.",
    ],
  };
}

export function parseRiskOptions(input: Record<string, string | undefined>): RiskOptions {
  const numeric = (key: keyof RiskWeights, fallback: number) => {
    const value = input[key];
    const parsed = value === undefined ? NaN : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    weights: {
      frequency: numeric("frequency", DEFAULT_RISK_OPTIONS.weights.frequency),
      severity: numeric("severity", DEFAULT_RISK_OPTIONS.weights.severity),
      density: numeric("density", DEFAULT_RISK_OPTIONS.weights.density),
      exposure: numeric("exposure", DEFAULT_RISK_OPTIONS.weights.exposure),
      environment: numeric("environment", DEFAULT_RISK_OPTIONS.weights.environment),
    },
    useExposure: input.useExposure !== "false",
    stabilityK: (() => {
      const parsed = Number(input.stabilityK);
      return Number.isFinite(parsed) && parsed >= 0 && parsed <= 50 ? parsed : DEFAULT_RISK_OPTIONS.stabilityK;
    })(),
    normalisation: input.normalisation === "zscore" || input.normalisation === "rank" ? input.normalisation : "minmax",
  };
}
