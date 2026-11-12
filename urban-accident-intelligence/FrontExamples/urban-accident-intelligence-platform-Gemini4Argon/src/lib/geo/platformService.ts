import { db } from "@/db";
import {
  users,
  datasetSources,
  roadNodes,
  roadSegments,
  roadLixels,
  accidentCategories,
  severityLevels,
  accidents,
  reportVerifications,
  reportAttachments,
  environmentalObservations,
  trafficObservations,
  spatialAnalysisJobs,
  spatialAnalysisResults,
  auditLogs,
} from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  buildCanonicalRoadNetwork,
  generateLixelsForNetwork,
  buildAllPairsShortestPaths,
} from "./network";
import {
  evaluateTrueLixelIntensityLambda,
  simulatePointProcessRealization,
  SimulationScenarioType,
} from "./simulator";
import {
  computeProbabilisticMapMatch,
  findSpatiotemporalNetworkConflationCandidates,
  computeVgiCredibilityScore,
  SegmentForMatching,
  LixelForMatching,
  ActiveIncidentForConflation,
} from "./mapMatching";
import {
  computeNkdeVsPlanar,
  computeNetworkGetisOrdAndMoran,
  computeNetworkDbscan,
  evaluateBenchmarkMetrics,
  KernelType,
  LixelNodeForStats,
  IncidentPointForStats,
} from "./spatialStats";
import {
  evaluateSegmentRiskAndEbPortfolio,
  MultiCriteriaWeights,
  SegmentRiskInput,
} from "./riskEngine";
import { geoToMetric, metricToGeo, isWithinMetricBounds } from "./crs";

export interface LabAnalysisParameters {
  kernel: KernelType;
  bandwidthM: number;
  useSeverityWeights: boolean;
  equalSplitAttenuation: number;
  giStarCutoffM: number;
  useFdrCorrection: boolean;
  dbscanEpsM: number;
  dbscanMinPts: number;
  includeUnverifiedVgi: boolean;
  weights: MultiCriteriaWeights;
}

export const DEFAULT_LAB_PARAMS: LabAnalysisParameters = {
  kernel: "quartic",
  bandwidthM: 220,
  useSeverityWeights: true,
  equalSplitAttenuation: 0.65,
  giStarCutoffM: 260,
  useFdrCorrection: true,
  dbscanEpsM: 165,
  dbscanMinPts: 3,
  includeUnverifiedVgi: true,
  weights: {
    ebRiskWeight: 0.40,
    epdoSeverityWeight: 0.30,
    geometricHazardWeight: 0.15,
    environmentalHazardWeight: 0.15,
  },
};

let isSeedingInProgress = false;

/**
 * Ensures the PostgreSQL database is populated with the canonical topological network,
 * lixels, synthetic point-process ground-truth dataset, and initial spatial analysis job.
 */
export async function ensurePlatformSeeded(): Promise<void> {
  const existingNodes = await db.select({ id: roadNodes.id }).from(roadNodes).limit(1);
  if (existingNodes.length > 0) {
    return;
  }
  if (isSeedingInProgress) return;
  isSeedingInProgress = true;
  try {
    await rebuildSimulationDataset({
      scenarioType: "multi_covariate_complex_urban",
      seed: 42,
      lixelSizeM: 50,
      baseIntensityMultiplier: 1.0,
      gaussianDriftStdM: 14.0,
      duplicateBurstRate: 0.32,
      falseAlarmRate: 0.08,
    });
  } finally {
    isSeedingInProgress = false;
  }
}

