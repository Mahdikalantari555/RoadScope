import { euclideanDistanceM } from "./crs";
import {
  computeNetworkDistanceBetweenLRS,
  NetworkShortestPathMatrix,
} from "./network";
import { createSeededRng } from "./simulator";

export type KernelType = "gaussian" | "epanechnikov" | "quartic";

export interface LixelNodeForStats {
  id: number;
  lixelCode: string;
  segmentId: number;
  segmentCode: string;
  fromNodeCode: string;
  toNodeCode: string;
  segmentLengthM: number;
  mStartM: number;
  mEndM: number;
  lengthM: number;
  centerXM: number;
  centerYM: number;
  centerLon: number;
  centerLat: number;
  trueIntensityLambda: number;
}

export interface IncidentPointForStats {
  id: number;
  incidentCode: string;
  snappedSegmentId: number;
  segmentCode: string;
  fromNodeCode: string;
  toNodeCode: string;
  segmentLengthM: number;
  snappedLixelId: number;
  linearOffsetM: number;
  snappedXM: number;
  snappedYM: number;
  snappedLon: number;
  snappedLat: number;
  epdoWeight: number;
  credibilityWeight: number;
}

export function evaluateKernel1D(u: number, kernel: KernelType): number {
  const absU = Math.abs(u);
  if (kernel === "gaussian") {
    if (absU > 3.5) return 0;
    return Math.exp(-0.5 * absU * absU) / Math.sqrt(2 * Math.PI);
  }
  if (absU >= 1.0) return 0;
  if (kernel === "epanechnikov") {
    return 0.75 * (1 - absU * absU);
  }
  // quartic (biweight)
  const term = 1 - absU * absU;
  return (15 / 16) * term * term;
}

/**
 * Standard normal complementary CDF approximation for two-tailed p-values
 */
export function normalTwoTailedPValue(z: number): number {
  const absZ = Math.abs(z);
  const t = 1.0 / (1.0 + 0.2316419 * absZ);
  const d = 0.3989422804014337 * Math.exp((-absZ * absZ) / 2.0);
  const prob =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + 1.330274429 * t))));
  return Math.min(1.0, Math.max(1e-7, 2.0 * prob));
}

/**
 * Benjamini-Hochberg False Discovery Rate (FDR) correction
 */
export function applyBenjaminiHochbergFdr(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, idx) => ({ p, idx }));
  indexed.sort((a, b) => a.p - b.p);

  const adjusted = new Array<number>(m).fill(1.0);
  let minSoFar = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const fdr = Math.min(1.0, (indexed[i].p * m) / rank);
    minSoFar = Math.min(minSoFar, fdr);
    adjusted[indexed[i].idx] = Number(minSoFar.toFixed(5));
  }
  return adjusted;
}

export interface BenchmarkEvaluationMetrics {
  paiTop10Pct: number; // Prediction Accuracy Index at top 10% network length
  paiTop20Pct: number; // Prediction Accuracy Index at top 20% network length
  rriTop15Pct: number; // Recapture Rate Index of ground-truth lambda
  rmseVsTrueLambda: number; // Root Mean Square Error vs normalized true intensity
  pearsonCorrelation: number; // Correlation r with ground-truth surface
}

/**
 * US-1.4 Quantitative Ground-Truth Benchmarking Evaluator
 * Compares any estimated lixel risk surface against the known Cox/Poisson intensity \lambda(l_i)
 * and realized crash counts.
 */
