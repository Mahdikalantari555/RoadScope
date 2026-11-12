/** Data-access layer: reference data, road network cache, filtered accident retrieval, snapping, audit. */
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accidentCategories, accidents, auditLogs, datasetSources, roadNodes, roadSegments, severityLevels, trafficObservations } from "@/db/schema";
import type { Filters } from "@/lib/domain";
import { LineGrid, type IndexedLine, type XY } from "@/lib/geo/geometry";
import { fromUtm, toUtm } from "@/lib/geo/projection";
import { CITY_TIMEZONE } from "@/lib/geo/time";

export const SNAP_MAX_M = 60;

export interface Meta {
  categories: { id: number; code: string; label: string; color: string; description: string }[];
  severities: { id: number; code: string; label: string; rank: number; epdoWeight: number; color: string }[];
  catById: Map<number, string>;
  sevById: Map<number, { code: string; rank: number }>;
  catId: Map<string, number>;
  sevId: Map<string, number>;
}

let metaCache: Meta | null = null;
export async function getMeta(): Promise<Meta> {
  if (metaCache) return metaCache;
  const categories = await db.select().from(accidentCategories).orderBy(accidentCategories.id);
  const severities = await db.select().from(severityLevels).orderBy(severityLevels.rank);
  metaCache = {
    categories,
    severities,
    catById: new Map(categories.map((c) => [c.id, c.code])),
    sevById: new Map(severities.map((s) => [s.id, { code: s.code, rank: s.rank }])),
    catId: new Map(categories.map((c) => [c.code, c.id])),
    sevId: new Map(severities.map((s) => [s.code, s.id])),
  };
  return metaCache;
}
export function invalidateMeta() {
  metaCache = null;
}

/** The road network belongs to the newest active synthetic/official dataset. */
export async function networkDatasetId(): Promise<number | null> {
  const [d] = await db
    .select({ id: datasetSources.id })
    .from(datasetSources)
    .where(and(inArray(datasetSources.kind, ["synthetic", "official"]), eq(datasetSources.isActive, true)))
    .orderBy(desc(datasetSources.id))
    .limit(1);
  return d?.id ?? null;
}

