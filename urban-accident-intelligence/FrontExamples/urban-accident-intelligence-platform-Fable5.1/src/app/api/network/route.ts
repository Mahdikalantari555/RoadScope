import { db } from "@/db";
import { accidentCategories, roadNodes, roadSegments, severityLevels } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getActiveSource } from "@/lib/geo/loader";

export const dynamic = "force-dynamic";

const g = globalThis as typeof globalThis & { __bootstrap?: Promise<unknown> };

/** Out-of-the-box: if no dataset exists, realise the default seeded point process once (single-flight). */
async function ensureBootstrapped() {
  const existing = await getActiveSource();
  if (existing) return;
  const { datasetSources } = await import("@/db/schema");
  const any = await db.select({ id: datasetSources.id }).from(datasetSources).limit(1);
  if (any.length) return;
  g.__bootstrap ??= import("@/lib/sim/generator").then((m) => m.runSimulation({})).finally(() => { g.__bootstrap = undefined; });
  await g.__bootstrap;
}

export async function GET() {
  try { await ensureBootstrapped(); } catch { /* surfaced as empty source */ }
  const source = await getActiveSource();
  const [cats, sevs] = await Promise.all([db.select().from(accidentCategories), db.select().from(severityLevels)]);
  if (!source) return Response.json({ source: null, categories: cats, severities: sevs, segments: { type: "FeatureCollection", features: [] }, nodes: { type: "FeatureCollection", features: [] } });
  const [segs, nodes] = await Promise.all([
    db.select().from(roadSegments).where(eq(roadSegments.sourceId, source.id)),
    db.select().from(roadNodes).where(eq(roadNodes.sourceId, source.id)),
  ]);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const nd of nodes) { w = Math.min(w, nd.lon); e = Math.max(e, nd.lon); s = Math.min(s, nd.lat); n = Math.max(n, nd.lat); }
  return Response.json({
    source, categories: cats, severities: sevs, bbox: [w, s, e, n],
    crs: { canonical: "EPSG:4326", metric: `Local azimuthal-equidistant plane @ (${source.originLon.toFixed(4)}, ${source.originLat.toFixed(4)}), metres` },
    segments: { type: "FeatureCollection", features: segs.map((g) => ({ type: "Feature", id: g.id, properties: { id: g.id, roadClass: g.roadClass, speedLimit: g.speedLimit, lanes: g.lanes, lengthM: Math.round(g.lengthM), aadt: g.aadt, sinuosity: +g.sinuosity.toFixed(3), oneway: g.oneway }, geometry: { type: "LineString", coordinates: g.coordsLonLat } })) },
    nodes: { type: "FeatureCollection", features: nodes.map((nd) => ({ type: "Feature", id: nd.id, properties: { id: nd.id, degree: nd.degree }, geometry: { type: "Point", coordinates: [nd.lon, nd.lat] } })) },
  });
}