export async function rebuildSimulationDataset(options: {
  scenarioType: SimulationScenarioType;
  seed: number;
  lixelSizeM: number;
  baseIntensityMultiplier?: number;
  gaussianDriftStdM?: number;
  duplicateBurstRate?: number;
  falseAlarmRate?: number;
}) {
  const startTime = Date.now();
  const {
    scenarioType,
    seed,
    lixelSizeM = 50,
    baseIntensityMultiplier = 1.0,
    gaussianDriftStdM = 14.0,
    duplicateBurstRate = 0.32,
    falseAlarmRate = 0.08,
  } = options;

  // Clear dependent tables in topological foreign-key order
  await db.delete(spatialAnalysisResults);
  await db.delete(spatialAnalysisJobs);
  await db.delete(reportVerifications);
  await db.delete(reportAttachments);
  await db.delete(accidents);
  await db.delete(environmentalObservations);
  await db.delete(trafficObservations);
  await db.delete(roadLixels);
  await db.delete(roadSegments);
  await db.delete(roadNodes);
  await db.delete(datasetSources);

  // Ensure reference tables (users, categories, severity levels) are populated
  const existingUsers = await db.select().from(users);
  if (existingUsers.length === 0) {
    await db.insert(users).values([
      {
        handle: "dr_okabe_sim",
        name: "Dr. Kenji Okabe (Simulation Scientist)",
        role: "simulation_scientist",
        trustScore: 0.99,
        affiliation: "Spatial Point Process Lab",
      },
      {
        handle: "steward_marta",
        name: "Marta Lindqvist (Lead Geospatial Steward)",
        role: "data_steward",
        trustScore: 0.98,
        affiliation: "Municipal Geomatics QA Unit",
      },
      {
        handle: "prof_getis_gis",
        name: "Prof. Elena Vance (GIScience Researcher)",
        role: "gis_researcher",
        trustScore: 0.99,
        affiliation: "Center for Network Geocomputation",
      },
      {
        handle: "eng_hauer_eb",
        name: "Marcus Hauer, PE (Traffic Safety Engineer)",
        role: "safety_engineer",
        trustScore: 0.97,
        affiliation: "Vision Zero Corridor Engineering",
      },
      {
        handle: "citizen_alex",
        name: "Alex Rivera (Verified VGI Contributor)",
        role: "citizen_reporter",
        trustScore: 0.82,
        affiliation: "Urban Cyclist & Mobility Watch",
      },
    ]);
  }

  const existingCats = await db.select().from(accidentCategories);
  if (existingCats.length === 0) {
    await db.insert(accidentCategories).values([
      {
        code: "rear_end_collision",
        name: "Rear-End Queue Collision",
        description: "Longitudinal impact along approach queue or arterial corridor",
        defaultRiskWeight: 1.15,
      },
      {
        code: "angle_turning_conflict",
        name: "Intersection Angle / Turning Conflict",
        description: "Multi-leg topological junction conflict during signal phase transition",
        defaultRiskWeight: 1.45,
      },
      {
        code: "sideswipe_lane_change",
        name: "Weaving / Sideswipe Merge Conflict",
        description: "Lateral lane-change conflict common on multi-lane viaducts and ramps",
        defaultRiskWeight: 1.10,
      },
      {
        code: "pedestrian_conflict",
        name: "Pedestrian Crosswalk Impact",
        description: "Vulnerable road user conflict at urban crosswalk or mid-block",
        defaultRiskWeight: 1.85,
      },
      {
        code: "cyclist_dooring",
        name: "Micromobility / Cyclist Conflict",
        description: "Bike lane encroachment, dooring, or right-hook turning impact",
        defaultRiskWeight: 1.65,
      },
      {
        code: "fixed_object_runoff",
        name: "Roadway Departure / Fixed Object",
        description: "Single-vehicle loss of control along high-sinuosity or wet segment",
        defaultRiskWeight: 1.30,
      },
    ]);
  }

  const existingSevs = await db.select().from(severityLevels);
  if (existingSevs.length === 0) {
    await db.insert(severityLevels).values([
      {
        code: "fatal",
        label: "Fatal (K)",
        rank: 4,
        epdoWeight: 9.5,
        colorHex: "#f43f5e",
      },
      {
        code: "severe_injury",
        label: "Incapacitating Injury (A)",
        rank: 3,
        epdoWeight: 5.5,
        colorHex: "#f97316",
      },
      {
        code: "minor_injury",
        label: "Non-Incapacitating Injury (B/C)",
        rank: 2,
        epdoWeight: 2.5,
        colorHex: "#facc15",
      },
      {
        code: "pdo",
        label: "Property Damage Only (O)",
        rank: 1,
        epdoWeight: 1.0,
        colorHex: "#38bdf8",
      },
    ]);
  }

  const allUsers = await db.select().from(users);
  const citizenUser =
    allUsers.find((u) => u.role === "citizen_reporter") ?? allUsers[0];
  const stewardUser =
    allUsers.find((u) => u.role === "data_steward") ?? allUsers[0];

  const scenarioLabels: Record<SimulationScenarioType, string> = {
    uniform_baseline: "Uniform Homogeneous Linear Poisson Baseline",
    intersection_clustered: "Intersection-Clustered Topological Decay Process",
    diurnal_rush_hour_shock: "Diurnal Bimodal Commuter Rush-Hour Shock",
    multi_covariate_complex_urban: "Multi-Covariate Inhomogeneous Cox Network Process",
  };

  const [dataset] = await db
    .insert(datasetSources)
    .values({
      code: `SIM-${scenarioType.toUpperCase()}-S${seed}-L${lixelSizeM}`,
      name: `[SYNTHETIC BENCHMARK] ${scenarioLabels[scenarioType]}`,
      isSynthetic: true,
      scenarioType,
      seed,
      sridProjected: 32618,
      sridGeographic: 4326,
      lixelSizeM,
      description: `Controlled Inhomogeneous Spatiotemporal Point Process on Linear Network (Seed=${seed}, Lixel Δl=${lixelSizeM}m, Gaussian Drift σ=${gaussianDriftStdM}m).`,
      isActive: true,
    })
    .returning();

  // Build Topological Road Graph
  const { nodes: nodeDefs, segments: segDefs } = buildCanonicalRoadNetwork();

  const insertedNodes = await db
    .insert(roadNodes)
    .values(
      nodeDefs.map((nd) => ({
        nodeCode: nd.nodeCode,
        name: nd.name,
        xM: nd.xM,
        yM: nd.yM,
        lon: nd.lon,
        lat: nd.lat,
        sridProjected: 32618,
        degree: nd.degree,
        isSignalized: nd.isSignalized,
        elevationM: nd.elevationM,
        datasetSourceId: dataset.id,
      }))
    )
    .returning();

  const nodeIdByCode = new Map<string, number>();
  insertedNodes.forEach((n) => nodeIdByCode.set(n.nodeCode, n.id));

  const insertedSegments = await db
    .insert(roadSegments)
    .values(
      segDefs.map((seg) => ({
        segmentCode: seg.segmentCode,
        name: seg.name,
        roadClass: seg.roadClass,
        fromNodeId: nodeIdByCode.get(seg.fromNodeCode)!,
        toNodeId: nodeIdByCode.get(seg.toNodeCode)!,
        isDirected: seg.isDirected,
        isOverpass: seg.isOverpass,
        lengthM: seg.lengthM,
        speedLimitKmh: seg.speedLimitKmh,
        laneCount: seg.laneCount,
        sinuosity: seg.sinuosity,
        aadt: seg.aadt,
        spfAlpha: seg.spfAlpha,
        spfBeta: seg.spfBeta,
        spfOverdispersionPhi: seg.spfOverdispersionPhi,
        coordsMetricJson: seg.coordsMetric,
        coordsGeoJson: seg.coordsGeo,
        bboxMinX: seg.bboxMinX,
        bboxMinY: seg.bboxMinY,
        bboxMaxX: seg.bboxMaxX,
        bboxMaxY: seg.bboxMaxY,
        datasetSourceId: dataset.id,
      }))
    )
    .returning();

  const segByCode = new Map<
    string,
    (typeof insertedSegments)[number] & {
      fromNodeCode: string;
      toNodeCode: string;
    }
  >();

  insertedSegments.forEach((s, idx) => {
    segByCode.set(s.segmentCode, {
      ...s,
      fromNodeCode: segDefs[idx].fromNodeCode,
      toNodeCode: segDefs[idx].toNodeCode,
    });
  });

  // Generate Dynamic Lixels & Evaluate Analytical Ground-Truth \lambda(e, m)
  const lixelDefs = generateLixelsForNetwork(segDefs, lixelSizeM);
  const lixelValuesToInsert = lixelDefs.map((lx) => {
    const parentSeg = segByCode.get(lx.segmentCode)!;
    const { trueLambda, baselinePrior } = evaluateTrueLixelIntensityLambda({
      scenarioType,
      roadClass: parentSeg.roadClass,
      isOverpass: parentSeg.isOverpass,
      sinuosity: parentSeg.sinuosity,
      aadt: parentSeg.aadt,
      distToNearestJunctionM: lx.distToNearestJunctionM,
      centerXM: lx.centerXM,
      centerYM: lx.centerYM,
    });
    return {
      lixelCode: lx.lixelCode,
      segmentId: parentSeg.id,
      lixelIndex: lx.lixelIndex,
      mStartM: lx.mStartM,
      mEndM: lx.mEndM,
      lengthM: lx.lengthM,
      centerXM: lx.centerXM,
      centerYM: lx.centerYM,
      centerLon: lx.centerLon,
      centerLat: lx.centerLat,
      distToNearestJunctionM: lx.distToNearestJunctionM,
      coordsMetricJson: lx.coordsMetric,
      coordsGeoJson: lx.coordsGeo,
      trueIntensityLambda: trueLambda,
      baselineRiskPrior: baselinePrior,
      datasetSourceId: dataset.id,
    };
  });

  const insertedLixels = await db
    .insert(roadLixels)
    .values(lixelValuesToInsert)
    .returning();

  // Populate environmental & traffic exposure observations per segment
  await db.insert(environmentalObservations).values(
    insertedSegments.map((seg, i) => ({
      segmentId: seg.id,
      observedAtUtc: new Date(Date.UTC(2025, 2, 10, 14, 0, 0)),
      weatherState: i % 5 === 0 ? "Rain" : i % 7 === 0 ? "Fog" : "Clear",
      precipitationMmHr: i % 5 === 0 ? 4.2 : 0.0,
      visibilityKm: i % 7 === 0 ? 2.4 : 10.0,
      ambientLightLux: 14500,
      surfaceFrictionIndex: i % 5 === 0 ? 0.54 : 0.79,
    }))
  );

  await db.insert(trafficObservations).values(
    insertedSegments.map((seg) => ({
      segmentId: seg.id,
      hourOfDay: 8,
      aadtObserved: seg.aadt,
      meanSpeedKmh: Number((seg.speedLimitKmh * 0.86).toFixed(1)),
      heavyVehiclePct: seg.roadClass === "motorway" ? 14.2 : 6.4,
      vktDailyMillion: Number(
        ((seg.aadt * (seg.lengthM / 1000.0)) / 1_000_000.0).toFixed(5)
      ),
    }))
  );

  // Prepare structures for Point-Process Realization
  const segmentsForMatching: SegmentForMatching[] = insertedSegments.map(
    (s, idx) => ({
      id: s.id,
      segmentCode: s.segmentCode,
      name: s.name,
      roadClass: s.roadClass,
      fromNodeCode: segDefs[idx].fromNodeCode,
      toNodeCode: segDefs[idx].toNodeCode,
      isOverpass: s.isOverpass,
      lengthM: s.lengthM,
      speedLimitKmh: s.speedLimitKmh,
      coordsMetric: s.coordsMetricJson,
    })
  );

  const segCodeById = new Map<number, string>();
  insertedSegments.forEach((s) => segCodeById.set(s.id, s.segmentCode));

  const lixelsForSim = insertedLixels.map((lx) => ({
    id: lx.id,
    lixelCode: lx.lixelCode,
    segmentId: lx.segmentId,
    segmentCode: segCodeById.get(lx.segmentId)!,
    mStartM: lx.mStartM,
    mEndM: lx.mEndM,
    lengthM: lx.lengthM,
    centerXM: lx.centerXM,
    centerYM: lx.centerYM,
    distToNearestJunctionM: lx.distToNearestJunctionM,
    trueIntensityLambda: lx.trueIntensityLambda,
  }));

  const simRecords = simulatePointProcessRealization(
    {
      scenarioType,
      seed,
      baseIntensityMultiplier,
      gaussianDriftStdM,
      duplicateBurstRate,
      falseAlarmRate,
    },
    segmentsForMatching,
    lixelsForSim
  );

  const insertedAccidents = await db
    .insert(accidents)
    .values(
      simRecords.map((rec) => ({
        incidentCode: rec.incidentCode,
        datasetSourceId: dataset.id,
        parentCanonicalId: null,
        rawXM: rec.rawXM,
        rawYM: rec.rawYM,
        rawLon: rec.rawLon,
        rawLat: rec.rawLat,
        observationalRadiusM: rec.observationalRadiusM,
        snappedSegmentId: rec.snappedSegmentId,
        snappedLixelId: rec.snappedLixelId,
        snappedXM: rec.snappedXM,
        snappedYM: rec.snappedYM,
        snappedLon: rec.snappedLon,
        snappedLat: rec.snappedLat,
        linearOffsetM: rec.linearOffsetM,
        snapDistanceM: rec.snapDistanceM,
        snapProbabilityScore: rec.snapProbabilityScore,
        snapCandidatesJson: rec.snapCandidatesJson,
        incidentTimestampUtc: rec.incidentTimestampUtc,
        reportedTimestampUtc: rec.reportedTimestampUtc,
        reportingLagMinutes: rec.reportingLagMinutes,
        categoryCode: rec.categoryCode,
        severityCode: rec.severityCode,
        vehicleCount: rec.vehicleCount,
        pedestrianCount: rec.pedestrianCount,
        emergencyResponsePresent: rec.emergencyResponsePresent,
        weatherCondition: rec.weatherCondition,
        lightingCondition: rec.lightingCondition,
        roadSurface: rec.roadSurface,
        narrative: rec.narrative,
        verificationStatus: rec.verificationStatus,
        credibilityScore: rec.credibilityScore,
        witnessCount: rec.witnessCount,
        reporterUserId: citizenUser.id,
        isSynthetic: true,
        isFalseAlarm: rec.isFalseAlarm,
      }))
    )
    .returning();

  // Wire up parentCanonicalId for conflated_witness_child records
  for (let i = 0; i < simRecords.length; i++) {
    const parentIdx = simRecords[i].parentIndex;
    if (parentIdx !== null && insertedAccidents[parentIdx]) {
      await db
        .update(accidents)
        .set({ parentCanonicalId: insertedAccidents[parentIdx].id })
        .where(eq(accidents.id, insertedAccidents[i].id));
    }
  }

  // Insert sample steward verification & privacy-stripped attachment records
  const sampleVerified = insertedAccidents.slice(0, 6);
  if (sampleVerified.length > 0) {
    await db.insert(reportVerifications).values(
      sampleVerified.map((acc) => ({
        accidentId: acc.id,
        stewardUserId: stewardUser.id,
        previousStatus: "unverified_raw_vgi",
        newStatus: acc.verificationStatus,
        verificationNotes: `Topological map-matching verified on segment ID ${acc.snappedSegmentId} at offset m=${acc.linearOffsetM}m (P=${acc.snapProbabilityScore}).`,
        overriddenSegmentId: null,
        overriddenOffsetM: null,
      }))
    );

    await db.insert(reportAttachments).values(
      sampleVerified.slice(0, 4).map((acc, idx) => ({
        accidentId: acc.id,
        mediaType: "image/jpeg",
        fileName: `vgi_evidence_${acc.incidentCode.toLowerCase()}.jpg`,
        exifStripped: true,
        privacyVerified: true,
        fileSizeKb: 340 + idx * 55,
        metadataSummary:
          "EXIF GPS/Device serial stripped at ingestion boundary; license plates & faces blurred.",
      }))
    );
  }

  await db.insert(auditLogs).values({
    actorRole: "simulation_scientist",
    actorName: "Dr. Kenji Okabe",
    actionType: "SIMULATION_BENCHMARK_GENERATED",
    entityType: "dataset_sources",
    entityId: dataset.code,
    detailsJson: {
      scenarioType,
      seed,
      lixelSizeM,
      totalSegments: insertedSegments.length,
      totalLixels: insertedLixels.length,
      totalRealizedReports: insertedAccidents.length,
      elapsedMs: Date.now() - startTime,
    },
  });

  // Execute initial Spatial Analysis Lab pipeline and persist results
  await executeAndPersistSpatialLabJob(DEFAULT_LAB_PARAMS);
}

