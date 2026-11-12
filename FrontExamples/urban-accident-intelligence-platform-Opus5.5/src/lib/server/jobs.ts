/** Asynchronous spatial analysis jobs (persisted state + background execution). */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import type { AnalysisMethod, Filters } from "@/lib/domain";
import { runAnalysis } from "./analysis";
import { audit } from "./data";
import { log } from "./http";

export async function createJob(method: AnalysisMethod, params: Record<string, unknown>, filters: Filters, userId: number | null) {
  const [job] = await db.insert(spatialAnalysisJobs).values({ method, params, filters: filters as Record<string, unknown>, createdBy: userId, message: "Queued" }).returning();
  setTimeout(() => void processJob(job.id), 0);
  await audit(userId, "analysis.submit", "spatial_analysis_job", job.id, { method });
  return job;
}

async function processJob(id: number) {
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, id));
  if (!job) return;
  const t0 = Date.now();
  await db.update(spatialAnalysisJobs).set({ status: "running", startedAt: new Date(), progress: 5, message: "Starting" }).where(eq(spatialAnalysisJobs.id, id));
  try {
    const out = await runAnalysis(job.method as AnalysisMethod, job.params, job.filters as Filters, async (p, message) => {
      await db.update(spatialAnalysisJobs).set({ progress: p, message }).where(eq(spatialAnalysisJobs.id, id));
    });
    await db.insert(spatialAnalysisResults).values({ jobId: id, summary: { ...out.summary, runtimeMs: Date.now() - t0 }, geojson: out.geojson as Record<string, unknown> | null, table: out.table });
    await db.update(spatialAnalysisJobs).set({ status: "succeeded", progress: 100, message: "Completed", finishedAt: new Date() }).where(eq(spatialAnalysisJobs.id, id));
    log("info", "Analysis job completed", { id, method: job.method, ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(spatialAnalysisJobs).set({ status: "failed", error: msg, message: "Failed", finishedAt: new Date() }).where(eq(spatialAnalysisJobs.id, id));
    log("error", "Analysis job failed", { id, error: msg });
  }
}
