export interface MultiCriteriaWeights {
  ebRiskWeight: number; // Weight on Empirical Bayes expected crash density
  epdoSeverityWeight: number; // Weight on EPDO severity index
  geometricHazardWeight: number; // Weight on sinuosity, intersection degree, speed
  environmentalHazardWeight: number; // Weight on wet/low-friction & night exposure
}

export interface SegmentRiskInput {
  segmentId: number;
  segmentCode: string;
  name: string;
  roadClass: string;
  isOverpass: boolean;
  lengthM: number;
  speedLimitKmh: number;
  laneCount: number;
  sinuosity: number;
  aadt: number;
  spfAlpha: number;
  spfBeta: number;
  spfOverdispersionPhi: number;
  observedVerifiedCount: number;
  observedUnverifiedCount: number;
  epdoSum: number;
  wetOrNightCrashCount: number;
}

export interface SegmentRiskEvaluation {
  segmentId: number;
  segmentCode: string;
  name: string;
  roadClass: string;
  lengthM: number;
  aadt: number;
  // US-5.1 Four Safety Metrics
  rawCrashCount: number;
  linearCrashDensityPerKm: number;
  epdoIndex: number;
  epdoDensityPerKm: number;
  mvktCrashRate: number; // Crashes per Million Vehicle Kilometers Traveled
  // US-5.2 Empirical Bayes (EB) Smoothing & RTM Correction
  spfPriorExpected: number;
  ebWeightW: number;
  ebExpectedCount: number;
  ebExpectedDensityPerKm: number;
  psiExcessCrashFrequency: number; // Potential for Safety Improvement (EB - SPF)
  rtmShrinkageCorrection: number; // Observed - EB (positive means random spike shrunk toward prior)
  // US-5.3 Multi-Criteria Vulnerability Index (Decision-Support Composite, NOT probability)
  geometricHazardIndex: number;
  environmentalHazardIndex: number;
  compositeVulnerabilityScore: number; // Scaled 0 - 100
  priorityRank: number;
  // US-5.4 Epistemic & Aleatoric Uncertainty
  vgiUnverifiedRatio: number;
  posteriorStdError: number;
  uncertaintyScore: number; // 0 (low uncertainty) to 1 (high uncertainty)
  confidenceInterval95: [number, number];
  bivariateClass: string; // e.g., 'H-L' (High Risk, Low Uncertainty), 'H-H' (High Risk, High Uncertainty)
  bivariateColorHex: string;
}

/**
 * 3x3 Bivariate Colorblind-Safe Cartographic Palette (Risk [L,M,H] x Uncertainty [L,M,H])
 * High certainty uses saturated scientific hues; high uncertainty desaturates/shifts toward amber-violet
 */
export const BIVARIATE_RISK_UNCERTAINTY_PALETTE: Record<string, string> = {
  "L-L": "#1e3a5f", // Low Risk, High Certainty (Deep Slate Blue)
  "M-L": "#008080", // Medium Risk, High Certainty (Teal)
  "H-L": "#f59e0b", // High Risk, High Certainty (High-Luminance Amber-Gold)
  "L-M": "#3b4d6b", // Low Risk, Med Uncertainty
  "M-M": "#5c7a89", // Medium Risk, Med Uncertainty
  "H-M": "#ea580c", // High Risk, Med Uncertainty (Orange-Coral)
  "L-H": "#64748b", // Low Risk, High Uncertainty (Muted Steel)
  "M-H": "#9333ea", // Medium Risk, High Uncertainty (Epistemic Violet)
  "H-H": "#e11d48", // High Risk, High Uncertainty (Alert Crimson-Magenta)
};