export function evaluateBenchmarkMetrics(
  estimatedValues: number[],
  trueLambdaValues: number[],
  observedCrashCounts: number[],
  lixelLengthsM: number[]
): BenchmarkEvaluationMetrics {
  const n = estimatedValues.length;
  if (n === 0) {
    return {
      paiTop10Pct: 1,
      paiTop20Pct: 1,
      rriTop15Pct: 1,
      rmseVsTrueLambda: 0,
      pearsonCorrelation: 0,
    };
  }

  const maxEst = Math.max(...estimatedValues, 1e-9);
  const maxTrue = Math.max(...trueLambdaValues, 1e-9);

  const normEst = estimatedValues.map((v) => v / maxEst);
  const normTrue = trueLambdaValues.map((v) => v / maxTrue);

  // RMSE
  let sqErrSum = 0;
  let meanEst = 0;
  let meanTrue = 0;
  for (let i = 0; i < n; i++) {
    const diff = normEst[i] - normTrue[i];
    sqErrSum += diff * diff;
    meanEst += normEst[i];
    meanTrue += normTrue[i];
  }
  meanEst /= n;
  meanTrue /= n;
  const rmseVsTrueLambda = Number(Math.sqrt(sqErrSum / n).toFixed(4));

  // Pearson correlation r
  let cov = 0;
  let varEst = 0;
  let varTrue = 0;
  for (let i = 0; i < n; i++) {
    const de = normEst[i] - meanEst;
    const dt = normTrue[i] - meanTrue;
    cov += de * dt;
    varEst += de * de;
    varTrue += dt * dt;
  }
  const pearsonCorrelation =
    varEst > 1e-9 && varTrue > 1e-9
      ? Number((cov / Math.sqrt(varEst * varTrue)).toFixed(4))
      : 0;

  // Sort lixels by estimated intensity descending for PAI & RRI
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => estimatedValues[b] - estimatedValues[a]);

  const totalLengthM = lixelLengthsM.reduce((a, b) => a + b, 0) || 1;
  const totalCrashes = observedCrashCounts.reduce((a, b) => a + b, 0) || 1;
  const totalTrueLambdaMass =
    trueLambdaValues.reduce((acc, v, i) => acc + v * lixelLengthsM[i], 0) || 1;

  let cumLen = 0;
  let crashesAt10 = 0;
  let lenAt10 = 0;
  let crashesAt20 = 0;
  let lenAt20 = 0;
  let lambdaMassAt15 = 0;

  for (const idx of indices) {
    const prevRatio = cumLen / totalLengthM;
    cumLen += lixelLengthsM[idx];
    const currRatio = cumLen / totalLengthM;

    if (prevRatio < 0.10) {
      crashesAt10 += observedCrashCounts[idx];
      lenAt10 = cumLen;
    }
    if (prevRatio < 0.15) {
      lambdaMassAt15 += trueLambdaValues[idx] * lixelLengthsM[idx];
    }
    if (prevRatio < 0.20) {
      crashesAt20 += observedCrashCounts[idx];
      lenAt20 = cumLen;
    }
    if (currRatio >= 0.22) break;
  }

  const paiTop10Pct = Number(
    ((crashesAt10 / totalCrashes) / Math.max(0.01, lenAt10 / totalLengthM)).toFixed(3)
  );
  const paiTop20Pct = Number(
    ((crashesAt20 / totalCrashes) / Math.max(0.01, lenAt20 / totalLengthM)).toFixed(3)
  );
  const rriTop15Pct = Number((lambdaMassAt15 / totalTrueLambdaMass).toFixed(3));

  return {
    paiTop10Pct,
    paiTop20Pct,
    rriTop15Pct,
    rmseVsTrueLambda,
    pearsonCorrelation,
  };
}

/**
 * US-4.1 Network Kernel Density Estimation (NKDE) vs. Planar 2D KDE
 * Computes both Okabe-Sugihara Equal-Split Network KDE and Planar 2D Euclidean KDE
 * across all lixels, plus the normalized Planar Distortion Difference surface.
 */
