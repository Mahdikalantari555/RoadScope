import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** GET job + result. ?format=geojson | csv for export of open-standard outputs. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, Number(id)));
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  const [res] = job.status === "done" ? await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.jobId, job.id)) : [];
  const format = new URL(req.url).searchParams.get("format");
  if (format === "geojson" && res?.geojson) {
    return new Response(JSON.stringify({ ...res.geojson, crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } }, metadata: { job: job.id, kind: job.kind, params: job.params, summary: res.summary } }), { headers: { "content-type": "application/geo+json", "content-disposition": `attachment; filename="uai_${job.kind}_${job.id}.geojson"` } });
  }
  if (format === "csv" && res) {
    const rows = Object.entries(res.lixelValues as Record<string, Record<string, unknown>>);
    if (job.kind === "ndbscan") {
      const cl = (res.lixelValues as { clusters?: { cluster: number; members: number[]; segmentIds: number[] }[] }).clusters ?? [];
      const csv = ["cluster,size,member_accident_ids,segment_ids", ...cl.map((c) => `${c.cluster},${c.members.length},"${c.members.join(" ")}","${c.segmentIds.join(" ")}"`)].join("\n");
      return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="uai_ndbscan_${job.id}.csv"` } });
    }
    const cols = rows.length ? Object.keys(rows[0][1]) : [];
    const csv = ["lixel_id," + cols.join(","), ...rows.map(([k, v]) => k + "," + cols.map((c) => String(v[c] ?? "")).join(","))].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv", "content-disposition": `attachment; filename="uai_${job.kind}_${job.id}.csv"` } });
  }
  return Response.json({ job, summary: res?.summary ?? null, geojson: res?.geojson ?? null, hasResult: !!res });
}