export function evaluateSegmentRiskAndEbPortfolio(
  inputs: SegmentRiskInput[],
  weights: MultiCriteriaWeights = {
    ebRiskWeight: 0.40,
    epdoSeverityWeight: 0.30,
    geometricHazardWeight: 0.15,
    environmentalHazardWeight: 0.15,
  }
): SegmentRiskEvaluation[] {
  const totalWeight =
    weights.ebRiskWeight +
      weights.epdoSeverityWeight +
      weights.geometricHazardWeight +
      weights.environmentalHazardWeight || 1.0;

  const wEb = weights.ebRiskWeight / totalWeight;
  const wEpdo = weights.epdoSeverityWeight / totalWeight;
  const wGeom = weights.geometricHazardWeight / totalWeight;
  const wEnv = weights.environmentalHazardWeight / totalWeight;

  const evaluations: SegmentRiskEvaluation[] = [];

  for (const seg of inputs) {
    const lengthKm = Math.max(0.02, seg.lengthM / 1000.0);
    // Weighted effective observed count (verified = 1.0, unverified raw VGI = 0.45)
    const rawCrashCount = Number(
      (seg.observedVerifiedCount + 0.45 * seg.observedUnverifiedCount).toFixed(2)
    );
    const totalReports = seg.observedVerifiedCount + seg.observedUnverifiedCount;

    // 1. Linear Crash Density (N / L_km)
    const linearCrashDensityPerKm = Number((rawCrashCount / lengthKm).toFixed(2));

    // 2. Severity-Weighted EPDO Index
    const epdoIndex = Number(seg.epdoSum.toFixed(2));
    const epdoDensityPerKm = Number((epdoIndex / lengthKm).toFixed(2));

    // 3. Exposure-Normalized Crash Rate per Million VKT (Over 14-day study window scaled to annual MVKT)
    const mvktStudyPeriod = Math.max(
      0.005,
      (seg.aadt * 14 * lengthKm) / 1_000_000.0
    );
    const mvktCrashRate = Number((rawCrashCount / mvktStudyPeriod).toFixed(2));

    // 4. Safety Performance Function (SPF) Prior: \mu_SPF = L_km * exp(\alpha) * AADT^\beta
    const spfPriorExpected = Number(
      (
        lengthKm *
        Math.exp(seg.spfAlpha) *
        Math.pow(Math.max(1000, seg.aadt), seg.spfBeta) *
        2.1
      ).toFixed(3)
    );

    // Negative Binomial Empirical Bayes Weight: w = 1 / (1 + \phi * \mu_SPF)
    const ebWeightW = Number(
      (1.0 / (1.0 + seg.spfOverdispersionPhi * spfPriorExpected)).toFixed(4)
    );

    // EB Expected Crash Estimate: E_EB = w * \mu_SPF + (1 - w) * N_obs
    const ebExpectedCount = Number(
      (ebWeightW * spfPriorExpected + (1.0 - ebWeightW) * rawCrashCount).toFixed(3)
    );
    const ebExpectedDensityPerKm = Number((ebExpectedCount / lengthKm).toFixed(2));

    // Potential for Safety Improvement (PSI / Excess Crash Frequency)
    const psiExcessCrashFrequency = Number(
      (ebExpectedCount - spfPriorExpected).toFixed(3)
    );

    // Regression-to-the-Mean (RTM) Shrinkage Delta
    const rtmShrinkageCorrection = Number(
      (rawCrashCount - ebExpectedCount).toFixed(3)
    );

    // Geometric & Environmental sub-indices (0 - 100)
    const geometricHazardIndex = Number(
      Math.min(
        100,
        ((seg.speedLimitKmh / 90.0) * 45 +
          Math.min(1, (seg.sinuosity - 1.0) * 12) * 30 +
          (seg.isOverpass ? 25 : (seg.laneCount / 6.0) * 25))
      ).toFixed(1)
    );

    const wetRatio =
      totalReports > 0 ? seg.wetOrNightCrashCount / totalReports : 0.25;
    const environmentalHazardIndex = Number(
      Math.min(100, wetRatio * 85 + (seg.isOverpass ? 15 : 5)).toFixed(1)
    );

    // Epistemic & Aleatoric Uncertainty Modeling
    const vgiUnverifiedRatio =
      totalReports > 0
        ? Number((seg.observedUnverifiedCount / totalReports).toFixed(3))
        : 0.35;

    // EB Posterior Variance: Var(E_EB) = (1 - w) * E_EB
    const posteriorVariance = Math.max(0.01, (1.0 - ebWeightW) * ebExpectedCount);
    const posteriorStdError = Number(Math.sqrt(posteriorVariance).toFixed(3));
    const relativeStdErr = Math.min(
      1.0,
      posteriorStdError / Math.max(0.5, ebExpectedCount)
    );

    // Composite Uncertainty Score U \in [0, 1]
    const sampleSparsityPenalty = totalReports === 0 ? 0.55 : 1.0 / (1.0 + totalReports * 0.45);
    const uncertaintyScore = Number(
      Math.min(
        0.98,
        Math.max(
          0.08,
          0.42 * vgiUnverifiedRatio +
            0.33 * relativeStdErr +
            0.25 * sampleSparsityPenalty
        )
      ).toFixed(3)
    );

    const ciLow = Number(
      Math.max(0, ebExpectedCount - 1.96 * posteriorStdError).toFixed(2)
    );
    const ciHigh = Number(
      (ebExpectedCount + 1.96 * posteriorStdError).toFixed(2)
    );

    evaluations.push({
      segmentId: seg.segmentId,
      segmentCode: seg.segmentCode,
      name: seg.name,
      roadClass: seg.roadClass,
      lengthM: seg.lengthM,
      aadt: seg.aadt,
      rawCrashCount,
      linearCrashDensityPerKm,
      epdoIndex,
      epdoDensityPerKm,
      mvktCrashRate,
      spfPriorExpected,
      ebWeightW,
      ebExpectedCount,
      ebExpectedDensityPerKm,
      psiExcessCrashFrequency,
      rtmShrinkageCorrection,
      geometricHazardIndex,
      environmentalHazardIndex,
      compositeVulnerabilityScore: 0, // Populated after min-max normalization
      priorityRank: 0,
      vgiUnverifiedRatio,
      posteriorStdError,
      uncertaintyScore,
      confidenceInterval95: [ciLow, ciHigh],
      bivariateClass: "L-L",
      bivariateColorHex: BIVARIATE_RISK_UNCERTAINTY_PALETTE["L-L"],
    });
  }

  // Normalize EB density and EPDO density across network for Multi-Criteria Vulnerability Score
  const maxEbDensity = Math.max(
    ...evaluations.map((e) => e.ebExpectedDensityPerKm),
    1e-6
  );
  const maxEpdoDensity = Math.max(
    ...evaluations.map((e) => e.epdoDensityPerKm),
    1e-6
  );

  for (const ev of evaluations) {
    const normEb = (ev.ebExpectedDensityPerKm / maxEbDensity) * 100.0;
    const normEpdo = (ev.epdoDensityPerKm / maxEpdoDensity) * 100.0;

    ev.compositeVulnerabilityScore = Number(
      (
        wEb * normEb +
        wEpdo * normEpdo +
        wGeom * ev.geometricHazardIndex +
        wEnv * ev.environmentalHazardIndex
      ).toFixed(1)
    );

    const riskTier =
      ev.compositeVulnerabilityScore >= 58
        ? "H"
        : ev.compositeVulnerabilityScore >= 32
        ? "M"
        : "L";
    const uncTier =
      ev.uncertaintyScore >= 0.48
        ? "H"
        : ev.uncertaintyScore >= 0.26
        ? "M"
        : "L";

    const bivKey = `${riskTier}-${uncTier}`;
    ev.bivariateClass = bivKey;
    ev.bivariateColorHex =
      BIVARIATE_RISK_UNCERTAINTY_PALETTE[bivKey] ?? "#008080";
  }

  // Assign Priority Ranks descending by Composite Vulnerability Score
  const sorted = [...evaluations].sort(
    (a, b) => b.compositeVulnerabilityScore - a.compositeVulnerabilityScore
  );
  sorted.forEach((item, idx) => {
    item.priorityRank = idx + 1;
  });

  return evaluations;
}
