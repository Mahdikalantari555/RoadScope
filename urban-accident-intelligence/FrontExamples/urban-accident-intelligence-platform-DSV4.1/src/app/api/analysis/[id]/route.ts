import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { jsonError, jsonOk } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) return jsonError("Invalid job id.", 400);
  const jobs = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, jobId)).limit(1);
  if (jobs.length === 0) return jsonError("Analysis job not found.", 404);
  const results = await db
    .select({
      geometry: spatialAnalysisResults.geometry,
      value: spatialAnalysisResults.value,
      classification: spatialAnalysisResults.classification,
      rank: spatialAnalysisResults.rank,
      properties: spatialAnalysisResults.properties,
    })
    .from(spatialAnalysisResults)
    .where(eq(spatialAnalysisResults.jobId, jobId))
    .orderBy(asc(spatialAnalysisResults.rank))
    .limit(1500);
  return jsonOk({
    job: jobs[0],
    features: {
      type: "FeatureCollection",
      features: results.map((r) => ({
        type: "Feature",
        geometry: r.geometry,
        properties: { ...(r.properties as Record<string, unknown>), value: r.value, classification: r.classification, rank: r.rank },
      })),
    },
    reproducibility:
      "Job parameters, filters, seed-dependent input sample size and duration are persisted. Inputs are reproducible from the synthetic generator seed.",
  });
}