/**
 * Runs the complete Network Spatial Statistics & Empirical Bayes Risk Engine
 * over the active PostgreSQL spatial tables and stores the job + lixel results.
 */
export async function executeAndPersistSpatialLabJob(
  params: LabAnalysisParameters
) {
  const t0 = Date.now();

  const allNodes = await db.select().from(roadNodes);
  const allSegments = await db.select().from(roadSegments);
  const allLixels = await db.select().from(roadLixels);
  const allAccidents = await db.select().from(accidents);
  const allSeverities = await db.select().from(severityLevels);

  const nodeCodeById = new Map<number, string>();
  allNodes.forEach((n) => nodeCodeById.set(n.id, n.nodeCode));

  const epdoBySeverity = new Map<string, number>();
  allSeverities.forEach((s) => epdoBySeverity.set(s.code, s.epdoWeight));

  const segMap = new Map<
    number,
    (typeof allSegments)[number] & {
      fromNodeCode: string;
      toNodeCode: string;
    }
  >();

  const segsForSp = allSegments.map((s) => {
    const fromCode = nodeCodeById.get(s.fromNodeId) ?? "N01";
    const toCode = nodeCodeById.get(s.toNodeId) ?? "N02";
    const enriched = { ...s, fromNodeCode: fromCode, toNodeCode: toCode };
    segMap.set(s.id, enriched);
    return {
      segmentCode: s.segmentCode,
      fromNodeCode: fromCode,
      toNodeCode: toCode,
      lengthM: s.lengthM,
    };
  });

  const spMatrix = buildAllPairsShortestPaths(
    allNodes.map((n) => ({ nodeCode: n.nodeCode, degree: n.degree })),
    segsForSp
  );

  // Filter eligible incidents (exclude rejected & conflated duplicate child records to prevent double-counting!)
  const eligibleAccidents = allAccidents.filter((acc) => {
    if (
      acc.verificationStatus === "rejected" ||
      acc.verificationStatus === "conflated_witness_child" ||
      acc.verificationStatus === "flagged"
    ) {
      return false;
    }
    if (!params.includeUnverifiedVgi && acc.verificationStatus !== "verified_canonical") {
      return false;
    }
    return true;
  });

  const lixelNodesForStats: LixelNodeForStats[] = allLixels.map((lx) => {
    const seg = segMap.get(lx.segmentId)!;
    return {
      id: lx.id,
      lixelCode: lx.lixelCode,
      segmentId: lx.segmentId,
      segmentCode: seg.segmentCode,
      fromNodeCode: seg.fromNodeCode,
      toNodeCode: seg.toNodeCode,
      segmentLengthM: seg.lengthM,
      mStartM: lx.mStartM,
      mEndM: lx.mEndM,
      lengthM: lx.lengthM,
      centerXM: lx.centerXM,
      centerYM: lx.centerYM,
      centerLon: lx.centerLon,
      centerLat: lx.centerLat,
      trueIntensityLambda: lx.trueIntensityLambda,
    };
  });

  const incidentsForStats: IncidentPointForStats[] = eligibleAccidents.map(
    (acc) => {
      const seg = segMap.get(acc.snappedSegmentId)!;
      return {
        id: acc.id,
        incidentCode: acc.incidentCode,
        snappedSegmentId: acc.snappedSegmentId,
        segmentCode: seg.segmentCode,
        fromNodeCode: seg.fromNodeCode,
        toNodeCode: seg.toNodeCode,
        segmentLengthM: seg.lengthM,
        snappedLixelId: acc.snappedLixelId,
        linearOffsetM: acc.linearOffsetM,
        snappedXM: acc.snappedXM,
        snappedYM: acc.snappedYM,
        snappedLon: acc.snappedLon,
        snappedLat: acc.snappedLat,
        epdoWeight: epdoBySeverity.get(acc.severityCode) ?? 1.0,
        credibilityWeight:
          acc.verificationStatus === "verified_canonical"
            ? 1.0
            : acc.credibilityScore,
      };
    }
  );

  // 1. Run Network KDE vs. Planar 2D KDE
  const kdeOut = computeNkdeVsPlanar({
    lixels: lixelNodesForStats,
    incidents: incidentsForStats,
    spMatrix,
    bandwidthM: params.bandwidthM,
    kernel: params.kernel,
    useSeverityWeights: params.useSeverityWeights,
    equalSplitAttenuation: params.equalSplitAttenuation,
  });

  // 2. Run Network Getis-Ord Gi* & Global Network Moran's I
  const giOut = computeNetworkGetisOrdAndMoran({
    lixels: lixelNodesForStats,
    lixelValues: kdeOut.nkdeValues,
    spMatrix,
    neighborhoodCutoffM: params.giStarCutoffM,
    permutations: 199,
    useFdrCorrection: params.useFdrCorrection,
  });

  // 3. Run Network DBSCAN (N-DBSCAN)
  const dbscanOut = computeNetworkDbscan({
    incidents: incidentsForStats,
    lixels: lixelNodesForStats,
    spMatrix,
    epsNetworkM: params.dbscanEpsM,
    minPts: params.dbscanMinPts,
  });

  // 4. Run Segment & Lixel Empirical Bayes (EB) & Multi-Criteria Risk Engine
  const segInputs: SegmentRiskInput[] = allSegments.map((seg) => {
    const segAccs = allAccidents.filter(
      (a) =>
        a.snappedSegmentId === seg.id &&
        a.verificationStatus !== "rejected" &&
        a.verificationStatus !== "conflated_witness_child"
    );
    const verifiedCount = segAccs.filter(
      (a) => a.verificationStatus === "verified_canonical"
    ).length;
    const unverifiedCount = segAccs.filter(
      (a) => a.verificationStatus === "unverified_raw_vgi"
    ).length;
    const epdoSum = segAccs.reduce(
      (acc, a) => acc + (epdoBySeverity.get(a.severityCode) ?? 1.0),
      0
    );
    const wetOrNight = segAccs.filter(
      (a) => a.roadSurface !== "Dry" || a.lightingCondition !== "Daylight"
    ).length;

    return {
      segmentId: seg.id,
      segmentCode: seg.segmentCode,
      name: seg.name,
      roadClass: seg.roadClass,
      isOverpass: seg.isOverpass,
      lengthM: seg.lengthM,
      speedLimitKmh: seg.speedLimitKmh,
      laneCount: seg.laneCount,
      sinuosity: seg.sinuosity,
      aadt: seg.aadt,
      spfAlpha: seg.spfAlpha,
      spfBeta: seg.spfBeta,
      spfOverdispersionPhi: seg.spfOverdispersionPhi,
      observedVerifiedCount: verifiedCount,
      observedUnverifiedCount: unverifiedCount,
      epdoSum,
      wetOrNightCrashCount: wetOrNight,
    };
  });

  const segmentRiskPortfolio = evaluateSegmentRiskAndEbPortfolio(
    segInputs,
    params.weights
  );
  const segRiskById = new Map<number, (typeof segmentRiskPortfolio)[number]>();
  segmentRiskPortfolio.forEach((sr) => segRiskById.set(sr.segmentId, sr));

  // Evaluate Ground-Truth Benchmark for Empirical Bayes at Lixel Level
  const lixelEbRates = allLixels.map((lx, idx) => {
    const sr = segRiskById.get(lx.segmentId);
    const baseEb = sr ? sr.ebExpectedDensityPerKm : 1.0;
    return Number((0.55 * baseEb + 0.45 * kdeOut.nkdeValues[idx]).toFixed(4));
  });
  const lixelCrashCounts = allLixels.map(
    (lx) => incidentsForStats.filter((inc) => inc.snappedLixelId === lx.id).length
  );
  const ebBenchmark = evaluateBenchmarkMetrics(
    lixelEbRates,
    allLixels.map((l) => l.trueIntensityLambda),
    lixelCrashCounts,
    allLixels.map((l) => l.lengthM)
  );

  const executionTimeMs = Number((Date.now() - t0).toFixed(1));
  const jobCode = `JOB-${Date.now().toString().slice(-6)}`;

  const summaryMetrics = {
    nkdeBenchmark: kdeOut.nkdeBenchmark,
    planarBenchmark: kdeOut.planarBenchmark,
    ebBenchmark,
    maxDistortionLixelCode: kdeOut.maxDistortionLixelCode,
    meanPlanarOverestimationPct: kdeOut.meanPlanarOverestimationPct,
    assumptionsPassed: giOut.assumptionsPassed,
    assumptionMessage: giOut.assumptionMessage,
    globalMoranI: giOut.globalMoranI,
    globalMoranExpected: giOut.globalMoranExpected,
    globalMoranZ: giOut.globalMoranZ,
    globalMoranPValue: giOut.globalMoranPValue,
    significantHotspotCount: giOut.significantHotspotCount,
    significantColdspotCount: giOut.significantColdspotCount,
    dbscanClusterCount: dbscanOut.clusters.length,
    dbscanNoiseCount: dbscanOut.noiseIncidentCount,
    dbscanClusters: dbscanOut.clusters,
  };

  // Persist Job Metadata
  const [insertedJob] = await db
    .insert(spatialAnalysisJobs)
    .values({
      jobCode,
      jobType: "nkde_vs_planar",
      status: "completed",
      parametersJson: params,
      sridUsed: 32618,
      sampleSize: incidentsForStats.length,
      executionTimeMs,
      summaryMetricsJson: summaryMetrics,
    })
    .returning();

  // Replace previous lixel analysis results with latest run
  await db.delete(spatialAnalysisResults);
  await db.insert(spatialAnalysisResults).values(
    allLixels.map((lx, i) => {
      const sr = segRiskById.get(lx.segmentId);
      const lixelEpdo = incidentsForStats
        .filter((inc) => inc.snappedLixelId === lx.id)
        .reduce((acc, inc) => acc + inc.epdoWeight, 0);

      return {
        jobId: insertedJob.id,
        lixelId: lx.id,
        segmentId: lx.segmentId,
        nkdeValue: kdeOut.nkdeValues[i],
        planarKdeValue: kdeOut.planarKdeValues[i],
        kdeDiffValue: kdeOut.kdeDiffValues[i],
        giStarZ: giOut.giStarZ[i],
        giStarPValue: giOut.giStarPValues[i],
        giStarFdrPValue: giOut.giStarFdrPValues[i],
        giStarClusterType: giOut.giStarClusterTypes[i],
        dbscanClusterId: dbscanOut.lixelClusterIds[i],
        ebExpectedRate: lixelEbRates[i],
        psiExcessRate: sr ? sr.psiExcessCrashFrequency : 0,
        epdoScore: Number(lixelEpdo.toFixed(2)),
        vulnerabilityScore: sr ? sr.compositeVulnerabilityScore : 25,
        epistemicUncertainty: sr ? sr.uncertaintyScore : 0.25,
        trueLambdaBenchmark: lx.trueIntensityLambda,
      };
    })
  );

  return {
    job: insertedJob,
    summaryMetrics,
    segmentRiskPortfolio,
  };
}

