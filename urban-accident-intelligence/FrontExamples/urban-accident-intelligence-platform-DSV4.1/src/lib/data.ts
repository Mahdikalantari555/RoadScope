/** Server-side data access layer (Drizzle). All spatial statistics live in analytics.ts. */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accidentCategories,
  accidents,
  datasetSources,
  environmentalObservations,
  intersections,
  roadSegments,
  severityLevels,
  users,
} from "@/db/schema";
import { ensureBootstrap } from "./bootstrap";
import { accidentWhere, type AccidentFilters } from "./filters";

export type AccidentRecord = {
  id: number;
  publicId: string;
  status: string;
  categoryCode: string;
  severityCode: number;
  occurredAt: string;
  reportedAt: string;
  lat: number;
  lng: number;
  district: string | null;
  roadSegmentId: string | null;
  vehicles: number;
  casualties: number;
  fatalities: number;
  emergencyServices: boolean;
  description: string | null;
  weather: string | null;
  roadSurface: string | null;
  lighting: string | null;
  hour: number;
  dow: number;
  month: number;
  positionalUncertaintyM: number;
  locationMethod: string;
  duplicateOfId: number | null;
  duplicateScore: number | null;
  qualityFlags: string[];
  datasetName: string | null;
  reporterName: string | null;
};

export type SegmentRecord = {
  id: string;
  name: string | null;
  roadClass: string;
  lanes: number;
  speedLimitKmh: number;
  surface: string;
  isLit: boolean;
  district: string | null;
  lengthM: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  aadt: number | null;
  heavyVehiclePct: number | null;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type IntersectionRecord = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isSignalised: boolean;
  district: string | null;
  roadNames: string[];
};

export type CityFeature = {
  kind: string;
  name: string;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown> | null;
};

let metaCache: Promise<{
  segments: SegmentRecord[];
  intersections: IntersectionRecord[];
  features: CityFeature[];
  categories: { code: string; label: string; color: string | null; description: string | null }[];
  severities: { code: number; label: string; weight: number; color: string; description: string | null }[];
  districts: { name: string; code: string; centroid: { lat: number; lng: number } | null }[];
  datasets: { id: number; slug: string; name: string; kind: string; scenario: string | null; seed: number | null; description: string | null; citation: string | null; isActive: boolean }[];
}> | null = null;