export function computeNkdeVsPlanar(params: {
  lixels: LixelNodeForStats[];
  incidents: IncidentPointForStats[];
  spMatrix: NetworkShortestPathMatrix;
  bandwidthM: number;
  kernel: KernelType;
  useSeverityWeights: boolean;
  equalSplitAttenuation?: number; // 0 = uncorrected simple NKDE, 1 = full Okabe-Sugihara equal-split
}): {
  nkdeValues: number[];
  planarKdeValues: number[];
  kdeDiffValues: number[]; // Positive = Planar KDE overestimates risk relative to Network KDE
  nkdeBenchmark: BenchmarkEvaluationMetrics;
  planarBenchmark: BenchmarkEvaluationMetrics;
  maxDistortionLixelCode: string;
  meanPlanarOverestimationPct: number;
} {
  const {
    lixels,
    incidents,
    spMatrix,
    bandwidthM,
    kernel,
    useSeverityWeights,
    equalSplitAttenuation = 0.65,
  } = params;

  const h = Math.max(30, bandwidthM);
  const nLixels = lixels.length;
  const rawNkde = new Array<number>(nLixels).fill(0);
  const rawPlanar = new Array<number>(nLixels).fill(0);
  const lixelCrashCounts = new Array<number>(nLixels).fill(0);

  const lixelIndexById = new Map<number, number>();
  lixels.forEach((lx, i) => lixelIndexById.set(lx.id, i));

  for (const inc of incidents) {
    const li = lixelIndexById.get(inc.snappedLixelId);
    if (li !== undefined) {
      lixelCrashCounts[li] += 1;
    }
  }

  for (let i = 0; i < nLixels; i++) {
    const lx = lixels[i];
    const mMid = (lx.mStartM + lx.mEndM) / 2.0;

    let sumNet = 0;
    let sumPlanar = 0;

    for (const inc of incidents) {
      const weight =
        (useSeverityWeights ? inc.epdoWeight : 1.0) * inc.credibilityWeight;

      // 1. Planar Euclidean distance
      const dEuc = euclideanDistanceM(
        lx.centerXM,
        lx.centerYM,
        inc.snappedXM,
        inc.snappedYM
      );
      if (dEuc <= h * 3.2) {
        const kPlanar = evaluateKernel1D(dEuc / h, kernel);
        sumPlanar += (weight * kPlanar) / h;
      }

      // 2. Shortest-Path Network distance d_net
      // Fast lower-bound prune: network distance is always >= Euclidean distance!
      if (dEuc <= h * 3.2) {
        const netObj = computeNetworkDistanceBetweenLRS(
          {
            segmentCode: lx.segmentCode,
            fromNodeCode: lx.fromNodeCode,
            toNodeCode: lx.toNodeCode,
            lengthM: lx.segmentLengthM,
          },
          mMid,
          {
            segmentCode: inc.segmentCode,
            fromNodeCode: inc.fromNodeCode,
            toNodeCode: inc.toNodeCode,
            lengthM: inc.segmentLengthM,
          },
          inc.linearOffsetM,
          spMatrix
        );

        if (netObj.distanceM <= h * 3.2) {
          const kNet = evaluateKernel1D(netObj.distanceM / h, kernel);
          const splitDivisor = Math.pow(
            netObj.splitFactor,
            equalSplitAttenuation
          );
          sumNet += (weight * kNet) / (h * splitDivisor);
        }
      }
    }

    // Scale to crashes per km equivalent
    rawNkde[i] = sumNet * 1000.0;
    rawPlanar[i] = sumPlanar * 1000.0;
  }

  // Normalize Planar KDE to match total network integral of NKDE for rigorous bias comparison
  const sumNkde = rawNkde.reduce((a, b) => a + b, 0) || 1;
  const sumPlanar = rawPlanar.reduce((a, b) => a + b, 0) || 1;
  const scalePlanarToNkde = sumNkde / sumPlanar;

  const nkdeValues = rawNkde.map((v) => Number(v.toFixed(4)));
  const planarKdeValues = rawPlanar.map((v) =>
    Number((v * scalePlanarToNkde).toFixed(4))
  );
  const kdeDiffValues = new Array<number>(nLixels).fill(0);

  let maxDiff = -Infinity;
  let maxDistortionLixelCode = lixels[0]?.lixelCode ?? "E01_L001";
  let overestSumPct = 0;

  for (let i = 0; i < nLixels; i++) {
    const diff = Number((planarKdeValues[i] - nkdeValues[i]).toFixed(4));
    kdeDiffValues[i] = diff;
    if (diff > maxDiff) {
      maxDiff = diff;
      maxDistortionLixelCode = lixels[i].lixelCode;
    }
    if (nkdeValues[i] > 0.05 && diff > 0) {
      overestSumPct += (diff / nkdeValues[i]) * 100;
    }
  }

  const trueLambdas = lixels.map((l) => l.trueIntensityLambda);
  const lengths = lixels.map((l) => l.lengthM);

  const nkdeBenchmark = evaluateBenchmarkMetrics(
    nkdeValues,
    trueLambdas,
    lixelCrashCounts,
    lengths
  );
  const planarBenchmark = evaluateBenchmarkMetrics(
    planarKdeValues,
    trueLambdas,
    lixelCrashCounts,
    lengths
  );

  return {
    nkdeValues,
    planarKdeValues,
    kdeDiffValues,
    nkdeBenchmark,
    planarBenchmark,
    maxDistortionLixelCode,
    meanPlanarOverestimationPct: Number(
      (overestSumPct / Math.max(1, nLixels)).toFixed(2)
    ),
  };
}

