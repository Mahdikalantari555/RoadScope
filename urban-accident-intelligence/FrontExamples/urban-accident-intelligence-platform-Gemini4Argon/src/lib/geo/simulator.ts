import {
  interpolateAlongPolylineM,
  metricToGeo,
} from "./crs";
import {
  computeProbabilisticMapMatch,
  computeVgiCredibilityScore,
  SegmentForMatching,
  LixelForMatching,
} from "./mapMatching";
import type { SnapCandidate } from "@/db/schema";

export type SimulationScenarioType =
  | "uniform_baseline"
  | "intersection_clustered"
  | "diurnal_rush_hour_shock"
  | "multi_covariate_complex_urban";

export interface SimulationConfig {
  scenarioType: SimulationScenarioType;
  seed: number;
  baseIntensityMultiplier?: number;
  gaussianDriftStdM?: number;
  duplicateBurstRate?: number;
  falseAlarmRate?: number;
}

/**
 * Deterministic seeded PRNG (Mulberry32)
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleStandardNormal(rng: () => number): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export function samplePoisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1.0;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 30);
  return k - 1;
}

/**
 * Computes the analytical ground-truth point-process intensity \lambda(e, m)
 * (expected crashes per 100m lixel over study window) for benchmarking (US-1.2 & US-1.4).
 */
export function evaluateTrueLixelIntensityLambda(params: {
  scenarioType: SimulationScenarioType;
  roadClass: string;
  isOverpass: boolean;
  sinuosity: number;
  aadt: number;
  distToNearestJunctionM: number;
  centerXM: number;
  centerYM: number;
}): {
  trueLambda: number;
  baselinePrior: number;
} {
  const {
    scenarioType,
    roadClass,
    isOverpass,
    sinuosity,
    aadt,
    distToNearestJunctionM,
    centerXM,
    centerYM,
  } = params;

  const classWeight =
    roadClass === "arterial"
      ? 1.55
      : roadClass === "motorway"
      ? 1.40
      : roadClass === "collector"
      ? 0.95
      : 0.55;

  const exposureFactor = Math.pow(Math.max(1000, aadt) / 15000.0, 0.65);
  const baselinePrior = Number((0.28 * classWeight * exposureFactor).toFixed(4));

  if (scenarioType === "uniform_baseline") {
    return {
      trueLambda: 0.42,
      baselinePrior: 0.42,
    };
  }

  if (scenarioType === "intersection_clustered") {
    const juncSpike = 1.0 + 3.4 * Math.exp(-distToNearestJunctionM / 55.0);
    const nonJuncPenalty = isOverpass ? 0.35 : 1.0;
    const lambda = Number((0.22 * classWeight * juncSpike * nonJuncPenalty).toFixed(4));
    return {
      trueLambda: lambda,
      baselinePrior,
    };
  }

  if (scenarioType === "diurnal_rush_hour_shock") {
    const commuterBoost =
      roadClass === "arterial" || roadClass === "motorway" ? 2.35 : 0.65;
    const juncMod = 1.0 + 1.3 * Math.exp(-distToNearestJunctionM / 75.0);
    const lambda = Number((0.25 * commuterBoost * exposureFactor * juncMod).toFixed(4));
    return {
      trueLambda: lambda,
      baselinePrior,
    };
  }

  // multi_covariate_complex_urban (Default Publication Benchmark Scenario)
  const juncEffect = isOverpass
    ? 1.15 // Overpass merge weave hazard
    : 1.0 + 2.65 * Math.exp(-distToNearestJunctionM / 62.0);
  const sinuosityHazard = 1.0 + (sinuosity - 1.0) * 4.5;

  // Spatial localized micro-hotspot around Central Pkwy & Mercer / Grand Diagonal (584500, 4512150)
  const dCenter = Math.hypot(centerXM - 584500, centerYM - 4512150);
  const urbanCoreHotspot = 1.0 + 1.65 * Math.exp(-(dCenter * dCenter) / (2 * 380 * 380));

  const lambda = Number(
    (
      0.21 *
      classWeight *
      exposureFactor *
      juncEffect *
      sinuosityHazard *
      urbanCoreHotspot
    ).toFixed(4)
  );

  return {
    trueLambda: lambda,
    baselinePrior,
  };
}