export function loadMetadata() {
  if (!metaCache) {
    metaCache = (async () => {
      await ensureBootstrap();
      const [segments, intersectionRows, featureRows, categories, severities, datasets] = await Promise.all([
        db.select().from(roadSegments).orderBy(asc(roadSegments.id)),
        db.select().from(intersections).orderBy(asc(intersections.id)),
        db.select({ kind: sql<string>`kind`, name: sql<string>`name`, geometry: sql<GeoJSON.Geometry>`geometry`, properties: sql<Record<string, unknown>>`properties` }).from(sql`city_features`),
        db.select().from(accidentCategories),
        db.select().from(severityLevels).orderBy(asc(severityLevels.code)),
        db.select().from(datasetSources).orderBy(asc(datasetSources.id)),
      ]);
      const districts = featureRows
        .filter((f) => f.kind === "district")
        .map((f) => ({
          name: f.name,
          code: String((f.properties as { code?: string } | null)?.code ?? f.name.slice(0, 2).toUpperCase()),
          centroid: ((f.properties as { centroid?: { lat: number; lng: number } } | null)?.centroid ?? null),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        segments: segments.map((s) => ({
          id: s.id,
          name: s.name,
          roadClass: s.roadClass,
          lanes: s.lanes,
          speedLimitKmh: s.speedLimitKmh,
          surface: s.surface,
          isLit: s.isLit,
          district: s.district,
          lengthM: s.lengthM,
          startLat: s.startLat,
          startLng: s.startLng,
          endLat: s.endLat,
          endLng: s.endLng,
          aadt: s.aadt,
          heavyVehiclePct: s.heavyVehiclePct,
          geometry: s.geometry as SegmentRecord["geometry"],
        })),
        intersections: intersectionRows.map((i) => ({
          id: i.id,
          name: i.name,
          lat: i.lat,
          lng: i.lng,
          isSignalised: i.isSignalised,
          district: i.district,
          roadNames: i.roadNames,
        })),
        features: featureRows.map((f) => ({
          kind: f.kind,
          name: f.name,
          geometry: f.geometry,
          properties: f.properties,
        })),
        categories,
        severities,
        districts,
        datasets,
      };
    })().catch((error) => {
      metaCache = null;
      throw error;
    });
  }
  return metaCache;
}

const accidentColumns = {
  id: accidents.id,
  publicId: accidents.publicId,
  status: accidents.status,
  categoryCode: accidents.categoryCode,
  severityCode: accidents.severityCode,
  occurredAt: accidents.occurredAt,
  reportedAt: accidents.reportedAt,
  lat: accidents.lat,
  lng: accidents.lng,
  district: accidents.district,
  roadSegmentId: accidents.roadSegmentId,
  vehicles: accidents.vehicles,
  casualties: accidents.casualties,
  fatalities: accidents.fatalities,
  emergencyServices: accidents.emergencyServices,
  description: accidents.description,
  weather: accidents.weather,
  roadSurface: accidents.roadSurface,
  lighting: accidents.lighting,
  hour: accidents.hour,
  dow: accidents.dow,
  month: accidents.month,
  positionalUncertaintyM: accidents.positionalUncertaintyM,
  locationMethod: accidents.locationMethod,
  duplicateOfId: accidents.duplicateOfId,
  duplicateScore: accidents.duplicateScore,
  qualityFlags: accidents.qualityFlags,
  datasetName: datasetSources.name,
  reporterName: users.displayName,
};

export async function loadAccidents(filters: AccidentFilters, limit = 8000): Promise<AccidentRecord[]> {
  await ensureBootstrap();
  const rows = await db
    .select(accidentColumns)
    .from(accidents)
    .leftJoin(datasetSources, eq(accidents.datasetId, datasetSources.id))
    .leftJoin(users, eq(accidents.reporterId, users.id))
    .where(accidentWhere(filters))
    .orderBy(desc(accidents.occurredAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    occurredAt: r.occurredAt.toISOString(),
    reportedAt: r.reportedAt.toISOString(),
    qualityFlags: Array.isArray(r.qualityFlags) ? (r.qualityFlags as string[]) : [],
  }));
}

export type AccidentDetail = AccidentRecord & {
  attachments: { id: number; filename: string; mimeType: string; sizeBytes: number }[];
  verifications: { id: number; action: string; notes: string | null; createdAt: string; verifier: string | null }[];
};

export async function loadAccidentDetail(publicIdOrId: string): Promise<AccidentDetail | null> {
  await ensureBootstrap();
  const numeric = Number(publicIdOrId);
  const where = Number.isInteger(numeric) && numeric > 0
    ? sql`${accidents.publicId} = ${publicIdOrId} or ${accidents.id} = ${numeric}`
    : eq(accidents.publicId, publicIdOrId);
  const rows = await db
    .select(accidentColumns)
    .from(accidents)
    .leftJoin(datasetSources, eq(accidents.datasetId, datasetSources.id))
    .leftJoin(users, eq(accidents.reporterId, users.id))
    .where(where)
    .limit(1);
  if (rows.length === 0) return null;
  const accident = rows[0];
  const attachments = await db.execute<{ id: number; filename: string; mime_type: string; size_bytes: number }>(
    sql`select id, filename, mime_type, size_bytes from report_attachments where accident_id = ${accident.id} order by id`,
  );
  const verifications = await db.execute<{ id: number; action: string; notes: string | null; created_at: Date; verifier: string | null }>(
    sql`select v.id, v.action, v.notes, v.created_at, coalesce(u.display_name, 'system') as verifier
        from report_verifications v left join users u on u.id = v.verifier_id
        where v.accident_id = ${accident.id} order by v.created_at desc limit 20`,
  );
  return {
    ...accident,
    occurredAt: accident.occurredAt.toISOString(),
    reportedAt: accident.reportedAt.toISOString(),
    qualityFlags: Array.isArray(accident.qualityFlags) ? (accident.qualityFlags as string[]) : [],
    attachments: attachments.rows.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mime_type, sizeBytes: a.size_bytes })),
    verifications: verifications.rows.map((v) => ({
      id: v.id,
      action: v.action,
      notes: v.notes,
      createdAt: new Date(v.created_at).toISOString(),
      verifier: v.verifier,
    })),
  };
}

