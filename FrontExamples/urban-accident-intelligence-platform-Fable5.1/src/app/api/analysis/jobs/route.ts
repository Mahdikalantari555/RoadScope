import { db } from "@/db";
import { spatialAnalysisJobs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getActiveSource } from "@/lib/geo/loader";
import { enqueueJob, type JobParams } from "@/lib/analysis/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const source = await getActiveSource();
  if (!source) return Response.json({ jobs: [] });
  const jobs = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.sourceId, source.id)).orderBy(desc(spatialAnalysisJobs.id)).limit(40);
  return Response.json({ jobs });
}

export async function POST(req: Request) {
  const source = await getActiveSource();
  if (!source) return Response.json({ error: "No active dataset" }, { status: 400 });
  const b = (await req.json()) as Partial<JobParams>;
  if (!["nkde", "gistar", "ndbscan", "benchmark"].includes(String(b.kind))) return Response.json({ error: "invalid kind" }, { status: 422 });
  const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return isNaN(n) || v === undefined || v === null ? d : Math.min(hi, Math.max(lo, n)); };
  const params: JobParams = {
    kind: b.kind as JobParams["kind"],
    bandwidth: clamp(b.bandwidth, 20, 1000, 150), kernel: (["gaussian", "epanechnikov", "quartic"].includes(String(b.kernel)) ? b.kernel : "gaussian") as JobParams["kernel"],
    includeRaw: !!b.includeRaw, planarCompare: b.planarCompare !== false, severityWeighted: !!b.severityWeighted,
    delta: clamp(b.delta, 30, 1000, 200), weightMode: b.weightMode === "binary" ? "binary" : "gaussian", permutations: clamp(b.permutations, 0, 999, 199), variable: b.variable === "nkde" ? "nkde" : "count",
    eps: clamp(b.eps, 10, 1000, 120), minPts: clamp(b.minPts, 2, 50, 4), topFraction: clamp(b.topFraction, 0.01, 0.5, 0.1),
  };
  const job = await enqueueJob(source.id, params);
  return Response.json({ ok: true, job });
}
