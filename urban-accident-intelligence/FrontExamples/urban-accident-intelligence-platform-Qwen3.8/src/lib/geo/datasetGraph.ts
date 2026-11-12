/** Cached loader: hydrates an in-memory RoadGraph from the spatial database. */
import { db } from "@/db";
import { and, asc, eq } from "drizzle-orm";
import { datasetSources, roadLixels, roadNodes, roadSegments } from "@/db/schema";
import { RoadGraph, type GraphLixel, type GraphNode, type GraphSegment } from "@/lib/geo/graph";
import { crsForOrigin, type ProjectedCrs } from "@/lib/geo/projection";
import type { DatasetSource } from "@/db/schema";

export interface DatasetContext {
  dataset: DatasetSource;
  graph: RoadGraph;
  crs: ProjectedCrs;
}

const globalForGraph = globalThis as typeof globalThis & { __uaiGraphCache?: Map<string, DatasetContext> };
const cache: Map<string, DatasetContext> = globalForGraph.__uaiGraphCache ?? new Map();
globalForGraph.__uaiGraphCache = cache;

export function invalidateDataset(datasetId: string): void {
  cache.delete(datasetId);
}

export function clearGraphCache(): void {
  cache.clear();
}

export async function listDatasets(): Promise<DatasetSource[]> {
  return db.select().from(datasetSources).orderBy(asc(datasetSources.createdAt));
}

export async function loadDataset(idOrSlug: string): Promise<DatasetContext | null> {
  const hit = cache.get(idOrSlug);
  if (hit) return hit;

  const rows = await db
    .select()
    .from(datasetSources)
    .where(eq(datasetSources.id, idOrSlug))
    .limit(1);
  let dataset = rows[0];
  if (!dataset) {
    const bySlug = await db.select().from(datasetSources).where(eq(datasetSources.slug, idOrSlug)).limit(1);
    dataset = bySlug[0];
  }
  if (!dataset) return null;

  const nodesRaw = await db.select().from(roadNodes).where(eq(roadNodes.datasetId, dataset.id));
  const segmentsRaw = await db.select().from(roadSegments).where(eq(roadSegments.datasetId, dataset.id));
  const lixelsRaw = await db
    .select()
    .from(roadLixels)
    .where(eq(roadLixels.datasetId, dataset.id))
    .orderBy(asc(roadLixels.segmentId), asc(roadLixels.lrsIndex));

  const nodes: GraphNode[] = nodesRaw.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    degree: n.degree,
    control: n.control,
    nodeType: n.nodeType,
    isGradeSeparated: n.isGradeSeparated,
  }));

  const segments: GraphSegment[] = segmentsRaw.map((s) => ({
    id: s.id,
    fromNodeId: s.fromNodeId,
    toNodeId: s.toNodeId,
    x1: s.x1,
    y1: s.y1,
    x2: s.x2,
    y2: s.y2,
    shape: (s.shape ?? [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) as Array<[number, number]>,
    lengthM: s.lengthM,
    roadClass: s.roadClass,
    classOrdinal: s.classOrdinal,
    name: s.name,
    lanes: s.lanes,
    speedLimitKph: s.speedLimitKph,
    aadt: s.aadt,
    sinuosity: s.sinuosity,
    curvaturePerKm: s.curvaturePerKm,
    lighting: s.lighting,
    surface: s.surface,
    isBridge: s.isBridge,
    sidewalk: s.sidewalk,
    cycleLane: s.cycleLane,
    vktPerDay: s.vktPerDay,
  }));

  const lixels: GraphLixel[] = lixelsRaw.map((l) => ({
    id: l.id,
    segmentId: l.segmentId,
    segmentIndex: 0,
    lrsIndex: l.lrsIndex,
    mStart: l.mStart,
    mEnd: l.mEnd,
    mMid: l.mMid,
    lengthM: l.lengthM,
    x: l.x,
    y: l.y,
    distToNodeM: l.distToNodeM,
    roadClass: l.roadClass,
    classOrdinal: l.classOrdinal,
    aadt: l.aadt,
    speedLimitKph: l.speedLimitKph,
    lanes: l.lanes,
    trueLambda: l.trueLambda,
  }));
  const segIndex = new Map(segments.map((s, i) => [s.id, i]));
  for (const l of lixels) l.segmentIndex = segIndex.get(l.segmentId) ?? -1;

  const graph = new RoadGraph(nodes, segments, lixels);
  const crs: ProjectedCrs = crsForOrigin(dataset.originLon, dataset.originLat);
  const ctx: DatasetContext = { dataset, graph, crs };
  if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  cache.set(dataset.id, ctx);
  cache.set(dataset.slug, ctx);
  return ctx;
}

export async function requireDataset(idOrSlug: string): Promise<DatasetContext> {
  const ctx = await loadDataset(idOrSlug);
  if (!ctx) throw new Response(JSON.stringify({ error: "dataset_not_found", dataset: idOrSlug }), { status: 404 });
  return ctx;
}

export async function datasetExists(): Promise<boolean> {
  const rows = await db.select({ id: datasetSources.id }).from(datasetSources).limit(1);
  return rows.length > 0;
}

export async function withDatasetFilter<T>(datasetId: string, table: typeof roadLixels, extra?: Parameters<typeof and>[0]) {
  void table;
  void extra;
  return and(eq(roadLixels.datasetId, datasetId));
}
