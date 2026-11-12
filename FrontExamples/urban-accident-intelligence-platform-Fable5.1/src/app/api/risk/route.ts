import { db } from "@/db";
import { roadSegments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { computeSegmentRisk, DEFAULT_WEIGHTS } from "@/lib/analysis/risk";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const w = { ...DEFAULT_WEIGHTS };
  for (const k of ["eb", "severity", "geometry", "environment"] as const) { const v = Number(sp.get(`w_${k}`)); if (!isNaN(v) && sp.get(`w_${k}`) !== null) w[k] = Math.max(0, Math.min(1, v)); }
  const includeRaw = sp.get("includeRaw") !== "false";
  const res = await computeSegmentRisk({ includeRaw, weights: w });
  if (!res) return Response.json({ error: "No active dataset" }, { status: 400 });
  const geoms = await db.select({ id: roadSegments.id, c: roadSegments.coordsLonLat }).from(roadSegments).where(eq(roadSegments.sourceId, res.source.id));
  const gm = new Map(geoms.map((g) => [g.id, g.c]));
  const geojson = { type: "FeatureCollection", features: res.segments.map((s) => ({ type: "Feature", id: s.segmentId, properties: { ...s, ebCI: undefined, ebLo: s.ebCI[0], ebHi: s.ebCI[1], coverageFlags: s.coverageFlags.join("|") }, geometry: { type: "LineString", coordinates: gm.get(s.segmentId) } })) };
  if (sp.get("format") === "csv") {
    const cols = ["rank", "segmentId", "roadClass", "lengthM", "aadt", "n", "nVerified", "nRaw", "density", "epdo", "ratePerMVKT", "spfMu", "ebExpected", "ebWeight", "psi", "ebVar", "composite", "uncertainty", "coverageFlags"] as const;
    const csv = [cols.join(","), ...res.segments.map((s) => cols.map((c) => { const v = s[c]; return Array.isArray(v) ? v.join("|") : typeof v === "number" ? v.toFixed(4) : String(v ?? ""); }).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="uai_risk_ranking.csv"` } });
  }
  return Response.json({ ...res, weights: w, includeRaw, geojson });
}
