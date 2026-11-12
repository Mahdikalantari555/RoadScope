/**
 * Dataset management: synthetic scenario generation, GeoJSON import of real records, activation
 * toggles and deletion. Synthetic and real datasets are stored as separate dataset sources and can
 * be combined or excluded per analysis.
 */
import { asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidentCategories, accidents, datasetSources, environmentalObservations, roadIntersections, roadSegments, severityLevels, trafficObservations } from "@/db/schema";
import type { DatasetGenerationResult, DatasetInfo, ImportResult, SessionUser } from "@/lib/api-types";
import { ACCIDENT_STATUSES, CATEGORY_CODES, CATEGORY_META, SCENARIO_META, SEVERITY_IDS, SEVERITY_META, STUDY_AREA, type AccidentStatus, type ScenarioId } from "@/lib/domain";
import { isWithinStudyCoverage, lonLatToUtm, STUDY_CENTER_UTM } from "@/lib/geo";
import { nearestSegment } from "@/lib/analysis/snapping";
import { computeQualityFlags, duplicateScore } from "@/lib/quality";
import { generateAccidents, generateNetwork, generateTraffic, generateWeather, GENERATOR_VERSION, SCENARIO_CONFIG, WEATHER_STATIONS, type GenAccident } from "@/lib/synthetic";
import { localParts } from "@/lib/time";
import type { ImportInput, SyntheticDatasetInput } from "@/lib/validation";
import { categoryIdMap } from "./accidents";
import { writeAudit } from "./audit";
import { bumpDataVersion, loadNetwork, type NetworkSnapshot } from "./geo-data";
import { ApiError } from "./http";
import { logger } from "./logger";

export const NETWORK_SEED = 20240101;
export const NETWORK_CODE = "synthetic-network";
const PERIOD = { start: "2022-01-01", end: "2024-12-31" };
const YEARS = [2022, 2023, 2024];
const CHUNK = 400;
const TZ = STUDY_AREA.timeZone;

const segCode = (index: number) => `SEG-${String(index + 1).padStart(4, "0")}`;
const ZERO_COUNTS = (): Record<AccidentStatus, number> => ({ reported: 0, verified: 0, rejected: 0, duplicate: 0 });

export async function ensureReferenceData(): Promise<void> {
  await db
    .insert(accidentCategories)
    .values(
      CATEGORY_CODES.map((code, i) => ({
        code,
        label: CATEGORY_META[code].label,
        description: CATEGORY_META[code].description,
        colorHex: CATEGORY_META[code].colorHex,
        sortOrder: i,
      })),
    )
    .onConflictDoNothing({ target: accidentCategories.code });
  await db
    .insert(severityLevels)
    .values(
      SEVERITY_IDS.map((id) => ({
        id,
        code: SEVERITY_META[id].code,
        label: SEVERITY_META[id].label,
        description: SEVERITY_META[id].description,
        weight: SEVERITY_META[id].weight,
        colorHex: SEVERITY_META[id].colorHex,
      })),
    )
    .onConflictDoNothing({ target: severityLevels.id });
}

export async function listDatasets(includeStatusCounts: boolean): Promise<DatasetInfo[]> {
  const sources = await db.select().from(datasetSources).orderBy(asc(datasetSources.id));
  const counts = await db
    .select({ datasetId: accidents.datasetSourceId, status: accidents.status, n: count() })
    .from(accidents)
    .groupBy(accidents.datasetSourceId, accidents.status);
  const byDataset = new Map<number, Record<AccidentStatus, number>>();
  for (const c of counts) {
    const bucket = byDataset.get(c.datasetId) ?? ZERO_COUNTS();
    bucket[c.status] = c.n;
    byDataset.set(c.datasetId, bucket);
  }
  return sources.map((s) => {
    const real = byDataset.get(s.id) ?? ZERO_COUNTS();
    const total = ACCIDENT_STATUSES.reduce((sum, st) => sum + real[st], 0);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      isSynthetic: s.isSynthetic,
      scenario: s.scenario,
      seed: s.seed,
      description: s.description,
      isActive: s.isActive,
      recordCount: total,
      createdAt: s.createdAt.toISOString(),
      statusCounts: includeStatusCounts ? real : ZERO_COUNTS(),
      metadata: s.metadata,
      isNetwork: s.code === NETWORK_CODE,
    };
  });
}