/**
 * US-4.2 Network-Constrained Local Spatial Autocorrelation:
 * Network Getis-Ord Gi* & Global Network Moran's I with permutation pseudo-p-values and FDR correction.
 */
export function computeNetworkGetisOrdAndMoran(params: {
  lixels: LixelNodeForStats[];
  lixelValues: number[]; // e.g., NKDE or crash count or EPDO on each lixel
  spMatrix: NetworkShortestPathMatrix;
  neighborhoodCutoffM: number;
  permutations?: number;
  useFdrCorrection?: boolean;
}): {
  assumptionsPassed: boolean;
  assumptionMessage: string;
  giStarZ: number[];
  giStarPValues: number[];
  giStarFdrPValues: number[];
  giStarClusterTypes: string[];
  globalMoranI: number;
  globalMoranExpected: number;
  globalMoranZ: number;
  globalMoranPValue: number;
  significantHotspotCount: number;
  significantColdspotCount: number;
} {
  const {
    lixels,
    lixelValues,
    spMatrix,
    neighborhoodCutoffM,
    permutations = 199,
    useFdrCorrection = true,
  } = params;

  const n = lixels.length;
  if (n < 10) {
    return {
      assumptionsPassed: false,
      assumptionMessage: `Insufficient spatial sample size (N=${n} < 10 lixels required).`,
      giStarZ: new Array(n).fill(0),
      giStarPValues: new Array(n).fill(1),
      giStarFdrPValues: new Array(n).fill(1),
      giStarClusterTypes: new Array(n).fill("Not Significant"),
      globalMoranI: 0,
      globalMoranExpected: 0,
      globalMoranZ: 0,
      globalMoranPValue: 1,
      significantHotspotCount: 0,
      significantColdspotCount: 0,
    };
  }

  const meanX = lixelValues.reduce((a, b) => a + b, 0) / n;
  const varianceX =
    lixelValues.reduce((acc, x) => acc + (x - meanX) * (x - meanX), 0) / n;
  const stdX = Math.sqrt(varianceX);

  if (varianceX <= 1e-9) {
    return {
      assumptionsPassed: false,
      assumptionMessage:
        "Zero spatial variance across lixels (sigma^2 <= 0); autocorrelation undefined.",
      giStarZ: new Array(n).fill(0),
      giStarPValues: new Array(n).fill(1),
      giStarFdrPValues: new Array(n).fill(1),
      giStarClusterTypes: new Array(n).fill("Not Significant"),
      globalMoranI: 0,
      globalMoranExpected: -1 / (n - 1),
      globalMoranZ: 0,
      globalMoranPValue: 1,
      significantHotspotCount: 0,
      significantColdspotCount: 0,
    };
  }

  const cutoff = Math.max(60, neighborhoodCutoffM);

  // Build sparse network weights adjacency list W_net
  const neighbors: Array<Array<{ j: number; w: number }>> = Array.from(
    { length: n },
    () => []
  );

  for (let i = 0; i < n; i++) {
    neighbors[i].push({ j: i, w: 1.0 }); // Gi* includes self weight w_ii = 1
    const lxI = lixels[i];
    const mI = (lxI.mStartM + lxI.mEndM) / 2;

    for (let j = i + 1; j < n; j++) {
      const lxJ = lixels[j];
      const dEuc = euclideanDistanceM(
        lxI.centerXM,
        lxI.centerYM,
        lxJ.centerXM,
        lxJ.centerYM
      );
      if (dEuc > cutoff) continue;

      const mJ = (lxJ.mStartM + lxJ.mEndM) / 2;
      const netDist = computeNetworkDistanceBetweenLRS(
        {
          segmentCode: lxI.segmentCode,
          fromNodeCode: lxI.fromNodeCode,
          toNodeCode: lxI.toNodeCode,
          lengthM: lxI.segmentLengthM,
        },
        mI,
        {
          segmentCode: lxJ.segmentCode,
          fromNodeCode: lxJ.fromNodeCode,
          toNodeCode: lxJ.toNodeCode,
          lengthM: lxJ.segmentLengthM,
        },
        mJ,
        spMatrix
      ).distanceM;

      if (netDist <= cutoff) {
        // Distance-decay topological weight
        const w = Number(Math.max(0.15, 1.0 - netDist / (cutoff * 1.15)).toFixed(4));
        neighbors[i].push({ j, w });
        neighbors[j].push({ j: i, w });
      }
    }
  }

  const giStarZ = new Array<number>(n).fill(0);
  const rawPValues = new Array<number>(n).fill(1);
  const rng = createSeededRng(2026);

  // Global Moran's I accumulators (excluding self-weights w_ii)
  let moranNumerator = 0;
  let totalW = 0;

  for (let i = 0; i < n; i++) {
    let sumWX = 0;
    let sumW = 0;
    let sumW2 = 0;

    for (const nb of neighbors[i]) {
      sumWX += nb.w * lixelValues[nb.j];
      sumW += nb.w;
      sumW2 += nb.w * nb.w;

      if (nb.j !== i) {
        moranNumerator +=
          nb.w * (lixelValues[i] - meanX) * (lixelValues[nb.j] - meanX);
        totalW += nb.w;
      }
    }

    const denom =
      stdX * Math.sqrt(Math.max(1e-9, (n * sumW2 - sumW * sumW) / (n - 1)));
    const zVal = denom > 1e-9 ? (sumWX - meanX * sumW) / denom : 0;
    giStarZ[i] = Number(zVal.toFixed(4));

    // Analytical + permutation pseudo-p-value blend
    const pAnalytical = normalTwoTailedPValue(zVal);
    if (permutations > 0 && Math.abs(zVal) > 1.2) {
      const nonSelfNeighbors = neighbors[i].filter((nb) => nb.j !== i);
      const kCount = nonSelfNeighbors.length;
      if (kCount > 0) {
        let extremeCount = 0;
        const obsLag = sumWX - lixelValues[i];
        const meanLag = ( sumW - 1.0 ) * meanX;
        const absObsDev = Math.abs(obsLag - meanLag);

        for (let p = 0; p < permutations; p++) {
          let permLag = 0;
          for (const nb of nonSelfNeighbors) {
            const randIdx = Math.floor(rng() * n);
            permLag += nb.w * lixelValues[randIdx];
          }
          if (Math.abs(permLag - meanLag) >= absObsDev) {
            extremeCount++;
          }
        }
        const pseudoP = (extremeCount + 1) / (permutations + 1);
        rawPValues[i] = Number((0.5 * pAnalytical + 0.5 * pseudoP).toFixed(5));
      } else {
        rawPValues[i] = Number(pAnalytical.toFixed(5));
      }
    } else {
      rawPValues[i] = Number(pAnalytical.toFixed(5));
    }
  }

  const giStarFdrPValues = applyBenjaminiHochbergFdr(rawPValues);
  const activePValues = useFdrCorrection ? giStarFdrPValues : rawPValues;

  const giStarClusterTypes: string[] = [];
  let significantHotspotCount = 0;
  let significantColdspotCount = 0;

  for (let i = 0; i < n; i++) {
    const z = giStarZ[i];
    const p = activePValues[i];
    if (z >= 2.576 && p < 0.01) {
      giStarClusterTypes.push("Hotspot 99% (p < 0.01)");
      significantHotspotCount++;
    } else if (z >= 1.96 && p < 0.05) {
      giStarClusterTypes.push("Hotspot 95% (p < 0.05)");
      significantHotspotCount++;
    } else if (z <= -2.576 && p < 0.01) {
      giStarClusterTypes.push("Coldspot 99% (p < 0.01)");
      significantColdspotCount++;
    } else if (z <= -1.96 && p < 0.05) {
      giStarClusterTypes.push("Coldspot 95% (p < 0.05)");
      significantColdspotCount++;
    } else if (lixelValues[i] > meanX + 1.15 * stdX) {
      // Explicit separation of descriptive high-density segments from statistically significant clusters (US-4.2)
      giStarClusterTypes.push("High Density (Non-Significant)");
    } else {
      giStarClusterTypes.push("Not Significant");
    }
  }

  const globalMoranI =
    totalW > 0 && varianceX > 0
      ? Number((moranNumerator / (totalW * varianceX)).toFixed(4))
      : 0;
  const globalMoranExpected = Number((-1 / (n - 1)).toFixed(4));
  const moranStd = Math.sqrt(2.0 / Math.max(10, totalW));
  const globalMoranZ = Number(
    ((globalMoranI - globalMoranExpected) / moranStd).toFixed(3)
  );
  const globalMoranPValue = Number(normalTwoTailedPValue(globalMoranZ).toFixed(5));

  return {
    assumptionsPassed: true,
    assumptionMessage: `Validated: N=${n} lixels, Variance=${varianceX.toFixed(3)} > 0, W_net cutoff=${cutoff}m (${permutations} conditional permutations + BH-FDR).`,
    giStarZ,
    giStarPValues: rawPValues,
    giStarFdrPValues,
    giStarClusterTypes,
    globalMoranI,
    globalMoranExpected,
    globalMoranZ,
    globalMoranPValue,
    significantHotspotCount,
    significantColdspotCount,
  };
}