/**
 * Loads the complete synchronized platform state for the Coordinated Multiple Views (CMV) client.
 */
export async function getPlatformState(customWeights?: MultiCriteriaWeights) {
  await ensurePlatformSeeded();

  const [
    activeDatasetList,
    allNodes,
    allSegments,
    allLixels,
    allAccidents,
    allCategories,
    allSeverities,
    latestJobs,
    allResults,
    recentLogs,
    allVerifications,
    allAttachments,
  ] = await Promise.all([
    db.select().from(datasetSources).orderBy(desc(datasetSources.id)).limit(1),
    db.select().from(roadNodes),
    db.select().from(roadSegments),
    db.select().from(roadLixels),
    db.select().from(accidents).orderBy(desc(accidents.incidentTimestampUtc)),
    db.select().from(accidentCategories),
    db.select().from(severityLevels).orderBy(desc(severityLevels.rank)),
    db
      .select()
      .from(spatialAnalysisJobs)
      .orderBy(desc(spatialAnalysisJobs.id))
      .limit(6),
    db.select().from(spatialAnalysisResults),
    db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25),
    db
      .select()
      .from(reportVerifications)
      .orderBy(desc(reportVerifications.createdAt))
      .limit(20),
    db.select().from(reportAttachments),
  ]);

  const activeDataset = activeDatasetList[0] ?? null;
  const latestJob = latestJobs[0] ?? null;

  const epdoBySeverity = new Map<string, number>();
  allSeverities.forEach((s) => epdoBySeverity.set(s.code, s.epdoWeight));

  const resultsByLixelId = new Map<
    number,
    (typeof allResults)[number]
  >();
  allResults.forEach((r) => resultsByLixelId.set(r.lixelId, r));

  const weightsToUse =
    customWeights ??
    (latestJob?.parametersJson as LabAnalysisParameters | undefined)?.weights ??
    DEFAULT_LAB_PARAMS.weights;

  const segInputs: SegmentRiskInput[] = allSegments.map((seg) => {
    const segAccs = allAccidents.filter(
      (a) =>
        a.snappedSegmentId === seg.id &&
        a.verificationStatus !== "rejected" &&
        a.verificationStatus !== "conflated_witness_child"
    );
    const verifiedCount = segAccs.filter(
      (a) => a.verificationStatus === "verified_canonical"
    ).length;
    const unverifiedCount = segAccs.filter(
      (a) => a.verificationStatus === "unverified_raw_vgi"
    ).length;
    const epdoSum = segAccs.reduce(
      (acc, a) => acc + (epdoBySeverity.get(a.severityCode) ?? 1.0),
      0
    );
    const wetOrNight = segAccs.filter(
      (a) => a.roadSurface !== "Dry" || a.lightingCondition !== "Daylight"
    ).length;

    return {
      segmentId: seg.id,
      segmentCode: seg.segmentCode,
      name: seg.name,
      roadClass: seg.roadClass,
      isOverpass: seg.isOverpass,
      lengthM: seg.lengthM,
      speedLimitKmh: seg.speedLimitKmh,
      laneCount: seg.laneCount,
      sinuosity: seg.sinuosity,
      aadt: seg.aadt,
      spfAlpha: seg.spfAlpha,
      spfBeta: seg.spfBeta,
      spfOverdispersionPhi: seg.spfOverdispersionPhi,
      observedVerifiedCount: verifiedCount,
      observedUnverifiedCount: unverifiedCount,
      epdoSum,
      wetOrNightCrashCount: wetOrNight,
    };
  });

  const segmentRiskPortfolio = evaluateSegmentRiskAndEbPortfolio(
    segInputs,
    weightsToUse
  );
  const segRiskById = new Map<number, (typeof segmentRiskPortfolio)[number]>();
  segmentRiskPortfolio.forEach((sr) => segRiskById.set(sr.segmentId, sr));

  const enrichedLixels = allLixels.map((lx) => {
    const res = resultsByLixelId.get(lx.id);
    const sr = segRiskById.get(lx.segmentId);
    return {
      ...lx,
      nkdeValue: res?.nkdeValue ?? 0,
      planarKdeValue: res?.planarKdeValue ?? 0,
      kdeDiffValue: res?.kdeDiffValue ?? 0,
      giStarZ: res?.giStarZ ?? 0,
      giStarPValue: res?.giStarPValue ?? 1,
      giStarFdrPValue: res?.giStarFdrPValue ?? 1,
      giStarClusterType: res?.giStarClusterType ?? "Not Significant",
      dbscanClusterId: res?.dbscanClusterId ?? -1,
      ebExpectedRate: res?.ebExpectedRate ?? 0,
      psiExcessRate: res?.psiExcessRate ?? 0,
      epdoScore: res?.epdoScore ?? 0,
      vulnerabilityScore: sr?.compositeVulnerabilityScore ?? 0,
      epistemicUncertainty: sr?.uncertaintyScore ?? 0.2,
      bivariateClass: sr?.bivariateClass ?? "L-L",
      bivariateColorHex: sr?.bivariateColorHex ?? "#1e3a5f",
    };
  });

  // Compute Macro VGI Quality Assurance Diagnostics (US-3.3)
  const snapDistances = allAccidents.map((a) => a.snapDistanceM);
  const reportingLags = allAccidents.map((a) => a.reportingLagMinutes);
  const meanPositionalDriftM =
    snapDistances.length > 0
      ? Number(
          (
            snapDistances.reduce((a, b) => a + b, 0) / snapDistances.length
          ).toFixed(2)
        )
      : 0;
  const meanReportingLagMin =
    reportingLags.length > 0
      ? Number(
          (
            reportingLags.reduce((a, b) => a + b, 0) / reportingLags.length
          ).toFixed(1)
        )
      : 0;

  const statusCounts = {
    verified_canonical: allAccidents.filter(
      (a) => a.verificationStatus === "verified_canonical"
    ).length,
    unverified_raw_vgi: allAccidents.filter(
      (a) => a.verificationStatus === "unverified_raw_vgi"
    ).length,
    conflated_witness_child: allAccidents.filter(
      (a) => a.verificationStatus === "conflated_witness_child"
    ).length,
    flagged: allAccidents.filter((a) => a.verificationStatus === "flagged")
      .length,
    rejected: allAccidents.filter((a) => a.verificationStatus === "rejected")
      .length,
    syntheticCount: allAccidents.filter((a) => a.isSynthetic).length,
    empiricalVgiCount: allAccidents.filter((a) => !a.isSynthetic).length,
  };

  return {
    activeDataset,
    nodes: allNodes,
    segments: allSegments,
    lixels: enrichedLixels,
    accidents: allAccidents,
    categories: allCategories,
    severityLevels: allSeverities,
    segmentRiskPortfolio,
    latestJob,
    jobHistory: latestJobs,
    vgiDiagnostics: {
      meanPositionalDriftM,
      meanReportingLagMin,
      statusCounts,
      recentVerifications: allVerifications,
      attachmentsCount: allAttachments.length,
    },
    auditLogs: recentLogs,
  };
}

