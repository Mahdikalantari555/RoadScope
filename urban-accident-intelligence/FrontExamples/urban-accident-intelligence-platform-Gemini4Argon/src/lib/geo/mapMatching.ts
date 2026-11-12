import {
  projectPointOntoPolylineM,
  metricToGeo,
  euclideanDistanceM,
} from "./crs";
import {
  computeNetworkDistanceBetweenLRS,
  NetworkShortestPathMatrix,
} from "./network";
import type { SnapCandidate } from "@/db/schema";

export interface SegmentForMatching {
  id: number;
  segmentCode: string;
  name: string;
  roadClass: string;
  fromNodeCode: string;
  toNodeCode: string;
  isOverpass: boolean;
  lengthM: number;
  speedLimitKmh: number;
  coordsMetric: [number, number][];
}

export interface LixelForMatching {
  id: number;
  lixelCode: string;
  segmentId: number;
  segmentCode: string;
  mStartM: number;
  mEndM: number;
}

/**
 * US-3.1 Probabilistic Topological Map-Matching
 * Computes ranked candidate snaps onto nearby road segments using a composite scoring function:
 * S(e | p_raw) \propto exp(-d_perp^2 / (2 * sigma^2)) * W_class(e) * W_junction(m) * W_overpass(e, severity)
 */
export function computeProbabilisticMapMatch(
  rawXM: number,
  rawYM: number,
  observationalRadiusM: number,
  segments: SegmentForMatching[],
  lixelsBySegmentId: Map<number, LixelForMatching[]>,
  hints?: {
    severityCode?: string;
    categoryCode?: string;
    preferGradeSeparatedOverpass?: boolean;
  }
): {
  bestCandidate: SnapCandidate;
  candidates: SnapCandidate[];
} {
  const sigma = Math.max(8.0, observationalRadiusM * 0.85);

  const classPrior: Record<string, number> = {
    arterial: 1.28,
    motorway: 1.18,
    collector: 1.05,
    local: 0.88,
  };

  const rawScores: Array<{
    cand: Omit<SnapCandidate, "probabilityScore">;
    rawWeight: number;
  }> = [];

  for (const seg of segments) {
    const proj = projectPointOntoPolylineM(rawXM, rawYM, seg.coordsMetric);
    const junctionDist = Number(
      Math.min(proj.linearOffsetM, seg.lengthM - proj.linearOffsetM).toFixed(2)
    );

    // Gaussian positional likelihood
    const distLikelihood = Math.exp(
      -(proj.orthogonalDistM * proj.orthogonalDistM) / (2 * sigma * sigma + 1e-6)
    );

    // Road hierarchy prior
    let hierarchyFactor = classPrior[seg.roadClass] ?? 1.0;

    // Overpass disambiguation: if high-speed rear-end/multi-vehicle or overpass flag, boost motorway;
    // if pedestrian/cyclist conflict, penalize elevated grade-separated viaduct!
    if (seg.isOverpass) {
      if (hints?.categoryCode === "pedestrian_conflict" || hints?.categoryCode === "cyclist_dooring") {
        hierarchyFactor *= 0.18;
      } else if (hints?.preferGradeSeparatedOverpass || hints?.severityCode === "fatal") {
        hierarchyFactor *= 1.35;
      }
    }

    // Topological junction affinity: crashes near intersections have higher multi-leg topological capture
    const junctionFactor = 1.0 + 0.25 * Math.exp(-junctionDist / 45.0);

    const rawWeight = Math.max(1e-9, distLikelihood * hierarchyFactor * junctionFactor);

    // Find corresponding lixel along this segment
    const segLixels = lixelsBySegmentId.get(seg.id) ?? [];
    let matchedLixel = segLixels[0];
    for (const lx of segLixels) {
      if (proj.linearOffsetM >= lx.mStartM && proj.linearOffsetM <= lx.mEndM + 0.5) {
        matchedLixel = lx;
        break;
      }
    }

    const [snappedLon, snappedLat] = metricToGeo(proj.snappedXM, proj.snappedYM);

    rawScores.push({
      cand: {
        segmentId: seg.id,
        segmentCode: seg.segmentCode,
        segmentName: seg.name,
        roadClass: seg.roadClass,
        lixelId: matchedLixel ? matchedLixel.id : 1,
        lixelCode: matchedLixel ? matchedLixel.lixelCode : `${seg.segmentCode}_L001`,
        linearOffsetM: proj.linearOffsetM,
        orthogonalDistM: proj.orthogonalDistM,
        snappedXM: proj.snappedXM,
        snappedYM: proj.snappedYM,
        snappedLon,
        snappedLat,
        junctionDistanceM: junctionDist,
      },
      rawWeight,
    });
  }

  rawScores.sort((a, b) => b.rawWeight - a.rawWeight);
  const topK = rawScores.slice(0, 4);
  const weightSum = topK.reduce((acc, item) => acc + item.rawWeight, 0) || 1;

  const candidates: SnapCandidate[] = topK.map((item) => ({
    ...item.cand,
    probabilityScore: Number((item.rawWeight / weightSum).toFixed(4)),
  }));

  return {
    bestCandidate: candidates[0],
    candidates,
  };
}

