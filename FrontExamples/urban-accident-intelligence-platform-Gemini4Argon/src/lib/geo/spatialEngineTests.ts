import {
  metricToGeo,
  geoToMetric,
  euclideanDistanceM,
} from "./crs";
import {
  buildCanonicalRoadNetwork,
  generateLixelsForNetwork,
  buildAllPairsShortestPaths,
  computeNetworkDistanceBetweenLRS,
} from "./network";
import {
  computeProbabilisticMapMatch,
  LixelForMatching,
  SegmentForMatching,
} from "./mapMatching";
import {
  computeNetworkGetisOrdAndMoran,
  applyBenjaminiHochbergFdr,
} from "./spatialStats";
import { evaluateSegmentRiskAndEbPortfolio } from "./riskEngine";

export interface TestCaseResult {
  name: string;
  passed: boolean;
  assertionDetail: string;
}

export function runAllSpatialEngineTests(): {
  allPassed: boolean;
  totalTests: number;
  passedCount: number;
  results: TestCaseResult[];
} {
  const results: TestCaseResult[] = [];

  // Test 1: Dual-CRS Metric <-> Geographic Round-Trip Precision
  {
    const x0 = 584512.35;
    const y0 = 4512340.8;
    const [lon, lat] = metricToGeo(x0, y0);
    const [x1, y1] = geoToMetric(lon, lat);
    const errM = Math.hypot(x1 - x0, y1 - y0);
    results.push({
      name: "Dual-CRS Round-Trip Transformation (EPSG:32618 <-> EPSG:4326)",
      passed: errM < 0.25,
      assertionDetail: `Round-trip metric residual = ${errM.toFixed(4)}m (< 0.25m threshold)`,
    });
  }

  // Test 2: Topological Lixel Length Conservation (MAUP Mitigation)
  const { nodes, segments } = buildCanonicalRoadNetwork();
  const lixels = generateLixelsForNetwork(segments, 50);
  {
    let maxLenDiscrepancy = 0;
    for (const seg of segments) {
      const segLixels = lixels.filter((l) => l.segmentCode === seg.segmentCode);
      const sumLixelLen = segLixels.reduce((acc, l) => acc + l.lengthM, 0);
      const diff = Math.abs(sumLixelLen - seg.lengthM);
      if (diff > maxLenDiscrepancy) maxLenDiscrepancy = diff;
    }
    results.push({
      name: "Lixel Linear Referencing (LRS) Length Conservation",
      passed: maxLenDiscrepancy < 0.05 && lixels.length > segments.length,
      assertionDetail: `Segmented ${segments.length} road edges into ${lixels.length} lixels; max LRS length discrepancy = ${maxLenDiscrepancy.toFixed(4)}m`,
    });
  }

  // Test 3: Network Distance >= Euclidean Distance & Grade-Separated Overpass Isolation
  const spMatrix = buildAllPairsShortestPaths(nodes, segments);
  {
    const overpassSeg = segments.find((s) => s.isOverpass)!;
    const crossedSurfaceSeg = segments.find(
      (s) => s.fromNodeCode === "N07" && s.toNodeCode === "N12"
    )!;
    const dNetObj = computeNetworkDistanceBetweenLRS(
      overpassSeg,
      overpassSeg.lengthM / 2,
      crossedSurfaceSeg,
      crossedSurfaceSeg.lengthM / 2,
      spMatrix
    );
    const [ox, oy] = overpassSeg.coordsMetric[1];
    const [sx, sy] = crossedSurfaceSeg.coordsMetric[0];
    const dEuc = euclideanDistanceM(ox, oy, sx, sy);

    results.push({
      name: "Shortest-Path Network Distance vs. Grade-Separated Overpass Isolation",
      passed: dNetObj.distanceM > dEuc && dNetObj.distanceM > 400,
      assertionDetail: `Overpass-to-Surface d_net = ${dNetObj.distanceM}m vs Planar d_Euc = ${dEuc.toFixed(1)}m (No false planar intersection node)`,
    });
  }

  // Test 4: Probabilistic Topological Map-Matching & Overpass Disambiguation
  {
    const segsForMatch: SegmentForMatching[] = segments.map((s, idx) => ({
      id: idx + 1,
      segmentCode: s.segmentCode,
      name: s.name,
      roadClass: s.roadClass,
      fromNodeCode: s.fromNodeCode,
      toNodeCode: s.toNodeCode,
      isOverpass: s.isOverpass,
      lengthM: s.lengthM,
      speedLimitKmh: s.speedLimitKmh,
      coordsMetric: s.coordsMetric,
    }));
    const lixelsBySegId = new Map<number, LixelForMatching[]>();
    segsForMatch.forEach((s) => {
      lixelsBySegId.set(s.id, [
        {
          id: s.id * 10,
          lixelCode: `${s.segmentCode}_L001`,
          segmentId: s.id,
          segmentCode: s.segmentCode,
          mStartM: 0,
          mEndM: s.lengthM,
        },
      ]);
    });

    const matchOut = computeProbabilisticMapMatch(
      584505,
      4512230,
      20,
      segsForMatch,
      lixelsBySegId,
      { categoryCode: "pedestrian_conflict", severityCode: "severe_injury" }
    );
    const probSum = matchOut.candidates.reduce(
      (acc, c) => acc + c.probabilityScore,
      0
    );
    const matchedSeg = segsForMatch.find(
      (s) => s.id === matchOut.bestCandidate.segmentId
    )!;

    results.push({
      name: "Probabilistic Topological Map-Matching Normalization & Overpass Penalty",
      passed: Math.abs(probSum - 1.0) < 0.01 && !matchedSeg.isOverpass,
      assertionDetail: `Candidate probabilities sum = ${probSum.toFixed(4)}; pedestrian conflict matched to surface segment ${matchedSeg.segmentCode} (isOverpass=${matchedSeg.isOverpass})`,
    });
  }

  // Test 5: Statistical Edge Case — Zero Variance Guard in Network Getis-Ord Gi*
  {
    const dummyLixels = lixels.slice(0, 15).map((l, idx) => ({
      id: idx + 1,
      lixelCode: l.lixelCode,
      segmentId: 1,
      segmentCode: l.segmentCode,
      fromNodeCode: "N01",
      toNodeCode: "N02",
      segmentLengthM: 500,
      mStartM: l.mStartM,
      mEndM: l.mEndM,
      lengthM: l.lengthM,
      centerXM: l.centerXM,
      centerYM: l.centerYM,
      centerLon: l.centerLon,
      centerLat: l.centerLat,
      trueIntensityLambda: 0.2,
    }));
    const zeroVarOut = computeNetworkGetisOrdAndMoran({
      lixels: dummyLixels,
      lixelValues: new Array(15).fill(2.5), // Constant values -> variance = 0
      spMatrix,
      neighborhoodCutoffM: 200,
    });
    const fdrCheck = applyBenjaminiHochbergFdr([0.002, 0.015, 0.04, 0.25]);

    results.push({
      name: "Statistical Edge-Case Guards (Zero-Variance Gi* & BH-FDR Monotonicity)",
      passed:
        zeroVarOut.assumptionsPassed === false &&
        fdrCheck[0] >= 0.002 &&
        fdrCheck[0] <= fdrCheck[1],
      assertionDetail: `Zero-variance rejected cleanly (${zeroVarOut.assumptionMessage}); BH-FDR p_adj = [${fdrCheck.join(", ")}]`,
    });
  }

  // Test 6: Empirical Bayes (EB) Regression-to-the-Mean (RTM) Convex Shrinkage Invariant
  {
    const ebEval = evaluateSegmentRiskAndEbPortfolio([
      {
        segmentId: 1,
        segmentCode: "E01",
        name: "Test Arterial",
        roadClass: "arterial",
        isOverpass: false,
        lengthM: 550,
        speedLimitKmh: 60,
        laneCount: 4,
        sinuosity: 1.04,
        aadt: 24000,
        spfAlpha: -7.65,
        spfBeta: 0.94,
        spfOverdispersionPhi: 0.36,
        observedVerifiedCount: 12,
        observedUnverifiedCount: 0,
        epdoSum: 28,
        wetOrNightCrashCount: 4,
      },
    ])[0];

    const betweenPriorAndObs =
      ebEval.ebExpectedCount > ebEval.spfPriorExpected &&
      ebEval.ebExpectedCount < ebEval.rawCrashCount;

    results.push({
      name: "Empirical Bayes RTM Convex Shrinkage Invariant (SPF < E_EB < N_obs)",
      passed: betweenPriorAndObs && ebEval.ebWeightW > 0 && ebEval.ebWeightW < 1,
      assertionDetail: `SPF Prior=${ebEval.spfPriorExpected}, EB Expected=${ebEval.ebExpectedCount}, Observed=${ebEval.rawCrashCount} (w=${ebEval.ebWeightW}, PSI=+${ebEval.psiExcessCrashFrequency})`,
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    allPassed: passedCount === results.length,
    totalTests: results.length,
    passedCount,
    results,
  };
}