/**
 * Computes 2D Monotone Chain Convex Hull of a set of [lon, lat] points
 */
function computeConvexHullGeo(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;
  const pts = [...points].sort((a, b) =>
    a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]
  );

  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number]
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface NetworkDbscanClusterSummary {
  clusterId: number;
  incidentCount: number;
  lixelCount: number;
  dominantRoadNames: string[];
  meanEpdoSeverity: number;
  networkSpanM: number;
  convexHullGeo: [number, number][];
  memberLixelIds: number[];
  memberIncidentIds: number[];
}

/**
 * US-4.3 Network DBSCAN (N-DBSCAN)
 * Evaluates epsilon-neighborhoods strictly via shortest-path graph traversal distance d_net <= epsM.
 */
export function computeNetworkDbscan(params: {
  incidents: IncidentPointForStats[];
  lixels: LixelNodeForStats[];
  spMatrix: NetworkShortestPathMatrix;
  epsNetworkM: number;
  minPts: number;
}): {
  incidentClusterIds: Map<number, number>;
  lixelClusterIds: number[];
  clusters: NetworkDbscanClusterSummary[];
  noiseIncidentCount: number;
} {
  const { incidents, lixels, spMatrix, epsNetworkM, minPts } = params;
  const m = incidents.length;
  const eps = Math.max(30, epsNetworkM);
  const reqPts = Math.max(2, minPts);

  // Precompute shortest-path network neighbors for each incident
  const adj: number[][] = Array.from({ length: m }, () => []);
  for (let i = 0; i < m; i++) {
    adj[i].push(i);
    const incA = incidents[i];
    for (let j = i + 1; j < m; j++) {
      const incB = incidents[j];
      const dEuc = euclideanDistanceM(
        incA.snappedXM,
        incA.snappedYM,
        incB.snappedXM,
        incB.snappedYM
      );
      if (dEuc > eps) continue;

      const netDist = computeNetworkDistanceBetweenLRS(
        {
          segmentCode: incA.segmentCode,
          fromNodeCode: incA.fromNodeCode,
          toNodeCode: incA.toNodeCode,
          lengthM: incA.segmentLengthM,
        },
        incA.linearOffsetM,
        {
          segmentCode: incB.segmentCode,
          fromNodeCode: incB.fromNodeCode,
          toNodeCode: incB.toNodeCode,
          lengthM: incB.segmentLengthM,
        },
        incB.linearOffsetM,
        spMatrix
      ).distanceM;

      if (netDist <= eps) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Array<boolean>(m).fill(false);
  const clusterOfIdx = new Array<number>(m).fill(-1);
  let currentClusterId = 0;

  for (let i = 0; i < m; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const neighbors = adj[i];
    if (neighbors.length < reqPts) {
      clusterOfIdx[i] = -1; // Noise
      continue;
    }

    currentClusterId++;
    clusterOfIdx[i] = currentClusterId;
    const queue = [...neighbors];
    const inQueue = new Set<number>(queue);

    while (queue.length > 0) {
      const q = queue.shift()!;
      if (!visited[q]) {
        visited[q] = true;
        const qNeighbors = adj[q];
        if (qNeighbors.length >= reqPts) {
          for (const nb of qNeighbors) {
            if (!inQueue.has(nb)) {
              inQueue.add(nb);
              queue.push(nb);
            }
          }
        }
      }
      if (clusterOfIdx[q] <= 0) {
        clusterOfIdx[q] = currentClusterId;
      }
    }
  }

  const incidentClusterIds = new Map<number, number>();
  let noiseIncidentCount = 0;
  for (let i = 0; i < m; i++) {
    incidentClusterIds.set(incidents[i].id, clusterOfIdx[i]);
    if (clusterOfIdx[i] === -1) noiseIncidentCount++;
  }

  // Assign topological subgraph lixels belonging to each N-DBSCAN cluster
  const lixelClusterIds = new Array<number>(lixels.length).fill(-1);
  const lixelIdxById = new Map<number, number>();
  lixels.forEach((lx, idx) => lixelIdxById.set(lx.id, idx));

  for (let i = 0; i < m; i++) {
    const cid = clusterOfIdx[i];
    if (cid > 0) {
      const lIdx = lixelIdxById.get(incidents[i].snappedLixelId);
      if (lIdx !== undefined) {
        lixelClusterIds[lIdx] = cid;
      }
    }
  }

  // Also expand cluster to immediately connected intermediate lixels within eps * 0.65
  for (let li = 0; li < lixels.length; li++) {
    if (lixelClusterIds[li] > 0) continue;
    const lx = lixels[li];
    const mMid = (lx.mStartM + lx.mEndM) / 2;
    for (let i = 0; i < m; i++) {
      const cid = clusterOfIdx[i];
      if (cid <= 0) continue;
      const inc = incidents[i];
      if (
        euclideanDistanceM(lx.centerXM, lx.centerYM, inc.snappedXM, inc.snappedYM) <=
        eps * 0.6
      ) {
        const dNet = computeNetworkDistanceBetweenLRS(
          {
            segmentCode: lx.segmentCode,
            fromNodeCode: lx.fromNodeCode,
            toNodeCode: lx.toNodeCode,
            lengthM: lx.segmentLengthM,
          },
          mMid,
          {
            segmentCode: inc.segmentCode,
            fromNodeCode: inc.fromNodeCode,
            toNodeCode: inc.toNodeCode,
            lengthM: inc.segmentLengthM,
          },
          inc.linearOffsetM,
          spMatrix
        ).distanceM;
        if (dNet <= eps * 0.55) {
          lixelClusterIds[li] = cid;
          break;
        }
      }
    }
  }

  const clusters: NetworkDbscanClusterSummary[] = [];
  for (let cid = 1; cid <= currentClusterId; cid++) {
    const memberIdxs = [];
    for (let i = 0; i < m; i++) {
      if (clusterOfIdx[i] === cid) memberIdxs.push(i);
    }
    if (memberIdxs.length === 0) continue;

    const memberIncidentIds = memberIdxs.map((idx) => incidents[idx].id);
    const memberLixelIds: number[] = [];
    let networkSpanM = 0;

    lixels.forEach((lx, li) => {
      if (lixelClusterIds[li] === cid) {
        memberLixelIds.push(lx.id);
        networkSpanM += lx.lengthM;
      }
    });

    const meanEpdoSeverity = Number(
      (
        memberIdxs.reduce((acc, idx) => acc + incidents[idx].epdoWeight, 0) /
        memberIdxs.length
      ).toFixed(2)
    );

    const segCodes = Array.from(
      new Set(memberIdxs.map((idx) => incidents[idx].segmentCode))
    );

    // Build padded geo points for convex hull visualization
    const hullInputPts: [number, number][] = [];
    for (const idx of memberIdxs) {
      const lon = incidents[idx].snappedLon;
      const lat = incidents[idx].snappedLat;
      const pad = 0.00028;
      hullInputPts.push(
        [lon - pad, lat - pad],
        [lon + pad, lat - pad],
        [lon + pad, lat + pad],
        [lon - pad, lat + pad]
      );
    }

    clusters.push({
      clusterId: cid,
      incidentCount: memberIncidentIds.length,
      lixelCount: memberLixelIds.length,
      dominantRoadNames: segCodes,
      meanEpdoSeverity,
      networkSpanM: Number(networkSpanM.toFixed(1)),
      convexHullGeo: computeConvexHullGeo(hullInputPts),
      memberLixelIds,
      memberIncidentIds,
    });
  }

  clusters.sort((a, b) => b.incidentCount - a.incidentCount);

  return {
    incidentClusterIds,
    lixelClusterIds,
    clusters,
    noiseIncidentCount,
  };
}