/**
 * US-2.1 & US-2.3 Real-Time Map-Matching + Spatiotemporal Network Conflation Preview
 */
export async function previewCitizenPinAndConflation(input: {
  lon?: number;
  lat?: number;
  xM?: number;
  yM?: number;
  observationalRadiusM: number;
  incidentTimestampUtc?: string;
  categoryCode?: string;
  severityCode?: string;
  preferGradeSeparatedOverpass?: boolean;
}) {
  await ensurePlatformSeeded();

  let rawXM: number;
  let rawYM: number;
  let rawLon: number;
  let rawLat: number;

  if (typeof input.xM === "number" && typeof input.yM === "number") {
    rawXM = input.xM;
    rawYM = input.yM;
    [rawLon, rawLat] = metricToGeo(rawXM, rawYM);
  } else if (typeof input.lon === "number" && typeof input.lat === "number") {
    rawLon = input.lon;
    rawLat = input.lat;
    [rawXM, rawYM] = geoToMetric(rawLon, rawLat);
  } else {
    throw new Error("Either metric (xM, yM) or geographic (lon, lat) coordinates are required.");
  }

  const allNodes = await db.select().from(roadNodes);
  const allSegments = await db.select().from(roadSegments);
  const allLixels = await db.select().from(roadLixels);
  const allAccidents = await db.select().from(accidents);

  const nodeCodeById = new Map<number, string>();
  allNodes.forEach((n) => nodeCodeById.set(n.id, n.nodeCode));

  const segmentsForMatching: SegmentForMatching[] = allSegments.map((s) => ({
    id: s.id,
    segmentCode: s.segmentCode,
    name: s.name,
    roadClass: s.roadClass,
    fromNodeCode: nodeCodeById.get(s.fromNodeId) ?? "N01",
    toNodeCode: nodeCodeById.get(s.toNodeId) ?? "N02",
    isOverpass: s.isOverpass,
    lengthM: s.lengthM,
    speedLimitKmh: s.speedLimitKmh,
    coordsMetric: s.coordsMetricJson,
  }));

  const segById = new Map<number, SegmentForMatching>();
  segmentsForMatching.forEach((s) => segById.set(s.id, s));

  const lixelsBySegmentId = new Map<number, LixelForMatching[]>();
  allLixels.forEach((lx) => {
    const seg = segById.get(lx.segmentId);
    if (!seg) return;
    const arr = lixelsBySegmentId.get(lx.segmentId) ?? [];
    arr.push({
      id: lx.id,
      lixelCode: lx.lixelCode,
      segmentId: lx.segmentId,
      segmentCode: seg.segmentCode,
      mStartM: lx.mStartM,
      mEndM: lx.mEndM,
    });
    lixelsBySegmentId.set(lx.segmentId, arr);
  });

  const match = computeProbabilisticMapMatch(
    rawXM,
    rawYM,
    input.observationalRadiusM,
    segmentsForMatching,
    lixelsBySegmentId,
    {
      categoryCode: input.categoryCode,
      severityCode: input.severityCode,
      preferGradeSeparatedOverpass: input.preferGradeSeparatedOverpass,
    }
  );

  const spMatrix = buildAllPairsShortestPaths(
    allNodes.map((n) => ({ nodeCode: n.nodeCode, degree: n.degree })),
    segmentsForMatching.map((s) => ({
      segmentCode: s.segmentCode,
      fromNodeCode: s.fromNodeCode,
      toNodeCode: s.toNodeCode,
      lengthM: s.lengthM,
    }))
  );

  const bestSeg = segById.get(match.bestCandidate.segmentId)!;
  const targetTime = input.incidentTimestampUtc
    ? new Date(input.incidentTimestampUtc)
    : new Date(Date.UTC(2025, 2, 10, 8, 30, 0));

  const activeIncidents: ActiveIncidentForConflation[] = allAccidents.map(
    (a) => {
      const s = segById.get(a.snappedSegmentId) ?? segmentsForMatching[0];
      return {
        id: a.id,
        incidentCode: a.incidentCode,
        snappedSegmentId: a.snappedSegmentId,
        segmentCode: s.segmentCode,
        fromNodeCode: s.fromNodeCode,
        toNodeCode: s.toNodeCode,
        segmentLengthM: s.lengthM,
        linearOffsetM: a.linearOffsetM,
        snappedXM: a.snappedXM,
        snappedYM: a.snappedYM,
        incidentTimestampUtc: a.incidentTimestampUtc,
        categoryCode: a.categoryCode,
        severityCode: a.severityCode,
        verificationStatus: a.verificationStatus,
        credibilityScore: a.credibilityScore,
        witnessCount: a.witnessCount,
        narrative: a.narrative,
      };
    }
  );

  const conflationCandidates = findSpatiotemporalNetworkConflationCandidates(
    {
      segmentCode: bestSeg.segmentCode,
      fromNodeCode: bestSeg.fromNodeCode,
      toNodeCode: bestSeg.toNodeCode,
      lengthM: bestSeg.lengthM,
    },
    match.bestCandidate.linearOffsetM,
    match.bestCandidate.snappedXM,
    match.bestCandidate.snappedYM,
    targetTime,
    input.categoryCode ?? "rear_end_collision",
    input.severityCode ?? "minor_injury",
    activeIncidents,
    spMatrix,
    240, // 240m network distance neighborhood
    180 // 180 min temporal neighborhood
  );

  return {
    rawCoordinate: {
      xM: rawXM,
      yM: rawYM,
      lon: rawLon,
      lat: rawLat,
      withinStudyBounds: isWithinMetricBounds(rawXM, rawYM),
    },
    bestCandidate: match.bestCandidate,
    snapCandidates: match.candidates,
    conflationCandidates,
  };
}