export async function loadEnvironmentObservations(limit = 2000) {
  await ensureBootstrap();
  const rows = await db
    .select()
    .from(environmentalObservations)
    .orderBy(desc(environmentalObservations.observedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, observedAt: r.observedAt.toISOString() }));
}

export async function countAccidentsByStatus() {
  await ensureBootstrap();
  return db.select({ status: accidents.status, count: count() }).from(accidents).groupBy(accidents.status);
}

export async function loadModerationQueue(statuses: string[], limit = 60) {
  await ensureBootstrap();
  return db
    .select({
      id: accidents.id,
      publicId: accidents.publicId,
      status: accidents.status,
      occurredAt: accidents.occurredAt,
      reportedAt: accidents.reportedAt,
      categoryCode: accidents.categoryCode,
      severityCode: accidents.severityCode,
      district: accidents.district,
      roadSegmentId: accidents.roadSegmentId,
      description: accidents.description,
      lat: accidents.lat,
      lng: accidents.lng,
      positionalUncertaintyM: accidents.positionalUncertaintyM,
      duplicateScore: accidents.duplicateScore,
      duplicateOfId: accidents.duplicateOfId,
      qualityFlags: accidents.qualityFlags,
      reporterName: users.displayName,
      locationMethod: accidents.locationMethod,
    })
    .from(accidents)
    .leftJoin(users, eq(accidents.reporterId, users.id))
    .where(inArray(accidents.status, statuses))
    .orderBy(asc(accidents.occurredAt))
    .limit(limit);
}

export async function loadAuditLogs(limit = 50) {
  await ensureBootstrap();
  const rows = await db.execute<{ id: number; actor: string; action: string; entity_type: string; entity_id: string | null; detail: unknown; created_at: Date }>(
    sql`select * from audit_logs order by created_at desc limit ${limit}`,
  );
  return rows.rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    detail: r.detail,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function loadSegmentOptions() {
  const meta = await loadMetadata();
  return meta.segments.map((s) => ({ id: s.id, name: s.name, roadClass: s.roadClass, district: s.district }));
}

export async function findDuplicateCandidates(lat: number, lng: number, occurredAt: Date, categoryCode: string) {
  await ensureBootstrap();
  const nearby = await db
    .select({
      id: accidents.id,
      publicId: accidents.publicId,
      lat: accidents.lat,
      lng: accidents.lng,
      occurredAt: accidents.occurredAt,
      categoryCode: accidents.categoryCode,
      severityCode: accidents.severityCode,
      description: accidents.description,
      status: accidents.status,
    })
    .from(accidents)
    .where(
      and(
        sql`${accidents.lat} between ${lat - 0.0025} and ${lat + 0.0025}`,
        sql`${accidents.lng} between ${lng - 0.004} and ${lng + 0.004}`,
      ),
    )
    .limit(50);
  const { haversine } = await import("./geo");
  return nearby
    .map((candidate) => {
      const distanceM = haversine({ lat, lng }, { lat: candidate.lat, lng: candidate.lng });
      const hours = Math.abs(candidate.occurredAt.getTime() - occurredAt.getTime()) / 3_600_000;
      const categoryMatch = candidate.categoryCode === categoryCode;
      const score =
        Math.max(0, 1 - distanceM / 250) * 0.6 +
        Math.max(0, 1 - hours / 24) * 0.3 +
        (categoryMatch ? 0.1 : 0);
      return {
        ...candidate,
        occurredAt: candidate.occurredAt.toISOString(),
        distanceM: Math.round(distanceM),
        hoursApart: Math.round(hours * 10) / 10,
        duplicateScore: Math.round(score * 1000) / 1000,
      };
    })
    .filter((c) => c.distanceM <= 250 && c.hoursApart <= 24)
    .sort((a, b) => b.duplicateScore - a.duplicateScore)
    .slice(0, 5);
}