async function datasetInfoById(id: number): Promise<DatasetInfo> {
  const all = await listDatasets(true);
  const found = all.find((d) => d.id === id);
  if (!found) throw new ApiError(404, "not_found", "Dataset not found");
  return found;
}

/** Creates the synthetic road network, intersections, traffic exposure and hourly weather once. */
async function createNetwork(seed: number): Promise<void> {
  const net = generateNetwork(seed);
  const [existing] = await db.select({ id: datasetSources.id }).from(datasetSources).where(eq(datasetSources.code, NETWORK_CODE)).limit(1);
  const source =
    existing ??
    (
      await db
        .insert(datasetSources)
        .values({
          code: NETWORK_CODE,
          name: "Synthetic road network & environment",
          kind: "synthetic",
          isSynthetic: true,
          seed,
          description: "Jittered urban road grid with junctions, AADT traffic observations and hourly weather from three synthetic stations.",
          isActive: true,
          metadata: { generator: GENERATOR_VERSION, nodes: net.nodes.length, segments: net.segments.length, crs: "EPSG:32633 (metric); WGS84 interchange" },
        })
        .returning({ id: datasetSources.id })
    )[0]!;

  const segRows = net.segments.map((s) => ({
    segmentCode: s.code,
    name: s.name,
    roadClass: s.roadClass,
    speedLimitKmh: s.speedLimitKmh,
    lanes: s.lanes,
    lightingScore: s.lighting,
    lengthM: s.lengthM,
    startNodeId: s.startNode,
    endNodeId: s.endNode,
    midLon: s.midLon,
    midLat: s.midLat,
    coordinates: s.lonLat,
    utmCoordinates: [s.a, s.b],
    datasetSourceId: source.id,
  }));
  const codeToId = new Map<string, number>();
  for (let i = 0; i < segRows.length; i += CHUNK) {
    const inserted = await db
      .insert(roadSegments)
      .values(segRows.slice(i, i + CHUNK))
      .onConflictDoNothing({ target: roadSegments.segmentCode })
      .returning({ id: roadSegments.id, code: roadSegments.segmentCode });
    for (const r of inserted) codeToId.set(r.code, r.id);
  }
  if (codeToId.size < segRows.length) {
    const all = await db.select({ id: roadSegments.id, code: roadSegments.segmentCode }).from(roadSegments);
    for (const r of all) codeToId.set(r.code, r.id);
  }

  const junctions = net.nodes
    .filter((n) => n.degree >= 3)
    .map((n) => {
      const [x, y] = lonLatToUtm(n.lon, n.lat);
      return { nodeCode: `J-${String(n.index).padStart(3, "0")}`, lon: n.lon, lat: n.lat, xM: x, yM: y, degree: n.degree, datasetSourceId: source.id };
    });
  for (let i = 0; i < junctions.length; i += CHUNK) {
    await db.insert(roadIntersections).values(junctions.slice(i, i + CHUNK)).onConflictDoNothing({ target: roadIntersections.nodeCode });
  }

  const traffic = generateTraffic(seed, net.segments, YEARS);
  const trafficRows = traffic
    .map((t) => ({
      segmentId: codeToId.get(segCode(t.segmentIndex)),
      year: t.year,
      periodStart: new Date(Date.UTC(t.year, 0, 1)),
      avgDailyVehicles: t.aadt,
      peakHourShare: t.peakHourShare,
      heavyVehicleShare: t.heavyVehicleShare,
      datasetSourceId: source.id,
    }))
    .filter((t): t is typeof t & { segmentId: number } => t.segmentId !== undefined);
  for (let i = 0; i < trafficRows.length; i += CHUNK) {
    await db.insert(trafficObservations).values(trafficRows.slice(i, i + CHUNK)).onConflictDoNothing();
  }

  const weather = generateWeather(seed, new Date(Date.UTC(2022, 0, 1)), new Date(Date.UTC(2024, 11, 31, 23)));
  const weatherRows = weather.map((w) => ({
    stationCode: w.stationCode,
    stationName: w.stationName,
    lon: w.lon,
    lat: w.lat,
    observedAt: w.observedAt,
    precipitationMm: w.precipitationMm,
    temperatureC: w.temperatureC,
    visibilityM: w.visibilityM,
    windSpeedMs: w.windSpeedMs,
    datasetSourceId: source.id,
  }));
  for (let i = 0; i < weatherRows.length; i += 2000) {
    await db.insert(environmentalObservations).values(weatherRows.slice(i, i + 2000)).onConflictDoNothing();
  }
  logger.info("network.created", { segments: segRows.length, junctions: junctions.length, traffic: trafficRows.length, weather: weatherRows.length });
  bumpDataVersion();
}