export interface SimulatedAccidentRecord {
  incidentCode: string;
  parentIndex: number | null;
  rawXM: number;
  rawYM: number;
  rawLon: number;
  rawLat: number;
  observationalRadiusM: number;
  snappedSegmentId: number;
  snappedLixelId: number;
  snappedXM: number;
  snappedYM: number;
  snappedLon: number;
  snappedLat: number;
  linearOffsetM: number;
  snapDistanceM: number;
  snapProbabilityScore: number;
  snapCandidatesJson: SnapCandidate[];
  incidentTimestampUtc: Date;
  reportedTimestampUtc: Date;
  reportingLagMinutes: number;
  categoryCode: string;
  severityCode: string;
  vehicleCount: number;
  pedestrianCount: number;
  emergencyResponsePresent: boolean;
  weatherCondition: string;
  lightingCondition: string;
  roadSurface: string;
  narrative: string;
  verificationStatus:
    | "unverified_raw_vgi"
    | "verified_canonical"
    | "conflated_witness_child"
    | "rejected"
    | "flagged";
  credibilityScore: number;
  witnessCount: number;
  isSynthetic: boolean;
  isFalseAlarm: boolean;
}

/**
 * Realizes a full synthetic dataset of accidents + VGI witness bursts + false alarms
 * governed by the lixel-level intensity surface \lambda(l_i).
 */
