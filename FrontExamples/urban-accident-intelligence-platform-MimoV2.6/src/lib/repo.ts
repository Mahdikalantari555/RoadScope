/** Data access layer — all SQL goes through Drizzle here, never through UI code. */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accidents,
  accidentCategories,
  auditLogs,
  datasetSources,
  environmentalObservations,
  reportAttachments,
  reportVerifications,
  roadSegments,
  severityLevels,
  trafficObservations,
} from "@/db/schema";
import type {
  Accident,
  AccidentFilters,
  AuditLogEntry,
  DatasetSource,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  Paginated,
  RoadSegment,
  TrafficObservation,
} from "@/lib/types";

export function mapAccident(
  row: typeof accidents.$inferSelect,
  cat: typeof accidentCategories.$inferSelect | undefined,
  sev: typeof severityLevels.$inferSelect | undefined,
  seg: { segmentCode: string; streetName: string; district: string } | undefined,
  attachmentCount: number,
): Accident {
  return {
    id: row.id,
    publicId: row.publicId,
    categoryCode: row.categoryCode as Accident["categoryCode"],
    categoryLabel: cat?.label ?? row.categoryCode,
    categoryGroup: cat?.group ?? "Unclassified",
    severityCode: row.severityCode as Accident["severityCode"],
    severityLabel: sev?.label ?? row.severityCode,
    severityWeight: sev?.weight ?? 1,
    roadSegmentId: row.roadSegmentId,
    roadSegmentCode: seg?.segmentCode ?? null,
    streetName: seg?.streetName ?? null,
    lon: row.lon,
    lat: row.lat,
    reportedLon: row.reportedLon,
    reportedLat: row.reportedLat,
    positionalAccuracyM: row.positionalAccuracyM,
    geocodePrecision: row.geocodePrecision as Accident["geocodePrecision"],
    occurredAt: row.occurredAt.toISOString(),
    reportedAt: row.reportedAt.toISOString(),
    reportDelayH: row.reportDelayH,
    vehicles: row.vehicles,
    casualties: row.casualties,
    description: row.description,
    emergencyServices: row.emergencyServices,
    status: row.status as Accident["status"],
    duplicateOfId: row.duplicateOfId,
    rejectReason: row.rejectReason,
    reporterHandle: row.reporterHandle,
    isSynthetic: row.isSynthetic,
    datasetSourceId: row.datasetSourceId,
    lighting: row.lighting,
    weather: row.weather,
    roadSurface: row.roadSurface,
    district: seg?.district ?? "Unassigned",
    attachmentCount,
  };
}

export function mapSegment(row: typeof roadSegments.$inferSelect): RoadSegment {
  const gj = row.geometryJson as { coordinates: [number, number][] };
  return {
    id: row.id,
    segmentCode: row.segmentCode,
    streetName: row.streetName,
    roadClass: row.roadClass as RoadSegment["roadClass"],
    district: row.district,
    lengthM: row.lengthM,
    bearingDeg: row.bearingDeg,
    speedLimitKph: row.speedLimitKph,
    lanes: row.lanes,
    lighting: row.lighting,
    surface: row.surface,
    hasJunctionControl: row.hasJunctionControl,
    hasCycleLane: row.hasCycleLane,
    centroidLon: row.centroidLon,
    centroidLat: row.centroidLat,
    coordinates: gj.coordinates,
  };
}

export async function loadVocabularies() {
  const [cats, sevs] = await Promise.all([
    db.select().from(accidentCategories),
    db.select().from(severityLevels),
  ]);
  return {
    cats: new Map(cats.map((c) => [c.code, c])),
    sevs: new Map(sevs.map((s) => [s.code, s])),
  };
}

export async function loadSegments(): Promise<RoadSegment[]> {
  const rows = await db.select().from(roadSegments).orderBy(asc(roadSegments.id));
  return rows.map(mapSegment);
}

function buildWhere(f: AccidentFilters) {
  const conds = [];
  if (f.from) conds.push(gte(accidents.occurredAt, new Date(f.from)));
  if (f.to) conds.push(lte(accidents.occurredAt, new Date(f.to)));
  if (f.categories?.length) conds.push(inArray(accidents.categoryCode, f.categories));
  if (f.severities?.length) conds.push(inArray(accidents.severityCode, f.severities));
  if (f.statuses?.length) conds.push(inArray(accidents.status, f.statuses));
  if (f.minVehicles) conds.push(gte(accidents.vehicles, f.minVehicles));
  if (f.emergencyOnly) conds.push(eq(accidents.emergencyServices, true));
  if (f.bbox) {
    const [minLon, minLat, maxLon, maxLat] = f.bbox;
    conds.push(
      gte(accidents.lon, minLon),
      lte(accidents.lon, maxLon),
      gte(accidents.lat, minLat),
      lte(accidents.lat, maxLat),
    );
  }
  if (f.text) {
    conds.push(sql`(${accidents.description} ILIKE ${"%" + f.text + "%"} OR ${accidents.publicId} ILIKE ${"%" + f.text + "%"})`);
  }
  return conds.length ? and(...conds) : undefined;
}

