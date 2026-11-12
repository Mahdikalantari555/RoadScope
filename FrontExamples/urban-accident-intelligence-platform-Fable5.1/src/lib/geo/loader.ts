import { db } from "@/db";
import { datasetSources, roadLixels, roadNodes, roadSegments } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { RoadNetwork, makeProjection, type Projection } from "./network";

export interface LoadedNetwork { source: typeof datasetSources.$inferSelect; net: RoadNetwork; proj: Projection; lixelLonLat: Map<number, [number, number][]> }

const g = globalThis as typeof globalThis & { __netCache?: Map<number, { at: number; v: LoadedNetwork }> };
g.__netCache ??= new Map();

export function invalidateNetworkCache() { g.__netCache!.clear(); }

export async function getActiveSource() {
  const [s] = await db.select().from(datasetSources).where(eq(datasetSources.isActive, true)).orderBy(desc(datasetSources.id)).limit(1);
  return s ?? null;
}

export async function loadNetwork(sourceId?: number): Promise<LoadedNetwork | null> {
  const source = sourceId
    ? (await db.select().from(datasetSources).where(eq(datasetSources.id, sourceId)))[0]
    : await getActiveSource();
  if (!source) return null;
  const cached = g.__netCache!.get(source.id);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.v;
  const [nodes, segs, lix] = await Promise.all([
    db.select().from(roadNodes).where(eq(roadNodes.sourceId, source.id)),
    db.select().from(roadSegments).where(eq(roadSegments.sourceId, source.id)),
    db.select().from(roadLixels).where(eq(roadLixels.sourceId, source.id)),
  ]);
  const net = new RoadNetwork(
    nodes.map((n) => ({ id: n.id, xy: [n.x, n.y], degree: 0 })),
    segs.map((s) => ({ id: s.id, from: s.fromNodeId, to: s.toNodeId, length: s.lengthM, coords: s.coordsXY, roadClass: s.roadClass, aadt: s.aadt, speedLimit: s.speedLimit, lanes: s.lanes, sinuosity: s.sinuosity })),
    lix.map((l) => ({ id: l.id, segmentId: l.segmentId, idx: l.idx, mStart: l.mStart, mEnd: l.mEnd, length: l.lengthM, mid: [l.midX, l.midY] })),
  );
  const lixelLonLat = new Map<number, [number, number][]>();
  for (const l of lix) lixelLonLat.set(l.id, l.coordsLonLat);
  const v: LoadedNetwork = { source, net, proj: makeProjection(source.originLon, source.originLat), lixelLonLat };
  g.__netCache!.set(source.id, { at: Date.now(), v });
  return v;
}
