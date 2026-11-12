import { db } from "@/db";
import { accidents } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";
import { conflationCandidates, mapMatch } from "@/lib/analysis/mapmatch";

export const dynamic = "force-dynamic";

/** Real-time spatiotemporal conflation query: map-match the pin, then search the network neighbourhood (Δd_net, Δt). */
export async function POST(req: Request) {
  const loaded = await loadNetwork();
  if (!loaded) return Response.json({ candidates: [], matches: [] });
  const { lon, lat, occurredAt, uncertaintyRadiusM = 15, dMax = 250, dtMin = 90 } = await req.json();
  const { net, proj } = loaded;
  const p = proj.toXY(Number(lon), Number(lat));
  const cands = mapMatch(net, p, Number(uncertaintyRadiusM));
  const t = new Date(occurredAt ?? Date.now());
  if (!cands.length || isNaN(t.getTime())) return Response.json({ candidates: cands.map((c) => ({ ...c, lonlat: proj.toLonLat(c.point[0], c.point[1]) })), matches: [] });
  const best = cands[0];
  const rows = await db.select().from(accidents).where(and(
    eq(accidents.sourceId, loaded.source.id), isNull(accidents.canonicalId), inArray(accidents.status, ["raw", "verified", "flagged"]),
    gte(accidents.occurredAt, new Date(t.getTime() - dtMin * 60e3)), lte(accidents.occurredAt, new Date(t.getTime() + dtMin * 60e3)),
  ));
  const others = rows.filter((r) => r.segmentId && r.offsetM !== null).map((r) => ({ id: r.id, p: { segmentId: r.segmentId!, m: r.offsetM! }, t: r.occurredAt }));
  const hits = conflationCandidates(net, { segmentId: best.segmentId, m: best.m }, t, others, Number(dMax), Number(dtMin));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return Response.json({
    candidates: cands.map((c) => ({ ...c, lonlat: proj.toLonLat(c.point[0], c.point[1]) })),
    matches: hits.slice(0, 8).map((h) => { const r = byId.get(h.id)!; return { id: h.id, dNetM: +h.dNet.toFixed(1), dtMin: +h.dtMin.toFixed(1), kernel: +h.kernel.toFixed(3), status: r.status, severityId: r.severityId, categoryId: r.categoryId, occurredAt: r.occurredAt, witnessCount: r.witnessCount, credibility: r.credibility, lon: r.snapLon ?? r.rawLon, lat: r.snapLat ?? r.rawLat }; }),
    window: { dMaxM: dMax, dtMin },
  });
}