export async function ensureNetwork(): Promise<void> {
  const [seg] = await db.select({ id: roadSegments.id }).from(roadSegments).limit(1);
  if (!seg) await createNetwork(NETWORK_SEED);
}

async function insertAccidents(datasetId: number, items: GenAccident[], network: NetworkSnapshot): Promise<number[]> {
  const catIds = await categoryIdMap();
  const snaps = items.map((a) => nearestSegment(a.x, a.y, network.geoms));
  const rows = items.map((a, i) => {
    const local = localParts(a.occurredAt, TZ);
    const snap = snaps[i];
    return {
      datasetSourceId: datasetId,
      categoryId: catIds.get(a.categoryCode)!,
      severityId: a.severityId,
      status: a.status,
      occurredAt: a.occurredAt,
      reportedAt: a.reportedAt,
      reportingDelayMin: a.reportingDelayMin,
      vehiclesInvolved: a.vehiclesInvolved,
      emergencyServices: a.emergencyServices,
      description: a.description,
      reportedLon: a.lon,
      reportedLat: a.lat,
      reportedAccuracyM: a.reportedAccuracyM,
      lon: a.lon,
      lat: a.lat,
      xM: a.x,
      yM: a.y,
      locationSource: "synthetic",
      nearestSegmentId: snap?.segmentId ?? null,
      snapDistanceM: snap?.distanceM ?? null,
      yearLocal: local.year,
      monthLocal: local.month,
      dowLocal: local.dow,
      hourLocal: local.hour,
      reporterHash: null,
      trackingCode: a.trackingCode,
      duplicateOfId: null,
      duplicateCandidateId: null,
      duplicateScore: null,
      qualityFlags: computeQualityFlags({
        snapDistanceM: snap?.distanceM ?? null,
        reportingDelayMin: a.reportingDelayMin,
        hasDuplicateCandidate: a.duplicateOfIndex !== null,
        coordinateMoved: false,
      }),
    };
  });

  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const inserted = await db.insert(accidents).values(rows.slice(i, i + CHUNK)).returning({ id: accidents.id });
    for (const r of inserted) ids.push(r.id);
  }

  // Second pass: link duplicates to their originals now that ids are known.
  for (let i = 0; i < items.length; i++) {
    const a = items[i]!;
    if (a.duplicateOfIndex === null) continue;
    const orig = items[a.duplicateOfIndex]!;
    const origId = ids[a.duplicateOfIndex]!;
    const score = duplicateScore(
      { x: a.x, y: a.y, tMs: a.occurredAt.getTime(), categoryCode: a.categoryCode },
      { x: orig.x, y: orig.y, tMs: orig.occurredAt.getTime(), categoryCode: orig.categoryCode },
    );
    const link = a.status === "duplicate" ? { duplicateOfId: origId } : { duplicateCandidateId: origId };
    await db
      .update(accidents)
      .set({ ...link, duplicateScore: Math.round(score * 1000) / 1000 })
      .where(eq(accidents.id, ids[i]!));
  }
  return ids;
}

export async function generateDataset(input: SyntheticDatasetInput, actor: SessionUser | null, ip: string | null): Promise<DatasetGenerationResult> {
  await ensureReferenceData();
  await ensureNetwork();
  const network = await loadNetwork();
  const label = SCENARIO_META[input.scenario as ScenarioId].label;
  const kindLabel = input.kind === "citizen" ? "Citizen-report simulation" : "Synthetic";
  const name = input.name ?? `${kindLabel} · ${label} (seed ${input.seed})`;
  const code = `${input.kind === "citizen" ? "citizen-sim" : "synthetic"}-${input.scenario}-${input.seed}-${Date.now().toString(36)}`;

  const generated = generateAccidents(generateNetwork(NETWORK_SEED), {
    seed: input.seed,
    scenario: input.scenario,
    count: input.accidentCount,
    kind: input.kind,
    startLocal: PERIOD.start,
    endLocal: PERIOD.end,
  });

  const [source] = await db
    .insert(datasetSources)
    .values({
      code,
      name,
      kind: input.kind === "citizen" ? "citizen" : "synthetic",
      isSynthetic: true,
      scenario: input.scenario,
      seed: input.seed,
      description: `${SCENARIO_META[input.scenario as ScenarioId].description} SYNTHETIC — not real-world data.`,
      isActive: true,
      metadata: {
        generator: GENERATOR_VERSION,
        period: PERIOD,
        timezone: TZ,
        scenarioConfig: SCENARIO_CONFIG[input.scenario],
        requestedCount: input.accidentCount,
        injected: generated.injected,
      },
    })
    .returning({ id: datasetSources.id });

  const ids = await insertAccidents(source!.id, generated.accidents, network);
  await db
    .update(datasetSources)
    .set({ recordCount: ids.length, updatedAt: new Date() })
    .where(eq(datasetSources.id, source!.id));
  await writeAudit({
    actor,
    action: "dataset.generate",
    entityType: "dataset",
    entityId: source!.id,
    changes: { scenario: input.scenario, seed: input.seed, records: ids.length, injected: generated.injected, kind: input.kind },
    ip,
  });
  bumpDataVersion();
  return { dataset: await datasetInfoById(source!.id), accidentsInserted: ids.length, injected: generated.injected };
}

const importFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    occurred_at: z.string(),
    category: z.enum(CATEGORY_CODES),
    severity: z.union([z.number().int().min(1).max(4), z.enum(["pdo", "minor", "serious", "fatal"])]),
    vehicles: z.number().int().min(1).max(50).optional(),
    emergency: z.boolean().optional(),
    description: z.string().max(1000).optional(),
  }),
});

const SEVERITY_CODE_TO_ID: Record<string, number> = { pdo: 1, minor: 2, serious: 3, fatal: 4 };

/** Imports real accident points from GeoJSON. Imported records are treated as authoritative (verified). */
export async function importDataset(input: ImportInput, actor: SessionUser, ip: string | null): Promise<ImportResult> {
  await ensureReferenceData();
  await ensureNetwork();
  const network = await loadNetwork();
  const catIds = await categoryIdMap();
  const rejected: { index: number; reason: string }[] = [];
  const now = Date.now();
  const rows: (typeof accidents.$inferInsert)[] = [];

  input.features.forEach((raw, index) => {
    const parsed = importFeatureSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ index, reason: parsed.error.issues[0]?.message ?? "Invalid feature" });
      return;
    }
    const f = parsed.data;
    const [lon, lat] = f.geometry.coordinates;
    if (!isWithinStudyCoverage(lon, lat)) {
      rejected.push({ index, reason: "Location outside the study area coverage" });
      return;
    }
    const occurred = new Date(f.properties.occurred_at);
    if (Number.isNaN(occurred.getTime())) {
      rejected.push({ index, reason: "occurred_at must be an ISO 8601 timestamp" });
      return;
    }
    if (occurred.getTime() > now + 5 * 60_000) {
      rejected.push({ index, reason: "occurred_at lies in the future" });
      return;
    }
    const severityId = typeof f.properties.severity === "number" ? f.properties.severity : SEVERITY_CODE_TO_ID[f.properties.severity]!;
    const [x, y] = lonLatToUtm(lon, lat);
    const snap = nearestSegment(x, y, network.geoms);
    const local = localParts(occurred, TZ);
    rows.push({
      datasetSourceId: 0,
      categoryId: catIds.get(f.properties.category)!,
      severityId,
      status: "verified",
      occurredAt: occurred,
      reportedAt: occurred,
      reportingDelayMin: 0,
      vehiclesInvolved: f.properties.vehicles ?? 1,
      emergencyServices: f.properties.emergency ?? false,
      description: f.properties.description ?? "",
      reportedLon: lon,
      reportedLat: lat,
      lon,
      lat,
      xM: x,
      yM: y,
      locationSource: "validated",
      nearestSegmentId: snap?.segmentId ?? null,
      snapDistanceM: snap?.distanceM ?? null,
      yearLocal: local.year,
      monthLocal: local.month,
      dowLocal: local.dow,
      hourLocal: local.hour,
      qualityFlags: computeQualityFlags({ snapDistanceM: snap?.distanceM ?? null, reportingDelayMin: 0, hasDuplicateCandidate: false, coordinateMoved: false }),
    });
  });

  const [source] = await db
    .insert(datasetSources)
    .values({
      code: `import-${Date.now().toString(36)}`,
      name: input.name,
      kind: "real_import",
      isSynthetic: false,
      description: "Imported GeoJSON accident points. Records are treated as verified on import; provenance must be documented by the importer.",
      isActive: true,
      metadata: { importedBy: actor.email, importedAt: new Date().toISOString(), rejected: rejected.length },
    })
    .returning({ id: datasetSources.id });
  const datasetId = source!.id;
  const toInsert = rows.map((r) => ({ ...r, datasetSourceId: datasetId }));
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await db.insert(accidents).values(toInsert.slice(i, i + CHUNK));
  }
  await db.update(datasetSources).set({ recordCount: toInsert.length, updatedAt: new Date() }).where(eq(datasetSources.id, datasetId));
  await writeAudit({
    actor,
    action: "dataset.import",
    entityType: "dataset",
    entityId: datasetId,
    changes: { accepted: toInsert.length, rejected: rejected.length },
    ip,
  });
  bumpDataVersion();
  return { dataset: await datasetInfoById(datasetId), accepted: toInsert.length, rejected: rejected.slice(0, 200) };
}

