/**
 * Phase 1 — Stochastic network ground-truth simulation.
 *
 * Pipeline: generate topology → lixelise (LRS) → evaluate Λ(s) → realise an
 * inhomogeneous network point process → derive severity/taxonomy/environment →
 * inject VGI observation noise (positional drift, reporting lag, false alarms,
 * multi-witness bursts, attribute misclassification) → probabilistic
 * map-matching → spatiotemporal conflation into canonical candidate incidents.
 */
import { db } from "@/db";
import { eq } from "drizzle-orm";
import {
  accidents,
  auditLogs,
  datasetSources,
  environmentalObservations,
  roadLixels,
  roadNodes,
  roadSegments,
  trafficObservations,
  vgiReports,
  type DatasetSource,
} from "@/db/schema";
import { gridKey, toUtm, type ProjectedCrs } from "@/lib/geo/projection";
import { RoadGraph, lixelizeSegment, pointAtM, type GraphLixel } from "@/lib/geo/graph";
import { DEFAULT_NETWORK_PARAMS, generateNetwork, type NetworkGenParams } from "@/lib/sim/network";
import {
  hourlyProfile,
  lambdaLixel,
  scenarioParams,
  seasonalFactor,
  weeklyFactor,
  type Scenario,
  type SimParams,
} from "@/lib/sim/intensity";
import { CATEGORIES, LIGHTING_CODES, SEVERITIES, WEATHER_CODES, severityByCode } from "@/lib/domain/taxonomy";
import { Rng } from "@/lib/util/rng";
import { DEFAULT_CONFLATION, conflateReports, scoreSnapCandidates, type ConflationReport } from "@/lib/vgi/mapmatch";

export interface SimulateInput {
  name: string;
  slug: string;
  scenario: Scenario;
  seed: number;
  lixelLengthM: number;
  network?: Partial<NetworkGenParams>;
  severityIds: Record<string, string>;
  categoryIds: Record<string, string>;
  contributorIds: string[];
  studyDays?: number;
  windowStartIso?: string;
  actorId?: string;
}

const GENERATOR_VERSION = "1.0.0";

async function insertChunked<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0] extends never ? never : any,
  rows: T[],
  chunk = 400,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    await db.insert(table).values(rows.slice(i, i + chunk) as any);
  }
}