export function simulatePointProcessRealization(
  config: SimulationConfig,
  segments: SegmentForMatching[],
  lixels: Array<
    LixelForMatching & {
      lengthM: number;
      centerXM: number;
      centerYM: number;
      distToNearestJunctionM: number;
      trueIntensityLambda: number;
    }
  >
): SimulatedAccidentRecord[] {
  const rng = createSeededRng(config.seed);
  const mult = config.baseIntensityMultiplier ?? 1.0;
  const driftStdM = config.gaussianDriftStdM ?? 14.0;
  const dupBurstRate = config.duplicateBurstRate ?? 0.32;
  const falseAlarmRate = config.falseAlarmRate ?? 0.08;

  const segMap = new Map<number, SegmentForMatching>();
  segments.forEach((s) => segMap.set(s.id, s));

  const lixelsBySegmentId = new Map<number, LixelForMatching[]>();
  lixels.forEach((lx) => {
    const arr = lixelsBySegmentId.get(lx.segmentId) ?? [];
    arr.push(lx);
    lixelsBySegmentId.set(lx.segmentId, arr);
  });

  const categories = [
    "rear_end_collision",
    "angle_turning_conflict",
    "sideswipe_lane_change",
    "pedestrian_conflict",
    "cyclist_dooring",
    "fixed_object_runoff",
  ];

  const weathers = ["Clear", "Clear", "Rain", "Overcast", "Fog"];
  const records: SimulatedAccidentRecord[] = [];
  let seq = 1;

  // Base anchor date (UTC)
  const baseTimeMs = Date.UTC(2025, 2, 1, 0, 0, 0);

  for (const lx of lixels) {
    const seg = segMap.get(lx.segmentId);
    if (!seg) continue;

    // Expected realizations on this lixel scaled by length
    const expectedCount =
      lx.trueIntensityLambda * (lx.lengthM / 50.0) * 0.58 * mult;
    const count = samplePoisson(expectedCount, rng);

    for (let k = 0; k < count; k++) {
      // Exact ground-truth position along lixel
      const exactM = Number(
        (lx.mStartM + rng() * Math.max(1.0, lx.mEndM - lx.mStartM)).toFixed(2)
      );
      const [trueX, trueY] = interpolateAlongPolylineM(seg.coordsMetric, exactM);

      // Inject 2D Gaussian VGI positional drift off centerline (US-1.3)
      const driftX = sampleStandardNormal(rng) * driftStdM;
      const driftY = sampleStandardNormal(rng) * driftStdM;
      const rawXM = Number((trueX + driftX).toFixed(2));
      const rawYM = Number((trueY + driftY).toFixed(2));
      const [rawLon, rawLat] = metricToGeo(rawXM, rawYM);
      const obsRadius = Number((8 + rng() * 24).toFixed(1));

      // Diurnal timestamp modulation
      const dayOffset = Math.floor(rng() * 14);
      let hour: number;
      const uHour = rng();
      if (
        config.scenarioType === "diurnal_rush_hour_shock" ||
        config.scenarioType === "multi_covariate_complex_urban"
      ) {
        if (uHour < 0.38) {
          hour = 7 + Math.floor(rng() * 3); // Morning peak 07:00-09:59
        } else if (uHour < 0.78) {
          hour = 16 + Math.floor(rng() * 4); // Evening peak 16:00-19:59
        } else {
          hour = Math.floor(rng() * 24);
        }
      } else {
        hour = Math.floor(rng() * 24);
      }
      const minute = Math.floor(rng() * 60);
      const incidentTime = new Date(
        baseTimeMs + ((dayOffset * 24 + hour) * 60 + minute) * 60000
      );

      const lagMin = Number((1.5 + Math.exp(rng() * 2.8)).toFixed(1));
      const reportedTime = new Date(incidentTime.getTime() + lagMin * 60000);

      // Severity assignment influenced by speed limit and junction proximity
      const uSev = rng();
      const highSpeedBoost = seg.speedLimitKmh >= 60 ? 0.08 : 0.0;
      const severityCode =
        uSev < 0.05 + highSpeedBoost * 0.5
          ? "fatal"
          : uSev < 0.24 + highSpeedBoost
          ? "severe_injury"
          : uSev < 0.62
          ? "minor_injury"
          : "pdo";

      // Category assignment
      let categoryCode: string;
      if (seg.isOverpass) {
        categoryCode =
          rng() < 0.6 ? "rear_end_collision" : "sideswipe_lane_change";
      } else if (lx.distToNearestJunctionM < 45) {
        categoryCode =
          rng() < 0.52
            ? "angle_turning_conflict"
            : rng() < 0.78
            ? "pedestrian_conflict"
            : "rear_end_collision";
      } else {
        categoryCode = categories[Math.floor(rng() * categories.length)];
      }

      const weatherCondition = weathers[Math.floor(rng() * weathers.length)];
      const roadSurface =
        weatherCondition === "Rain" ? "Wet" : rng() < 0.08 ? "Damp" : "Dry";
      const lightingCondition =
        hour >= 7 && hour <= 18
          ? "Daylight"
          : hour === 6 || hour === 19
          ? "Dusk/Dawn"
          : "Night - Lit";

      // Probabilistic Topological Map-Matching
      const match = computeProbabilisticMapMatch(
        rawXM,
        rawYM,
        obsRadius,
        segments,
        lixelsBySegmentId,
        {
          severityCode,
          categoryCode,
          preferGradeSeparatedOverpass: seg.isOverpass,
        }
      );

      const willSpawnDuplicateBurst =
        (severityCode === "fatal" || severityCode === "severe_injury" || rng() < 0.25) &&
        rng() < dupBurstRate;
      const extraWitnesses = willSpawnDuplicateBurst
        ? 1 + Math.floor(rng() * 2)
        : 0;
      const totalWitnesses = 1 + extraWitnesses;

      const isVerified = rng() < 0.74;
      const verificationStatus = isVerified
        ? "verified_canonical"
        : "unverified_raw_vgi";

      const credibilityScore = computeVgiCredibilityScore({
        witnessCount: totalWitnesses,
        snapProbabilityScore: match.bestCandidate.probabilityScore,
        observationalRadiusM: obsRadius,
        reportingLagMinutes: lagMin,
        isVerifiedBySteward: isVerified,
      });

      const canonicalIndex = records.length;
      const incidentCode = `INC-${config.seed}-${String(seq++).padStart(4, "0")}`;

      records.push({
        incidentCode,
        parentIndex: null,
        rawXM,
        rawYM,
        rawLon,
        rawLat,
        observationalRadiusM: obsRadius,
        snappedSegmentId: match.bestCandidate.segmentId,
        snappedLixelId: match.bestCandidate.lixelId,
        snappedXM: match.bestCandidate.snappedXM,
        snappedYM: match.bestCandidate.snappedYM,
        snappedLon: match.bestCandidate.snappedLon,
        snappedLat: match.bestCandidate.snappedLat,
        linearOffsetM: match.bestCandidate.linearOffsetM,
        snapDistanceM: match.bestCandidate.orthogonalDistM,
        snapProbabilityScore: match.bestCandidate.probabilityScore,
        snapCandidatesJson: match.candidates,
        incidentTimestampUtc: incidentTime,
        reportedTimestampUtc: reportedTime,
        reportingLagMinutes: lagMin,
        categoryCode,
        severityCode,
        vehicleCount: categoryCode === "fixed_object_runoff" ? 1 : 2 + Math.floor(rng() * 2),
        pedestrianCount: categoryCode === "pedestrian_conflict" ? 1 : 0,
        emergencyResponsePresent: severityCode !== "pdo" || rng() < 0.45,
        weatherCondition,
        lightingCondition,
        roadSurface,
        narrative: `[Synthetic Cox Point-Process] ${categoryCode.replace(/_/g, " ")} observed near ${match.bestCandidate.segmentName} (LRS m=${match.bestCandidate.linearOffsetM}m, snap Δ=${match.bestCandidate.orthogonalDistM}m).`,
        verificationStatus,
        credibilityScore,
        witnessCount: totalWitnesses,
        isSynthetic: true,
        isFalseAlarm: false,
      });

      // Spawn multi-witness duplicate reports around this crash (US-1.3 & US-3.2)
      for (let w = 0; w < extraWitnesses; w++) {
        const wDriftX = sampleStandardNormal(rng) * (driftStdM * 1.25);
        const wDriftY = sampleStandardNormal(rng) * (driftStdM * 1.25);
        const wRawXM = Number((trueX + wDriftX).toFixed(2));
        const wRawYM = Number((trueY + wDriftY).toFixed(2));
        const [wRawLon, wRawLat] = metricToGeo(wRawXM, wRawYM);
        const wRadius = Number((12 + rng() * 28).toFixed(1));
        const wMatch = computeProbabilisticMapMatch(
          wRawXM,
          wRawYM,
          wRadius,
          segments,
          lixelsBySegmentId,
          { severityCode, categoryCode }
        );
        const wLag = Number((lagMin + 2 + rng() * 14).toFixed(1));
        const wIncidentTime = new Date(
          incidentTime.getTime() + Math.round((rng() - 0.3) * 6) * 60000
        );
        const wReportedTime = new Date(wIncidentTime.getTime() + wLag * 60000);

        // Keep some duplicates in `unverified_raw_vgi` for the Data Steward Triage Queue,
        // and some already merged as `conflated_witness_child`!
        const alreadyMerged = w > 0 || rng() < 0.45;
        const dupCode = `INC-${config.seed}-${String(seq++).padStart(4, "0")}-W${w + 1}`;

        records.push({
          incidentCode: dupCode,
          parentIndex: alreadyMerged ? canonicalIndex : null,
          rawXM: wRawXM,
          rawYM: wRawYM,
          rawLon: wRawLon,
          rawLat: wRawLat,
          observationalRadiusM: wRadius,
          snappedSegmentId: wMatch.bestCandidate.segmentId,
          snappedLixelId: wMatch.bestCandidate.lixelId,
          snappedXM: wMatch.bestCandidate.snappedXM,
          snappedYM: wMatch.bestCandidate.snappedYM,
          snappedLon: wMatch.bestCandidate.snappedLon,
          snappedLat: wMatch.bestCandidate.snappedLat,
          linearOffsetM: wMatch.bestCandidate.linearOffsetM,
          snapDistanceM: wMatch.bestCandidate.orthogonalDistM,
          snapProbabilityScore: wMatch.bestCandidate.probabilityScore,
          snapCandidatesJson: wMatch.candidates,
          incidentTimestampUtc: wIncidentTime,
          reportedTimestampUtc: wReportedTime,
          reportingLagMinutes: wLag,
          categoryCode,
          severityCode,
          vehicleCount: 2,
          pedestrianCount: categoryCode === "pedestrian_conflict" ? 1 : 0,
          emergencyResponsePresent: true,
          weatherCondition,
          lightingCondition,
          roadSurface,
          narrative: `[Multi-Witness Burst Report #${w + 2}] Secondary citizen observation near ${wMatch.bestCandidate.segmentName}; candidate duplicate of ${incidentCode}.`,
          verificationStatus: alreadyMerged
            ? "conflated_witness_child"
            : "unverified_raw_vgi",
          credibilityScore: computeVgiCredibilityScore({
            witnessCount: 1,
            snapProbabilityScore: wMatch.bestCandidate.probabilityScore,
            observationalRadiusM: wRadius,
            reportingLagMinutes: wLag,
          }),
          witnessCount: 1,
          isSynthetic: true,
          isFalseAlarm: false,
        });
      }
    }
  }

  // Inject noisy unverified false alarms (US-1.3)
  const numFalseAlarms = Math.max(3, Math.round(records.length * falseAlarmRate));
  for (let f = 0; f < numFalseAlarms; f++) {
    const randLx = lixels[Math.floor(rng() * lixels.length)];
    const seg = segMap.get(randLx.segmentId)!;
    const exactM = (randLx.mStartM + randLx.mEndM) / 2;
    const [trueX, trueY] = interpolateAlongPolylineM(seg.coordsMetric, exactM);
    // Large positional drift (25m - 55m off centerline)
    const rawXM = Number((trueX + sampleStandardNormal(rng) * 32).toFixed(2));
    const rawYM = Number((trueY + sampleStandardNormal(rng) * 32).toFixed(2));
    const [rawLon, rawLat] = metricToGeo(rawXM, rawYM);
    const obsRadius = Number((35 + rng() * 30).toFixed(1));
    const match = computeProbabilisticMapMatch(
      rawXM,
      rawYM,
      obsRadius,
      segments,
      lixelsBySegmentId
    );
    const incTime = new Date(
      baseTimeMs + Math.floor(rng() * 14 * 24 * 60) * 60000
    );
    const lagMin = Number((25 + rng() * 95).toFixed(1));

    records.push({
      incidentCode: `INC-${config.seed}-FA${String(f + 1).padStart(2, "0")}`,
      parentIndex: null,
      rawXM,
      rawYM,
      rawLon,
      rawLat,
      observationalRadiusM: obsRadius,
      snappedSegmentId: match.bestCandidate.segmentId,
      snappedLixelId: match.bestCandidate.lixelId,
      snappedXM: match.bestCandidate.snappedXM,
      snappedYM: match.bestCandidate.snappedYM,
      snappedLon: match.bestCandidate.snappedLon,
      snappedLat: match.bestCandidate.snappedLat,
      linearOffsetM: match.bestCandidate.linearOffsetM,
      snapDistanceM: match.bestCandidate.orthogonalDistM,
      snapProbabilityScore: match.bestCandidate.probabilityScore,
      snapCandidatesJson: match.candidates,
      incidentTimestampUtc: incTime,
      reportedTimestampUtc: new Date(incTime.getTime() + lagMin * 60000),
      reportingLagMinutes: lagMin,
      categoryCode: "fixed_object_runoff",
      severityCode: "pdo",
      vehicleCount: 1,
      pedestrianCount: 0,
      emergencyResponsePresent: false,
      weatherCondition: "Fog",
      lightingCondition: "Night - Lit",
      roadSurface: "Dry",
      narrative: `[Low-Confidence VGI Observation] Uncorroborated single-witness ping with high positional drift (${match.bestCandidate.orthogonalDistM}m off centerline).`,
      verificationStatus: f % 2 === 0 ? "flagged" : "unverified_raw_vgi",
      credibilityScore: 0.24,
      witnessCount: 1,
      isSynthetic: true,
      isFalseAlarm: true,
    });
  }

  return records;
}