export async function queryAccidents(
  f: AccidentFilters,
  limit = 5000,
  offset = 0,
): Promise<Paginated<Accident>> {
  const where = buildWhere(f);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accidents)
    .where(where);
  const rows = await db
    .select()
    .from(accidents)
    .where(where)
    .orderBy(desc(accidents.occurredAt))
    .limit(limit)
    .offset(offset);

  const [voc, segRows, attachCounts] = await Promise.all([
    loadVocabularies(),
    loadSegments(),
    db
      .select({
        accidentId: reportAttachments.accidentId,
        n: sql<number>`count(*)::int`,
      })
      .from(reportAttachments)
      .groupBy(reportAttachments.accidentId),
  ]);
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const attachMap = new Map(attachCounts.map((a) => [a.accidentId, a.n]));

  return {
    data: rows.map((r) =>
      mapAccident(
        r,
        voc.cats.get(r.categoryCode),
        voc.sevs.get(r.severityCode),
        segById.get(r.roadSegmentId ?? -1),
        attachMap.get(r.id) ?? 0,
      ),
    ),
    total: count,
    limit,
    offset,
  };
}

export function accidentsToGeoJson(list: Accident[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: list.map(
      (a): GeoJsonFeature => ({
        type: "Feature",
        id: a.id,
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
        properties: {
          id: a.id,
          publicId: a.publicId,
          categoryCode: a.categoryCode,
          categoryLabel: a.categoryLabel,
          severityCode: a.severityCode,
          severityLabel: a.severityLabel,
          status: a.status,
          occurredAt: a.occurredAt,
          vehicles: a.vehicles,
          casualties: a.casualties,
          streetName: a.streetName,
          district: a.district,
          positionalAccuracyM: a.positionalAccuracyM,
          emergencyServices: a.emergencyServices,
          synthetic: a.isSynthetic,
        },
      }),
    ),
  };
}

export function segmentsToGeoJson(list: RoadSegment[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: list.map(
      (s): GeoJsonFeature => ({
        type: "Feature",
        id: s.id,
        geometry: { type: "LineString", coordinates: s.coordinates },
        properties: {
          id: s.id,
          segmentCode: s.segmentCode,
          streetName: s.streetName,
          roadClass: s.roadClass,
          district: s.district,
          lengthM: s.lengthM,
          speedLimitKph: s.speedLimitKph,
          lanes: s.lanes,
          lighting: s.lighting,
          hasCycleLane: s.hasCycleLane,
          hasJunctionControl: s.hasJunctionControl,
          accidentCount: s.accidentCount ?? 0,
          severityWeightedIndex: s.severityWeightedIndex ?? 0,
          riskIndex: s.riskIndex ?? 0,
        },
      }),
    ),
  };
}

/**
 * Attach accident statistics to road segments (frequency + severity-weighted
 * index + exposure coverage). The weighted index is an index, NOT a probability.
 */
export function aggregateBySegmentDetails(
  segments: RoadSegment[],
  accRows: (typeof accidents.$inferSelect)[],
): RoadSegment[] {
  const byId = new Map<number, { count: number; sw: number }>();
  for (const a of accRows) {
    if (a.roadSegmentId == null) continue;
    const sevWeight =
      a.severityCode === "fatal" ? 10 : a.severityCode === "serious" ? 5 : a.severityCode === "slight" ? 2 : 1;
    const rec = byId.get(a.roadSegmentId) ?? { count: 0, sw: 0 };
    rec.count += 1;
    rec.sw += sevWeight;
    byId.set(a.roadSegmentId, rec);
  }
  return segments.map((s) => {
    const rec = byId.get(s.id);
    return {
      ...s,
      accidentCount: rec?.count ?? 0,
      severityWeightedIndex: Math.round((rec?.sw ?? 0) * 10) / 10,
      riskIndex: 0,
      exposureCoverage: 1,
    };
  });
}

export async function insertAudit(entry: {
  actorUserId?: number | null;
  actorRole: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: unknown;
}) {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId ?? null,
    actorRole: entry.actorRole,
    actorName: entry.actorName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    detail: entry.detail as never,
  });
}

export async function listDatasets(): Promise<DatasetSource[]> {
  const rows = await db.select().from(datasetSources).orderBy(asc(datasetSources.id));
  return rows.map((r) => ({
    ...r,
    coverageStart: r.coverageStart?.toISOString() ?? null,
    coverageEnd: r.coverageEnd?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  })) as unknown as DatasetSource[];
}

export async function listAudit(limit = 60): Promise<AuditLogEntry[]> {
  const rows = await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  })) as unknown as AuditLogEntry[];
}

export async function getTraffic(segmentId?: number): Promise<TrafficObservation[]> {
  const rows = segmentId
    ? await db
        .select()
        .from(trafficObservations)
        .where(eq(trafficObservations.roadSegmentId, segmentId))
        .orderBy(asc(trafficObservations.hourOfDay))
    : await db.select().from(trafficObservations).orderBy(asc(trafficObservations.hourOfDay));
  return rows.map((r) => ({
    roadSegmentId: r.roadSegmentId,
    hourOfDay: r.hourOfDay,
    dayType: r.dayType,
    volumeVehPerHour: r.volumeVehPerHour,
    avgSpeedKph: r.avgSpeedKph,
    aadt: r.aadt,
    congestionIndex: r.congestionIndex,
    coverageRatio: r.coverageRatio,
  }));
}

export async function getEnvironmentalStats() {
  const rows = await db
    .select({
      weather: environmentalObservations.weather,
      count: sql<number>`count(*)::int`,
      meanVis: sql<number>`avg(${environmentalObservations.visibilityM})`,
    })
    .from(environmentalObservations)
    .groupBy(environmentalObservations.weather);
  return rows;
}

export async function getVerificationCounts() {
  const rows = await db
    .select({
      decision: reportVerifications.decision,
      count: sql<number>`count(*)::int`,
    })
    .from(reportVerifications)
    .groupBy(reportVerifications.decision);
  return rows;
}

export async function getStatusCounts() {
  const rows = await db
    .select({ status: accidents.status, count: sql<number>`count(*)::int` })
    .from(accidents)
    .groupBy(accidents.status);
  return rows;
}