export interface NetworkSegment {
  id: number;
  name: string;
  roadClass: "arterial" | "collector" | "local";
  speedLimit: number;
  lanes: number;
  lit: boolean;
  surface: string;
  lengthM: number;
  geom: [number, number][];
  geomProj: XY[];
  aadt: number | null;
  fromNodeId: number | null;
  toNodeId: number | null;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
interface NetworkCache {
  datasetId: number;
  segments: NetworkSegment[];
  byId: Map<number, NetworkSegment>;
  grid: LineGrid;
  extent: { minX: number; minY: number; maxX: number; maxY: number };
}
let networkCache: NetworkCache | null = null;
const inflight = new Map<number, Promise<NetworkCache>>();

export async function getNetwork(): Promise<NetworkCache | null> {
  const dsId = await networkDatasetId();
  if (!dsId) return null;
  if (networkCache && networkCache.datasetId === dsId) return networkCache;
  let p = inflight.get(dsId);
  if (!p) {
    p = buildNetwork(dsId).finally(() => inflight.delete(dsId));
    inflight.set(dsId, p);
  }
  return p;
}

async function buildNetwork(dsId: number): Promise<NetworkCache> {
  const rows = await db.select().from(roadSegments).where(eq(roadSegments.datasetId, dsId));
  const traffic = await db
    .select({ segmentId: trafficObservations.segmentId, aadt: sql<number>`avg(${trafficObservations.aadt})::float` })
    .from(trafficObservations)
    .where(eq(trafficObservations.datasetId, dsId))
    .groupBy(trafficObservations.segmentId);
  const aadt = new Map(traffic.map((t) => [t.segmentId, Math.round(t.aadt)]));
  const segments: NetworkSegment[] = rows.map((r) => ({ ...r, geomProj: r.geomProj as XY[], aadt: aadt.get(r.id) ?? null }));
  const lines: IndexedLine[] = segments.map((s) => ({ id: s.id, coords: s.geomProj, bbox: { minX: s.minX, minY: s.minY, maxX: s.maxX, maxY: s.maxY } }));
  const extent = {
    minX: Math.min(...segments.map((s) => s.minX)),
    minY: Math.min(...segments.map((s) => s.minY)),
    maxX: Math.max(...segments.map((s) => s.maxX)),
    maxY: Math.max(...segments.map((s) => s.maxY)),
  };
  const built: NetworkCache = { datasetId: dsId, segments, byId: new Map(segments.map((s) => [s.id, s])), grid: new LineGrid(lines, 250), extent };
  networkCache = built;
  return built;
}
export function invalidateNetwork() {
  networkCache = null;
}

export interface SnapResult {
  lon: number;
  lat: number;
  x: number;
  y: number;
  segmentId: number | null;
  snapDistanceM: number | null;
  flags: string[];
}

/** Validate a reported coordinate by nearest-segment assignment (map-matching to the network). */
export async function snapToNetwork(lon: number, lat: number): Promise<SnapResult> {
  return snapWith(await getNetwork(), lon, lat);
}

/** Synchronous variant for bulk processing with a pre-loaded network. */
export function snapWith(net: NetworkCache | null, lon: number, lat: number): SnapResult {
  const [x, y] = toUtm(lon, lat);
  const flags: string[] = [];
  if (!net) return { lon, lat, x, y, segmentId: null, snapDistanceM: null, flags: ["no_network"] };
  const near = net.grid.nearest([x, y], SNAP_MAX_M);
  if (!near) {
    const far = net.grid.nearest([x, y], 2000);
    flags.push("off_network");
    return { lon, lat, x, y, segmentId: null, snapDistanceM: far ? far.proj.distance : null, flags };
  }
  if (near.proj.distance > 25) flags.push("low_positional_confidence");
  const [sx, sy] = near.proj.point;
  const [slon, slat] = fromUtm(sx, sy);
  return { lon: slon, lat: slat, x: sx, y: sy, segmentId: near.line.id, snapDistanceM: near.proj.distance, flags };
}

export async function activeDatasetIds(): Promise<number[]> {
  const rows = await db.select({ id: datasetSources.id }).from(datasetSources).where(eq(datasetSources.isActive, true));
  return rows.map((r) => r.id);
}

export async function buildWhere(f: Filters, defaults: { statuses?: string[] } = {}): Promise<SQL | undefined> {
  const meta = await getMeta();
  const c: SQL[] = [];
  const ds = f.datasets?.length ? f.datasets : await activeDatasetIds();
  c.push(inArray(accidents.datasetId, ds.length ? ds : [-1]));
  if (f.from) c.push(gte(accidents.occurredAt, new Date(f.from)));
  if (f.to) c.push(lte(accidents.occurredAt, new Date(f.to.length <= 10 ? `${f.to}T23:59:59.999Z` : f.to)));
  if (f.categories?.length) c.push(inArray(accidents.categoryId, f.categories.map((k) => meta.catId.get(k) ?? -1)));
  if (f.severities?.length) c.push(inArray(accidents.severityId, f.severities.map((k) => meta.sevId.get(k) ?? -1)));
  const statuses = f.statuses?.length ? f.statuses : defaults.statuses;
  if (statuses?.length) c.push(inArray(accidents.status, statuses as ("reported" | "verified" | "rejected" | "duplicate")[]));
  const hourExpr = sql`extract(hour from ${accidents.occurredAt} at time zone ${CITY_TIMEZONE})`;
  if (f.hourFrom !== undefined && f.hourTo !== undefined && !(f.hourFrom === 0 && f.hourTo === 23)) {
    if (f.hourFrom <= f.hourTo) c.push(sql`${hourExpr} between ${f.hourFrom} and ${f.hourTo}`);
    else c.push(sql`(${hourExpr} >= ${f.hourFrom} or ${hourExpr} <= ${f.hourTo})`);
  }
  if (f.weekdays?.length && f.weekdays.length < 7)
    c.push(sql`(extract(isodow from ${accidents.occurredAt} at time zone ${CITY_TIMEZONE}) - 1) in (${sql.join(f.weekdays.map((w) => sql`${w}`), sql`, `)})`);
  if (f.bbox) {
    const [a, b, cc, d] = f.bbox;
    c.push(sql`${accidents.lon} between ${a} and ${cc} and ${accidents.lat} between ${b} and ${d}`);
  }
  return c.length ? and(...c) : undefined;
}

export interface AccidentRow {
  id: number;
  trackingCode: string;
  datasetId: number;
  t: number;
  reportedAt: number;
  category: string;
  severity: string;
  severityRank: number;
  status: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  segmentId: number | null;
  vehicles: number;
  emergency: boolean;
  weather: string | null;
  light: string | null;
  snapDistanceM: number | null;
  flags: string[];
  duplicateOfId: number | null;
  duplicateScore: number | null;
  isSynthetic: boolean;
}

export async function loadAccidents(f: Filters, defaults: { statuses?: string[] } = {}, limit = 50000): Promise<AccidentRow[]> {
  const meta = await getMeta();
  const where = await buildWhere(f, defaults);
  const rows = await db
    .select({
      id: accidents.id,
      trackingCode: accidents.trackingCode,
      datasetId: accidents.datasetId,
      occurredAt: accidents.occurredAt,
      reportedAt: accidents.reportedAt,
      categoryId: accidents.categoryId,
      severityId: accidents.severityId,
      status: accidents.status,
      lon: accidents.lon,
      lat: accidents.lat,
      x: accidents.x,
      y: accidents.y,
      segmentId: accidents.segmentId,
      vehicles: accidents.vehicles,
      emergency: accidents.emergencyServices,
      weather: accidents.weather,
      light: accidents.lightCondition,
      snapDistanceM: accidents.snapDistanceM,
      flags: accidents.qualityFlags,
      duplicateOfId: accidents.duplicateOfId,
      duplicateScore: accidents.duplicateScore,
      isSynthetic: accidents.isSynthetic,
    })
    .from(accidents)
    .where(where)
    .orderBy(accidents.occurredAt)
    .limit(limit);
  return rows.map((r) => {
    const sev = meta.sevById.get(r.severityId);
    return {
      ...r,
      t: r.occurredAt.getTime(),
      reportedAt: r.reportedAt.getTime(),
      category: meta.catById.get(r.categoryId) ?? "other",
      severity: sev?.code ?? "pdo",
      severityRank: sev?.rank ?? 1,
    };
  });
}

export async function audit(actorId: number | null, action: string, entityType: string, entityId: string | number | null, details: Record<string, unknown> = {}) {
  await db.insert(auditLogs).values({ actorId, action, entityType, entityId: entityId === null ? null : String(entityId), details });
}

export async function networkNodes() {
  const dsId = await networkDatasetId();
  if (!dsId) return [];
  return db.select().from(roadNodes).where(eq(roadNodes.datasetId, dsId));
}

export function toLonLat(xy: XY): [number, number] {
  const [lon, lat] = fromUtm(xy[0], xy[1]);
  return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
}