export interface ActiveIncidentForConflation {
  id: number;
  incidentCode: string;
  snappedSegmentId: number;
  segmentCode: string;
  fromNodeCode: string;
  toNodeCode: string;
  segmentLengthM: number;
  linearOffsetM: number;
  snappedXM: number;
  snappedYM: number;
  incidentTimestampUtc: Date;
  categoryCode: string;
  severityCode: string;
  verificationStatus: string;
  credibilityScore: number;
  witnessCount: number;
  narrative: string;
}

export interface ConflationMatchResult {
  incidentId: number;
  incidentCode: string;
  networkDistanceM: number;
  euclideanDistanceM: number;
  timeDeltaMinutes: number;
  spatiotemporalKernelScore: number;
  attributeAgreementScore: number;
  compositeMatchProbability: number;
  categoryCode: string;
  severityCode: string;
  witnessCount: number;
  credibilityScore: number;
  narrative: string;
}

/**
 * US-2.3 & US-3.2 Spatiotemporal Network Conflation Kernel
 * Evaluates existing incidents within shortest-path network distance threshold maxNetworkDistM
 * and temporal window maxTimeMinutes.
 */
export function findSpatiotemporalNetworkConflationCandidates(
  targetSeg: {
    segmentCode: string;
    fromNodeCode: string;
    toNodeCode: string;
    lengthM: number;
  },
  targetOffsetM: number,
  targetXM: number,
  targetYM: number,
  targetTimeUtc: Date,
  targetCategory: string,
  targetSeverity: string,
  activeIncidents: ActiveIncidentForConflation[],
  spMatrix: NetworkShortestPathMatrix,
  maxNetworkDistM = 180,
  maxTimeMinutes = 60
): ConflationMatchResult[] {
  const hNet = 75.0; // Spatial decay bandwidth (m)
  const hTime = 25.0; // Temporal decay bandwidth (minutes)

  const matches: ConflationMatchResult[] = [];

  for (const inc of activeIncidents) {
    if (
      inc.verificationStatus === "rejected" ||
      inc.verificationStatus === "conflated_witness_child"
    ) {
      continue;
    }

    const timeDeltaMin =
      Math.abs(targetTimeUtc.getTime() - inc.incidentTimestampUtc.getTime()) /
      60000.0;
    if (timeDeltaMin > maxTimeMinutes) continue;

    const netDistObj = computeNetworkDistanceBetweenLRS(
      targetSeg,
      targetOffsetM,
      {
        segmentCode: inc.segmentCode,
        fromNodeCode: inc.fromNodeCode,
        toNodeCode: inc.toNodeCode,
        lengthM: inc.segmentLengthM,
      },
      inc.linearOffsetM,
      spMatrix
    );

    if (netDistObj.distanceM > maxNetworkDistM) continue;

    const eucDist = euclideanDistanceM(
      targetXM,
      targetYM,
      inc.snappedXM,
      inc.snappedYM
    );

    const kSpatial = Math.exp(-netDistObj.distanceM / hNet);
    const kTemporal = Math.exp(-timeDeltaMin / hTime);
    const stKernel = Number((kSpatial * kTemporal).toFixed(4));

    let attrScore = 0.65;
    if (inc.categoryCode === targetCategory) attrScore += 0.22;
    if (inc.severityCode === targetSeverity) attrScore += 0.13;

    const composite = Number(Math.min(0.99, stKernel * 0.72 + attrScore * 0.28).toFixed(4));

    matches.push({
      incidentId: inc.id,
      incidentCode: inc.incidentCode,
      networkDistanceM: netDistObj.distanceM,
      euclideanDistanceM: Number(eucDist.toFixed(2)),
      timeDeltaMinutes: Number(timeDeltaMin.toFixed(1)),
      spatiotemporalKernelScore: stKernel,
      attributeAgreementScore: Number(attrScore.toFixed(2)),
      compositeMatchProbability: composite,
      categoryCode: inc.categoryCode,
      severityCode: inc.severityCode,
      witnessCount: inc.witnessCount,
      credibilityScore: inc.credibilityScore,
      narrative: inc.narrative,
    });
  }

  matches.sort((a, b) => b.compositeMatchProbability - a.compositeMatchProbability);
  return matches;
}

/**
 * Computes composite VGI Credibility Score C \in [0, 1] from:
 * - Multi-witness Bayesian corroboration (1 - (1 - p0)^W)
 * - Map-matching topological snap probability
 * - Observational positional certainty (inverse of radius)
 * - Reporting lag freshness decay
 */
export function computeVgiCredibilityScore(params: {
  witnessCount: number;
  snapProbabilityScore: number;
  observationalRadiusM: number;
  reportingLagMinutes: number;
  reporterTrustScore?: number;
  isVerifiedBySteward?: boolean;
}): number {
  if (params.isVerifiedBySteward) return 0.98;

  const baseTrust = params.reporterTrustScore ?? 0.72;
  const witnessBoost = 1 - Math.pow(1 - 0.45, Math.max(1, params.witnessCount));
  const radiusPenalty = Math.exp(-Math.max(0, params.observationalRadiusM - 5) / 60.0);
  const lagPenalty = Math.exp(-Math.max(0, params.reportingLagMinutes) / 180.0);

  const raw =
    0.34 * witnessBoost +
    0.28 * params.snapProbabilityScore +
    0.20 * radiusPenalty +
    0.10 * lagPenalty +
    0.08 * baseTrust;

  return Number(Math.max(0.12, Math.min(0.96, raw)).toFixed(3));
}
