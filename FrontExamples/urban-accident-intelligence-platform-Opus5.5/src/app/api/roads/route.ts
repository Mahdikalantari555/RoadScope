import { DEFAULT_ANALYSIS_STATUSES } from "@/lib/domain";
import { segmentAggregation } from "@/lib/server/analysis";
import { getNetwork, loadAccidents } from "@/lib/server/data";
import { handle, parseFilters } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** GET /api/roads — road network as GeoJSON LineStrings, optionally with accident aggregation (`stats=1`). */
export const GET = handle(async (req: Request) => {
  await ensureSeeded();
  const sp = new URL(req.url).searchParams;
  const net = await getNetwork();
  if (!net) return Response.json({ type: "FeatureCollection", features: [] });
  let stats: Map<number, ReturnType<typeof segmentAggregation>[number]> | null = null;
  if (sp.get("stats") === "1") {
    const f = parseFilters(sp);
    const rows = await loadAccidents(f, { statuses: DEFAULT_ANALYSIS_STATUSES });
    const span = rows.length ? Math.max(1 / 12, ((f.to ? Date.parse(f.to) : rows[rows.length - 1].t) - (f.from ? Date.parse(f.from) : rows[0].t)) / (365.25 * 86400000)) : 1;
    stats = new Map(segmentAggregation(rows, net.segments, span).map((a) => [a.id, a]));
  }
  return Response.json({
    type: "FeatureCollection",
    features: net.segments.map((s) => ({
      type: "Feature",
      id: s.id,
      geometry: { type: "LineString", coordinates: s.geom },
      properties: { id: s.id, name: s.name, roadClass: s.roadClass, speedLimit: s.speedLimit, lanes: s.lanes, lit: s.lit, surface: s.surface, lengthM: Math.round(s.lengthM), aadt: s.aadt, ...(stats ? { n: stats.get(s.id)?.n ?? 0, densityKmYr: stats.get(s.id)?.densityKmYr ?? 0, epdo: stats.get(s.id)?.epdo ?? 0 } : {}) },
    })),
  });
});
