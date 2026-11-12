/**
 * Cached reference data: road network geometry, traffic exposure and hourly weather.
 * Network data is small and static, so it is cached per process and refreshed on demand.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { roadSegments, trafficObservations } from "@/db/schema";
import { buildSegmentGeoms, type SegmentGeom } from "@/lib/analysis/snapping";
import type { NetworkContext } from "@/lib/analysis/pipelines";
import type { RoadClass, SegmentRow } from "@/lib/domain";

export interface NetworkSnapshot extends NetworkContext {
  geoms: SegmentGeom[];
  segmentById: Map<number, SegmentRow>;
  loadedAt: number;
}

const TTL_MS = 5 * 60 * 1000;
let cache: NetworkSnapshot | null = null;
let inflight: Promise<NetworkSnapshot> | null = null;
let dataVersion = 1;

/** Incremented on every data mutation; part of analysis cache keys so results never go stale. */
export function currentDataVersion(): number {
  return dataVersion;
}

export function bumpDataVersion(): void {
  dataVersion++;
  cache = null;
}

export async function loadNetwork(): Promise<NetworkSnapshot> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache;
  if (!inflight) {
    inflight = buildSnapshot()
      .then((snapshot) => {
        cache = snapshot;
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

async function buildSnapshot(): Promise<NetworkSnapshot> {
  const rows = await db.select().from(roadSegments).orderBy(roadSegments.id);
  const segments: SegmentRow[] = rows.map((r) => ({
    id: r.id,
    code: r.segmentCode,
    name: r.name,
    roadClass: r.roadClass as RoadClass,
    speedLimitKmh: r.speedLimitKmh,
    lanes: r.lanes,
    lightingScore: r.lightingScore,
    lengthM: r.lengthM,
    startNodeId: r.startNodeId,
    endNodeId: r.endNodeId,
    midLon: r.midLon,
    midLat: r.midLat,
    lonLat: r.coordinates,
    utm: r.utmCoordinates,
  }));

  const trafficRows = await db
    .select({
      segmentId: trafficObservations.segmentId,
      aadt: sql<string>`avg(${trafficObservations.avgDailyVehicles})`,
    })
    .from(trafficObservations)
    .groupBy(trafficObservations.segmentId);
  const traffic = new Map<number, number>(trafficRows.map((t) => [t.segmentId, Number(t.aadt)]));

  const weather = await db.execute<{ hour: Date | string; precip: string | number }>(sql`
    select date_trunc('hour', observed_at) as hour, avg(precipitation_mm) as precip
    from environmental_observations
    group by 1
    order by 1
  `);
  const weatherHourly = new Map<number, number>(
    weather.rows.map((w) => [new Date(w.hour).getTime(), Number(w.precip)] as const),
  );

  return {
    segments,
    traffic,
    weatherHourly,
    geoms: buildSegmentGeoms(segments),
    segmentById: new Map(segments.map((s) => [s.id, s])),
    loadedAt: Date.now(),
  };
}