export async function simulateDataset(input: SimulateInput): Promise<DatasetSource> {
  const started = Date.now();
  const netParams: NetworkGenParams = { ...DEFAULT_NETWORK_PARAMS, ...input.network, seed: input.seed };
  const network = generateNetwork(netParams);
  const crs: ProjectedCrs = network.crs;
  const studyDays = input.studyDays ?? 365;
  const windowStartIso = input.windowStartIso ?? new Date(Date.now() - studyDays * 86400000).toISOString();
  const windowStart = new Date(windowStartIso);

  /* ---------------- dataset row (provisional) ---------------- */
  const provisional = await db
    .insert(datasetSources)
    .values({
      name: input.name,
      slug: input.slug,
      kind: "synthetic",
      scenario: input.scenario,
      seed: input.seed,
      srid: crs.srid,
      crsAuthority: crs.authority,
      crsName: crs.name,
      utmZone: crs.zone,
      hemisphere: crs.hemisphere,
      originLon: netParams.originLon,
      originLat: netParams.originLat,
      lixelLengthM: input.lixelLengthM,
      extentXMin: network.extent.minX,
      extentXMax: network.extent.maxX,
      extentYMin: network.extent.minY,
      extentYMax: network.extent.maxY,
      groundTruthAvailable: true,
      generatorVersion: GENERATOR_VERSION,
      simParams: { network: netParams, scenario: input.scenario },
    })
    .returning();
  const datasetId = provisional[0].id;

  /* ---------------- nodes & segments ---------------- */
  const nodeRowMap = new Map<string, string>();
  const nodeRows = network.nodes.map((n, i) => {
    const id = `${datasetId.slice(0, 8)}-n${i}`;
    nodeRowMap.set(n.id, id);
    return {
      id,
      datasetId,
      srid: crs.srid,
      x: n.x,
      y: n.y,
      gridKey: gridKey(n.x, n.y),
      degree: n.degree,
      nodeType: n.nodeType as any,
      control: n.control as any,
      isGradeSeparated: n.isGradeSeparated,
      elevationM: 0,
    };
  });
  await insertChunked(roadNodes, nodeRows);

  const segmentRowMap = new Map<string, string>();
  const segmentRows = network.segments.map((s, i) => {
    const id = `${datasetId.slice(0, 8)}-e${i}`;
    segmentRowMap.set(s.id, id);
    return {
      id,
      datasetId,
      srid: crs.srid,
      fromNodeId: nodeRowMap.get(s.fromNodeId) ?? "",
      toNodeId: nodeRowMap.get(s.toNodeId) ?? "",
      x1: s.x1,
      y1: s.y1,
      x2: s.x2,
      y2: s.y2,
      gridKey: gridKey(s.x1, s.y1),
      shape: s.shape,
      lengthM: s.lengthM,
      curvilinearLengthM: s.lengthM * s.sinuosity,
      sinuosity: s.sinuosity,
      roadClass: s.roadClass as any,
      classOrdinal: s.classOrdinal,
      name: s.name,
      directional: s.roadClass === "motorway",
      lanes: s.lanes,
      speedLimitKph: s.speedLimitKph,
      aadt: s.aadt,
      aadtSource: (s.aadt === null ? "missing" : "modelled") as any,
      curvaturePerKm: s.curvaturePerKm,
      lighting: s.lighting as any,
      surface: s.surface as any,
      isBridge: s.isBridge,
      sidewalk: s.sidewalk,
      cycleLane: s.cycleLane,
      vktPerDay: s.vktPerDay,
    };
  });
  await insertChunked(roadSegments, segmentRows);

  /* ---------------- lixelisation (LRS) ---------------- */
  const graphSegments = network.segments.map((s) => ({
    ...s,
    id: segmentRowMap.get(s.id) as string,
    fromNodeId: nodeRowMap.get(s.fromNodeId) as string,
    toNodeId: nodeRowMap.get(s.toNodeId) as string,
    lengthM: s.lengthM * s.sinuosity,
  }));
  const graphNodes = network.nodes.map((n) => ({ ...n, id: nodeRowMap.get(n.id) as string }));

  const lixels: GraphLixel[] = [];
  graphSegments.forEach((seg, segIdx) => {
    const parts = lixelizeSegment(seg, segIdx, input.lixelLengthM, "L");
    for (let k = 0; k < parts.length; k++) {
      parts[k].id = `${datasetId.slice(0, 8)}-x${lixels.length}`;
      lixels.push(parts[k]);
    }
  });

  /* ---------------- ground-truth intensity Λ(s) ---------------- */
  const simP: SimParams = scenarioParams(
    input.scenario,
    input.seed,
    input.lixelLengthM,
    network.extent,
    windowStartIso,
  );
  simP.studyDays = studyDays;
  const rng = new Rng(`process:${input.seed}:${input.scenario}`);
  const wetMultiplier = 1 + simP.wetShare * 0.4;
  let expectedTotal = 0;
  for (const l of lixels) {
    l.trueLambda = lambdaLixel(l, simP, wetMultiplier);
    expectedTotal += l.trueLambda;
  }

  const lixelRows = lixels.map((l) => ({
    id: l.id,
    datasetId,
    srid: crs.srid,
    segmentId: l.segmentId,
    lrsIndex: l.lrsIndex,
    mStart: l.mStart,
    mEnd: l.mEnd,
    mMid: l.mMid,
    lengthM: l.lengthM,
    x: l.x,
    y: l.y,
    gridKey: gridKey(l.x, l.y),
    distToNodeM: l.distToNodeM,
    roadClass: l.roadClass,
    classOrdinal: l.classOrdinal,
    speedLimitKph: l.speedLimitKph,
    lanes: l.lanes,
    aadt: l.aadt,
    trueLambda: l.trueLambda,
  }));
  await insertChunked(roadLixels, lixelRows);

  const graph = new RoadGraph(graphNodes, graphSegments, lixels);

  /* ---------------- temporal inverse-CDF tables ---------------- */
  const dayWeights: number[] = [];
  const dayCdf: number[] = [];
  let daySum = 0;
  for (let d = 0; d < studyDays; d++) {
    const date = new Date(windowStart.getTime() + d * 86400000);
    const startYear = Date.UTC(date.getUTCFullYear(), 0, 0);
    const doy = Math.floor((date.getTime() - startYear) / 86400000);
    const w = seasonalFactor(doy, simP) * weeklyFactor(date.getUTCDay(), simP);
    dayWeights.push(w);
    daySum += w;
    dayCdf.push(daySum);
  }
  const hourProf = hourlyProfile(simP, 3);
  const hourCdf: number[] = [];
  let hourSum = 0;
  for (const v of hourProf) {
    hourSum += v;
    hourCdf.push(hourSum);
  }

  const sampleDay = (): number => {
    const u = rng.next() * daySum;
    let lo = 0;
    let hi = dayCdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dayCdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const sampleHourSlot = (): number => {
    const u = rng.next() * hourSum;
    let lo = 0;
    let hi = hourCdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hourCdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  /* ---------------- realise the point process ---------------- */
  interface TrueEvent {
    lixelIndex: number;
    x: number;
    y: number;
    m: number;
    segmentId: string;
    occurredAt: Date;
    categoryCode: string;
    severityCode: string;
    weatherCode: string;
    lightingCode: string;
    trafficState: string;
    surfaceState: string;
    vehicles: number;
    pedestrians: number;
    cyclists: number;
    injured: number;
    fatalities: number;
    emergency: boolean;
  }
  const events: TrueEvent[] = [];

  for (let li = 0; li < lixels.length; li++) {
    const l = lixels[li];
    const lambda = l.trueLambda ?? 0;
    const k = rng.poisson(lambda);
    const seg = graph.segmentById.get(l.segmentId)!;
    for (let c = 0; c < k; c++) {
      const m = rng.range(l.mStart, l.mEnd);
      const pos = pointAtM(seg.shape, m);
      const day = sampleDay();
      const slot = sampleHourSlot();
      const dow = Math.floor(slot / 24);
      const hour = slot % 24;
      // align the sampled weekday with the sampled calendar day
      const dayDate = new Date(windowStart.getTime() + day * 86400000);
      const shift = (dayDate.getUTCDay() - dow + 7) % 7;
      const occurred = new Date(windowStart.getTime() + (day - shift) * 86400000 + hour * 3600000 + rng.int(0, 59) * 60000);

      const month = occurred.getUTCMonth();
      const winter = month === 11 || month === 0 || month === 1;
      const weatherPool = WEATHER_CODES.filter((w) => (winter ? true : w.code !== "snow" && w.code !== "ice"));
      const weather = rng.weighted(weatherPool, weatherPool.map((w) => w.share * (winter && (w.code === "snow" || w.code === "ice") ? 6 : 1)));

      const isDark = hour < 6.5 || hour > 19.5 || (winter && (hour < 8 || hour > 17));
      const isTwilight = !isDark && (hour < 8.5 || hour > 17.5);
      let lightingCode = "daylight";
      if (isDark) lightingCode = seg.lighting === "lit" ? "night_lit" : "night_unlit";
      else if (isTwilight) lightingCode = "dusk";

      // Taxonomy: intersection proximity reweights crossing/pedestrian conflicts.
      const nearNode = l.distToNodeM < 35;
      const catWeights = CATEGORIES.map((cat) => (nearNode ? cat.intersectionAffinity + 0.15 : 1.15 - cat.intersectionAffinity));
      const category = rng.weighted(CATEGORIES, catWeights);

      const mix = category.severityMix.slice();
      const speedBoost = Math.max(0, (seg.speedLimitKph - 40) / 60);
      const darkBoost = lightingCode === "night_unlit" ? 1.9 : lightingCode === "night_lit" ? 1.2 : 1;
      const wetBoost = weather.risk;
      mix[0] *= 1 + speedBoost * 0.9 * darkBoost * wetBoost * 0.35;
      mix[1] *= 1 + speedBoost * 0.6 * darkBoost * 0.5;
      const sevIndex = rng.weighted([0, 1, 2, 3, 4], mix);
      const severityCode = SEVERITIES[sevIndex].code;
      const sev = severityByCode(severityCode);

      const pedestrians = category.code === "pedestrian_struck" ? 1 : rng.next() < 0.03 ? 1 : 0;
      const cyclists = category.code === "cyclist_struck" ? 1 : rng.next() < 0.04 ? 1 : 0;
      const vehicles = category.code === "single_vehicle" || category.code === "fixed_object" || category.code === "rollover" ? 1 : rng.int(2, 3);
      const injured =
        severityCode === "fatal"
          ? rng.int(1, 3)
          : severityCode === "serious_injury"
            ? rng.int(1, 2)
            : severityCode === "minor_injury"
              ? rng.int(1, 2)
              : pedestrians + cyclists > 0 && rng.next() < 0.25
                ? 1
                : 0;
      const fatalities = severityCode === "fatal" ? (rng.next() < 0.82 ? 1 : rng.int(1, 2)) : 0;

      const hourFrac = hour;
      const trafficState =
        hourFrac >= 7 && hourFrac <= 9
          ? rng.next() < 0.55
            ? "congested"
            : "queue"
          : hourFrac >= 16 && hourFrac <= 19
            ? rng.next() < 0.5
              ? "congested"
              : "dense"
            : hourFrac >= 22 || hourFrac <= 5
              ? "free_flow"
              : rng.next() < 0.7
                ? "free_flow"
                : "dense";

      events.push({
        lixelIndex: li,
        x: pos.x,
        y: pos.y,
        m,
        segmentId: l.segmentId,
        occurredAt: occurred,
        categoryCode: category.code,
        severityCode,
        weatherCode: weather.code,
        lightingCode,
        trafficState,
        surfaceState:
          weather.code === "snow" ? "snow" : weather.code === "ice" ? "ice" : weather.code.startsWith("rain") ? "wet" : "dry",
        vehicles,
        pedestrians,
        cyclists,
        injured,
        fatalities,
        emergency: sev.rank >= 3 || fatalities > 0 || injured > 0,
      });
    }
  }

  /* ---------------- persist ground-truth realisations ---------------- */
  const truthRows = events.map((e, i) => {
    const l = lixels[e.lixelIndex];
    return {
      id: `${datasetId.slice(0, 8)}-gt${i}`,
      datasetId,
      srid: crs.srid,
      isGroundTruth: true,
      isSynthetic: true,
      trueSegmentId: e.segmentId,
      trueLixelId: l.id,
      trueM: e.m,
      trueX: e.x,
      trueY: e.y,
      segmentId: e.segmentId,
      lixelId: l.id,
      mOffset: e.m,
      x: e.x,
      y: e.y,
      gridKey: gridKey(e.x, e.y),
      occurredAt: e.occurredAt,
      reportedAt: e.occurredAt,
      categoryId: input.categoryIds[e.categoryCode] ?? null,
      severityId: input.severityIds[e.severityCode],
      weatherCode: e.weatherCode,
      lightingCode: e.lightingCode,
      trafficState: e.trafficState as any,
      roadSurfaceState: e.surfaceState as any,
      vehicleCount: e.vehicles,
      pedestrianCount: e.pedestrians,
      cyclistCount: e.cyclists,
      injuredCount: e.injured,
      fatalityCount: e.fatalities,
      emergencyResponse: e.emergency,
      witnessCount: 0,
      status: "verified" as const,
      narrative: `[SYNTHETIC GROUND TRUTH] Realisation of λ(s,t); scenario=${input.scenario}; seed=${input.seed}. Not derived from any observation.`,
    };
  });
  await insertChunked(accidents, truthRows);

  /* ---------------- VGI observation model ---------------- */
  interface RawReport {
    eventId: string | null;
    x: number;
    y: number;
    occurredAt: Date;
    reportedAt: Date;
    severityCode: string;
    categoryCode: string | null;
    weatherCode: string;
    lightingCode: string;
    trafficState: string;
    vehicles: number;
    pedestrians: number;
    injured: number;
    fatalities: number;
    emergency: boolean;
    driftM: number;
    accuracyM: number;
    isFalseAlarm: boolean;
    isWitness: boolean;
    contributorId: string;
    deviceType: "mobile_app" | "web_form" | "in_vehicle";
    narrative: string;
  }
  const rawReports: RawReport[] = [];
  const NARRATIVES = [
    "Two cars blocked the junction, one has a smashed front end.",
    "Cyclist on the ground, ambulance requested.",
    "Shunt at the crossing, traffic queuing back 200 m.",
    "Vehicle spun and hit the barrier. Road is wet.",
    "Pedestrian involved, drivers stopped to help.",
    "Minor bumper contact, parties exchanging details.",
    "Van rolled onto its side, diesel on the carriageway.",
    "Impact at the slip road, one lane closed.",
  ];

  events.forEach((e, i) => {
    const cat = CATEGORIES.find((c) => c.code === e.categoryCode)!;
    const sev = severityByCode(e.severityCode);
    const severityBoost = [0.34, 0.62, 0.78, 0.95, 1][4 - sev.rank + 0] ?? 0.7;
    const pReport = Math.min(0.99, simP.reportingProbabilityBase * cat.reportingPropensity * (0.55 + severityBoost));
    if (rng.next() > pReport) return;

    const witnessExtra = rng.poisson(simP.duplicateBurstMean * (sev.rank >= 3 ? 2.1 : 0.6));
    const total = 1 + witnessExtra;
    for (let w = 0; w < total; w++) {
      const sigma = simP.positionalDriftSigmaM * simP.driftSigmaScale * (0.6 + rng.next() * 1.3);
      const dx = rng.normal(0, sigma);
      const dy = rng.normal(0, sigma);
      const drift = Math.hypot(dx, dy);
      const lagSeconds = Math.max(35, Math.round(Math.exp(rng.normal(Math.log(simP.lagMedianSeconds), 1.05)) + w * rng.range(40, 420)));
      const misSev = rng.next() < simP.severityMisclassificationRate;
      const sevIdx = SEVERITIES.findIndex((s) => s.code === e.severityCode);
      const reportedSevIdx = misSev
        ? Math.min(SEVERITIES.length - 1, Math.max(0, sevIdx + (rng.next() < 0.62 ? 1 : -1)))
        : sevIdx;
      const reportedCat = rng.next() < simP.attributeNoiseRate ? rng.pick(CATEGORIES).code : e.categoryCode;
      rawReports.push({
        eventId: `${datasetId.slice(0, 8)}-gt${i}`,
        x: e.x + dx,
        y: e.y + dy,
        occurredAt: e.occurredAt,
        reportedAt: new Date(e.occurredAt.getTime() + lagSeconds * 1000),
        severityCode: SEVERITIES[reportedSevIdx].code,
        categoryCode: reportedCat,
        weatherCode: e.weatherCode,
        lightingCode: rng.next() < 0.06 ? rng.pick(LIGHTING_CODES).code : e.lightingCode,
        trafficState: e.trafficState,
        vehicles: Math.max(1, e.vehicles + (rng.next() < simP.attributeNoiseRate ? rng.int(-1, 1) : 0)),
        pedestrians: e.pedestrians,
        injured: Math.max(0, e.injured + (rng.next() < 0.08 ? rng.int(-1, 1) : 0)),
        fatalities: e.fatalities,
        emergency: e.emergency || rng.next() < 0.05,
        driftM: drift,
        accuracyM: Math.max(3, Math.round(sigma * (0.7 + rng.next() * 1.4))),
        isFalseAlarm: false,
        isWitness: w > 0,
        contributorId: rng.pick(input.contributorIds),
        deviceType: rng.weighted(["mobile_app", "web_form", "in_vehicle"] as const, [0.74, 0.2, 0.06]),
        narrative: rng.pick(NARRATIVES),
      });
    }
  });

  // Unverified false alarms (spurious VGI with no underlying realisation).
  const falseAlarmCount = Math.round(rawReports.length * simP.falseAlarmRate);
  for (let f = 0; f < falseAlarmCount; f++) {
    const li = rng.int(0, lixels.length - 1);
    const l = lixels[li];
    const seg = graph.segmentById.get(l.segmentId)!;
    const m = rng.range(l.mStart, l.mEnd);
    const pos = pointAtM(seg.shape, m);
    const sigma = simP.positionalDriftSigmaM * (1.4 + rng.next() * 2.2);
    const slot = sampleHourSlot();
    const day = sampleDay();
    const occurred = new Date(windowStart.getTime() + day * 86400000 + (slot % 24) * 3600000 + rng.int(0, 59) * 60000);
    rawReports.push({
      eventId: null,
      x: pos.x + rng.normal(0, sigma),
      y: pos.y + rng.normal(0, sigma),
      occurredAt: occurred,
      reportedAt: new Date(occurred.getTime() + rng.int(60, 7200) * 1000),
      severityCode: rng.weighted(SEVERITIES.map((s) => s.code), [0.05, 0.1, 0.25, 0.5, 0.1]),
      categoryCode: rng.next() < 0.3 ? null : rng.pick(CATEGORIES).code,
      weatherCode: rng.pick(WEATHER_CODES).code,
      lightingCode: rng.pick(LIGHTING_CODES).code,
      trafficState: rng.pick(["free_flow", "dense", "congested", "queue", "unknown"] as const),
      vehicles: rng.int(1, 2),
      pedestrians: 0,
      injured: 0,
      fatalities: 0,
      emergency: false,
      driftM: sigma * 1.2,
      accuracyM: Math.round(sigma),
      isFalseAlarm: true,
      isWitness: false,
      contributorId: rng.pick(input.contributorIds),
      deviceType: rng.weighted(["mobile_app", "web_form"] as const, [0.8, 0.2]),
      narrative: rng.pick(["Not sure what happened, saw lights.", "Something happened here earlier.", "Cars stopped, no damage visible.", "Reported by mistake — hazard, not a crash."]),
    });
  }

  /* ---------------- probabilistic map-matching ---------------- */
  const matched: Array<RawReport & { snap: ReturnType<typeof scoreSnapCandidates> }> = [];
  for (const r of rawReports) {
    const sigma = Math.max(6, r.accuracyM * 0.9);
    const snap = scoreSnapCandidates(graph, r.x, r.y, r.categoryCode, { sigmaM: sigma });
    matched.push({ ...r, snap });
  }

  const conflationInput: ConflationReport[] = matched.map((r, i) => ({
    id: `R${i}`,
    x: r.x,
    y: r.y,
    lixelIndex: r.snap.chosen?.lixelIndex ?? -1,
    segmentId: r.snap.chosen?.segmentId ?? null,
    occurredAt: r.occurredAt.getTime(),
    severityCode: r.severityCode,
    categoryCode: r.categoryCode,
    credibilityScore: null,
    status: "unverified",
  }));
  const clusters = conflateReports(graph, conflationInput, DEFAULT_CONFLATION);
  const clusterByReport = new Map<string, (typeof clusters)[number]>();
  for (const cl of clusters) for (const m of cl.memberIds) clusterByReport.set(m, cl);

  /* ---------------- persist reports ---------------- */
  const reportRowIds: string[] = matched.map((_, i) => `${datasetId.slice(0, 8)}-r${i}`);
  const reportRows = matched.map((r, i) => {
    const chosen = r.snap.chosen;
    const cl = clusterByReport.get(`R${i}`);
    const credibility = cl?.credibility ?? null;
    return {
      id: reportRowIds[i],
      datasetId,
      srid: crs.srid,
      contributorId: r.contributorId,
      accidentId: null as string | null,
      rawX: r.x,
      rawY: r.y,
      gridKey: gridKey(r.x, r.y),
      positionalAccuracyM: r.accuracyM,
      injectedDriftM: r.isFalseAlarm ? null : Math.round(r.driftM * 100) / 100,
      isFalseAlarm: r.isFalseAlarm,
      isDuplicateWitness: r.isWitness,
      occurrenceTime: r.occurredAt,
      reportedTime: r.reportedAt,
      reportingLagSeconds: Math.round((r.reportedAt.getTime() - r.occurredAt.getTime()) / 1000),
      categoryId: r.categoryCode ? input.categoryIds[r.categoryCode] ?? null : null,
      severityId: input.severityIds[r.severityCode],
      weatherCode: r.weatherCode,
      lightingCode: r.lightingCode,
      trafficState: r.trafficState as any,
      vehicleCount: r.vehicles,
      pedestrianCount: r.pedestrians,
      injuredCount: r.injured,
      fatalityCount: r.fatalities,
      emergencyResponse: r.emergency,
      narrative: r.narrative,
      deviceType: r.deviceType,
      mapMatch: {
        candidates: r.snap.candidates.slice(0, 4).map((c) => ({
          segmentId: c.segmentId,
          lixelId: c.lixelId,
          m: Math.round(c.m * 100) / 100,
          x: c.x,
          y: c.y,
          perpDistanceM: Math.round(c.perpDistanceM * 100) / 100,
          bearingDeltaDeg: Math.round(c.bearingDeltaDeg * 100) / 100,
          roadClass: c.roadClass,
          classPrior: Math.round(c.classPrior * 10000) / 10000,
          topologyBonus: Math.round(c.topologyBonus * 10000) / 10000,
          posterior: Math.round(c.posterior * 100000) / 100000,
        })),
        chosenIndex: r.snap.chosenIndex,
        sigmaM: r.snap.sigmaM,
        entropyNats: Math.round(r.snap.entropyNats * 10000) / 10000,
        ambiguity: Math.round(r.snap.ambiguity * 10000) / 10000,
      },
      snappedSegmentId: chosen?.segmentId ?? null,
      snappedLixelId: chosen?.lixelId ?? null,
      snappedM: chosen ? Math.round(chosen.m * 100) / 100 : null,
      snappedX: chosen?.x ?? null,
      snappedY: chosen?.y ?? null,
      snapPerpDistanceM: chosen ? Math.round(chosen.perpDistanceM * 100) / 100 : null,
      snapPosterior: chosen ? Math.round(chosen.posterior * 100000) / 100000 : null,
      credibility: credibility as any,
      credibilityScore: credibility?.total ?? null,
      status: r.isFalseAlarm ? ("triaged" as const) : cl && cl.memberIds.length > 1 ? ("triaged" as const) : ("unverified" as const),
      clusterId: cl?.id ?? null,
      mediaMetadataStripped: true,
      consentGiven: true,
    };
  });
  await insertChunked(vgiReports, reportRows);

  /* ---------------- canonical incidents from conflation ---------------- */
  const canonicalRows: Array<Record<string, unknown>> = [];
  const reportToAccident = new Map<string, string>();
  let ci = 0;
  for (const cl of clusters) {
    const members = cl.memberIds.map((id) => matched[Number(id.slice(1))]);
    const canonIdx = Number(cl.canonicalId.slice(1));
    const canon = matched[canonIdx];
    const chosen = canon.snap.chosen;
    if (!chosen) continue;
    const accidentId = `${datasetId.slice(0, 8)}-vg${ci++}`;
    const modeSeverity = mode(members.map((m) => m.severityCode));
    const modeCategory = mode(members.map((m) => m.categoryCode).filter(Boolean) as string[]);
    const earliest = members.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b));
    canonicalRows.push({
      id: accidentId,
      datasetId,
      srid: crs.srid,
      isGroundTruth: false,
      isSynthetic: true,
      segmentId: chosen.segmentId,
      lixelId: chosen.lixelId,
      mOffset: Math.round(chosen.m * 100) / 100,
      x: chosen.x,
      y: chosen.y,
      gridKey: gridKey(chosen.x, chosen.y),
      occurredAt: earliest.occurredAt,
      reportedAt: members.reduce((a, b) => (a.reportedAt < b.reportedAt ? a : b)).reportedAt,
      categoryId: modeCategory ? input.categoryIds[modeCategory] ?? null : null,
      severityId: input.severityIds[modeSeverity],
      weatherCode: modeSeverity ? canon.weatherCode : canon.weatherCode,
      lightingCode: canon.lightingCode,
      trafficState: canon.trafficState as any,
      roadSurfaceState: "unknown" as any,
      vehicleCount: Math.max(...members.map((m) => m.vehicles)),
      pedestrianCount: Math.max(...members.map((m) => m.pedestrians)),
      cyclistCount: 0,
      injuredCount: Math.max(...members.map((m) => m.injured)),
      fatalityCount: Math.max(...members.map((m) => m.fatalities)),
      emergencyResponse: members.some((m) => m.emergency),
      witnessCount: members.length,
      credibilityScore: cl.credibility.total,
      status: members.length > 1 ? "triaged" : "unverified",
      canonicalReportId: reportRowIds[canonIdx],
      narrative: canon.narrative,
    });
    cl.memberIds.forEach((mid) => reportToAccident.set(mid, accidentId));
  }
  await insertChunked(accidents, canonicalRows as any);

  // Link reports to their canonical incident.
  for (const [mid, accidentId] of reportToAccident) {
    const idx = Number(mid.slice(1));
    reportRows[idx].accidentId = accidentId;
  }
  for (let i = 0; i < reportRows.length; i += 400) {
    const slice = reportRows.slice(i, i + 400);
    for (const row of slice) {
      await db.update(vgiReports).set({ accidentId: row.accidentId }).where(eq(vgiReports.id, row.id));
    }
  }

  /* ---------------- covariates: environment & traffic exposure ---------------- */
  const envRows: Array<Record<string, unknown>> = [];
  const envRng = new Rng(`env:${input.seed}`);
  for (let d = 0; d < Math.min(studyDays, 400); d++) {
    const at = new Date(windowStart.getTime() + d * 86400000 + 12 * 3600000);
    const month = at.getUTCMonth();
    const winter = month === 11 || month === 0 || month === 1;
    const pool = WEATHER_CODES.filter((w) => (winter ? true : w.code !== "snow" && w.code !== "ice"));
    const w = envRng.weighted(pool, pool.map((q) => q.share));
    const tempC = winter ? envRng.range(-4, 5) : envRng.range(12, 30);
    envRows.push({
      id: `${datasetId.slice(0, 8)}-env${d}`,
      datasetId,
      validAt: at,
      stationId: "SIM-MESO-01",
      x: (network.extent.minX + network.extent.maxX) / 2,
      y: (network.extent.minY + network.extent.maxY) / 2,
      weatherCode: w.code,
      precipitationMmPerH: w.code === "rain_heavy" ? envRng.range(4, 18) : w.code === "rain_light" ? envRng.range(0.2, 3) : w.code === "snow" ? envRng.range(0.5, 3) : 0,
      temperatureC: tempC,
      visibilityM: w.code === "fog" ? envRng.range(80, 900) : w.code.startsWith("rain") ? envRng.range(2500, 9000) : envRng.range(15000, 40000),
      windSpeedKph: envRng.range(2, 42),
      lightingCode: "daylight",
      roadSurfaceState: w.code === "snow" ? "snow" : w.code === "ice" ? "ice" : w.code.startsWith("rain") ? "wet" : "dry",
      source: "synthetic_meso_model",
    });
  }
  await insertChunked(environmentalObservations, envRows);

  const trafficRows: Array<Record<string, unknown>> = [];
  graphSegments.forEach((s, i) => {
    const aadt = s.aadt;
    const imputed = aadt === null;
    const value = imputed ? Math.round(2400 * Math.exp((6 - s.classOrdinal) * 0.45)) : aadt;
    const lengthKm = (s.lengthM * s.sinuosity) / 1000;
    trafficRows.push({
      id: `${datasetId.slice(0, 8)}-tr${i}`,
      datasetId,
      segmentId: s.id,
      validAt: windowStart,
      hourlyVolume: Math.round((value / 24) * 1.35),
      aadt: imputed ? null : value,
      meanSpeedKph: Math.round(s.speedLimitKph * (imputed ? 0.78 : 0.86)),
      occupancyPct: Math.round(Math.min(96, (value / 60000) * 100)),
      state: value > 40000 ? "congested" : value > 18000 ? "dense" : "free_flow",
      vkt: Math.round(value * lengthKm),
      source: imputed ? "class_model" : "loop_detector",
      isImputed: imputed,
    });
  });
  await insertChunked(trafficObservations, trafficRows);

  /* ---------------- finalise dataset metadata ---------------- */
  const totalLengthKm = graphSegments.reduce((s, g) => s + (g.lengthM * g.sinuosity) / 1000, 0);
  const classShare: Record<string, number> = {};
  for (const s of graphSegments) classShare[s.roadClass] = (classShare[s.roadClass] ?? 0) + 1;
  for (const key of Object.keys(classShare)) classShare[key] = Math.round((classShare[key] / graphSegments.length) * 10000) / 10000;
  const degrees = graphNodes.map((n) => n.degree);

  const [updated] = await db
    .update(datasetSources)
    .set({
      networkStats: {
        nodeCount: graphNodes.length,
        segmentCount: graphSegments.length,
        lixelCount: lixels.length,
        totalLengthKm: Math.round(totalLengthKm * 100) / 100,
        meanSegmentLengthM: Math.round(((totalLengthKm * 1000) / Math.max(1, graphSegments.length)) * 10) / 10,
        meanNodeDegree: Math.round((degrees.reduce((a, b) => a + b, 0) / Math.max(1, degrees.length)) * 1000) / 1000,
        classShare,
        betaGamma: {
          beta: Math.round((graphSegments.length / Math.max(1, graphNodes.length)) * 1000) / 1000,
          gamma: Math.round((graphSegments.length / Math.max(1, 3 * graphNodes.length - 6)) * 1000) / 1000,
        },
      },
      simParams: {
        network: netParams,
        process: simP,
        expectedTotalCrashes: Math.round(expectedTotal * 100) / 100,
        realisedGroundTruth: events.length,
        vgiReports: rawReports.length,
        falseAlarms: falseAlarmCount,
        clusters: clusters.length,
        conflation: DEFAULT_CONFLATION,
        generatorVersion: GENERATOR_VERSION,
      },
      recordCounts: {
        groundTruthAccidents: events.length,
        vgiReports: rawReports.length,
        verifiedAccidents: canonicalRows.length,
        falseAlarms: falseAlarmCount,
      },
      generatedAt: new Date(),
    })
    .where(eq(datasetSources.id, datasetId))
    .returning();

  await db.insert(auditLogs).values({
    actorId: input.actorId ?? null,
    actorRole: "simulation_scientist",
    entity: "dataset_sources",
    entityId: datasetId,
    action: "simulate",
    datasetId,
    severity: "notice",
    after: {
      scenario: input.scenario,
      seed: input.seed,
      lixelLengthM: input.lixelLengthM,
      groundTruth: events.length,
      vgiReports: rawReports.length,
      clusters: clusters.length,
      durationMs: Date.now() - started,
      srid: crs.srid,
    },
  });

  return updated;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

export function projectOriginFor(crs: ProjectedCrs, lon: number, lat: number) {
  return toUtm(lon, lat, crs);
}
