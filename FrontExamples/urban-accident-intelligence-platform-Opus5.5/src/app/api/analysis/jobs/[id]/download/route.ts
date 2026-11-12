import { eq } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { ApiError, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== "ids");
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** GET /api/analysis/jobs/:id/download?format=geojson|csv|json — export analysis outputs with provenance. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const format = new URL(req.url).searchParams.get("format") ?? "geojson";
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, id));
  const [res] = await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.jobId, id));
  if (!job || !res) throw new ApiError(404, "Result not available");
  const name = `uai-${job.method}-job${id}`;
  const provenance = { generator: "Urban Accident Intelligence", jobId: id, method: job.method, params: job.params, filters: job.filters, createdAt: job.createdAt, crs: "EPSG:4326", note: "Derived from SYNTHETIC data unless stated otherwise." };
  if (format === "csv") {
    const rows = res.table?.length ? res.table : ((res.geojson as { features?: { properties: Record<string, unknown> }[] } | null)?.features ?? []).map((f) => f.properties);
    return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${name}.csv"` } });
  }
  if (format === "json") return new Response(JSON.stringify({ provenance, summary: res.summary, table: res.table }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}-summary.json"` } });
  const fc = (res.geojson as Record<string, unknown> | null) ?? { type: "FeatureCollection", features: [] };
  return new Response(JSON.stringify({ ...fc, metadata: provenance }), { headers: { "Content-Type": "application/geo+json", "Content-Disposition": `attachment; filename="${name}.geojson"` } });
});