export async function setDatasetActive(id: number, isActive: boolean, actor: SessionUser, ip: string | null): Promise<DatasetInfo> {
  const [row] = await db.select({ id: datasetSources.id, code: datasetSources.code }).from(datasetSources).where(eq(datasetSources.id, id)).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Dataset not found");
  if (row.code === NETWORK_CODE) throw new ApiError(409, "protected_dataset", "The road network is always active");
  await db.update(datasetSources).set({ isActive, updatedAt: new Date() }).where(eq(datasetSources.id, id));
  await writeAudit({ actor, action: isActive ? "dataset.activate" : "dataset.deactivate", entityType: "dataset", entityId: id, ip });
  bumpDataVersion();
  return datasetInfoById(id);
}

export async function deleteDataset(id: number, actor: SessionUser, ip: string | null): Promise<void> {
  const [row] = await db.select({ id: datasetSources.id, code: datasetSources.code, name: datasetSources.name }).from(datasetSources).where(eq(datasetSources.id, id)).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Dataset not found");
  if (row.code === NETWORK_CODE) throw new ApiError(409, "protected_dataset", "The road network cannot be deleted");
  await db.delete(datasetSources).where(eq(datasetSources.id, id));
  await writeAudit({ actor, action: "dataset.delete", entityType: "dataset", entityId: id, changes: { name: row.name }, ip });
  bumpDataVersion();
}

/** Default demonstration workspace: network, four synthetic scenarios and a citizen simulation. */
export async function bootstrapDemoWorkspace(): Promise<void> {
  await ensureReferenceData();
  await ensureNetwork();
  const plan: { scenario: ScenarioId; count: number; active: boolean; kind: "synthetic" | "citizen"; seed: number }[] = [
    { scenario: "mixed", count: 6000, active: true, kind: "synthetic", seed: 20260101 },
    { scenario: "intersection", count: 3000, active: false, kind: "synthetic", seed: 20260102 },
    { scenario: "rush_hour", count: 3000, active: false, kind: "synthetic", seed: 20260103 },
    { scenario: "uniform", count: 3000, active: false, kind: "synthetic", seed: 20260104 },
    { scenario: "mixed", count: 150, active: true, kind: "citizen", seed: 20260105 },
  ];
  for (const p of plan) {
    const result = await generateDataset({ scenario: p.scenario, accidentCount: p.count, seed: p.seed, kind: p.kind, name: undefined }, null, null);
    if (!p.active) await db.update(datasetSources).set({ isActive: false }).where(eq(datasetSources.id, result.dataset.id));
  }
  bumpDataVersion();
  logger.info("demo.workspace.created", { datasets: plan.length });
}

export async function networkSummary() {
  const [seg] = await db.select({ n: count(), km: sql<string>`coalesce(sum(${roadSegments.lengthM}), 0) / 1000` }).from(roadSegments);
  const [junction] = await db.select({ n: count() }).from(roadIntersections);
  const [traffic] = await db.select({ n: count() }).from(trafficObservations);
  const [weather] = await db.select({ n: count() }).from(environmentalObservations);
  return {
    segments: seg?.n ?? 0,
    networkKm: Number(seg?.km ?? 0),
    intersections: junction?.n ?? 0,
    trafficObservations: traffic?.n ?? 0,
    weatherObservations: weather?.n ?? 0,
    stations: WEATHER_STATIONS.map((s) => ({ code: s.code, name: s.name, lon: s.lon, lat: s.lat })),
    studyCenterUtm: STUDY_CENTER_UTM,
  };
}

export { ACCIDENT_STATUSES, SCENARIO_CONFIG, SEVERITY_IDS };
export type { AccidentStatus };
