/**
 * Asynchronous geocomputation runner: job lifecycle, progress reporting,
 * result caching by content hash and immutable provenance.
 */
import { createHash } from "node:crypto";
import { db } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { auditLogs, spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { loadDataset } from "@/lib/geo/datasetGraph";
import { runMethod } from "@/lib/analysis/methods";
import type { AnalysisParams, Method } from "@/lib/analysis/types";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function cacheKey(datasetId: string, method: Method, params: AnalysisParams): string {
  return createHash("sha256").update(`${datasetId}|${method}|${stableStringify(params)}`).digest("hex");
}

const runners = (globalThis as any).__uaiJobRunners as Map<string, Promise<void>> | undefined;
const runnerMap: Map<string, Promise<void>> = runners ?? new Map();
(globalThis as any).__uaiJobRunners = runnerMap;

export interface SubmitResult {
  jobId: string;
  cached: boolean;
  status: string;
  resultId: string | null;
}

export async function submitJob(
  datasetId: string,
  method: Method,
  params: AnalysisParams,
  options: { requestedBy?: string; waitForCompletion?: boolean } = {},
): Promise<SubmitResult> {
  const key = cacheKey(datasetId, method, params);
  const existing = await db
    .select()
    .from(spatialAnalysisJobs)
    .where(and(eq(spatialAnalysisJobs.cacheKey, key), eq(spatialAnalysisJobs.status, "succeeded")))
    .orderBy(desc(spatialAnalysisJobs.createdAt))
    .limit(1);
  if (existing[0]?.resultId) {
    return { jobId: existing[0].id, cached: true, status: "succeeded", resultId: existing[0].resultId };
  }

  const [job] = await db
    .insert(spatialAnalysisJobs)
    .values({
      datasetId,
      method,
      params: params as Record<string, unknown>,
      cacheKey: key,
      status: "queued",
      stage: "queued",
      requestedBy: options.requestedBy ?? null,
    })
    .returning();

  const promise = executeJob(job.id).catch((err) => {
    console.error("[job] execution failed", job.id, err);
  });
  runnerMap.set(job.id, promise);
  if (options.waitForCompletion) {
    await promise;
    const [done] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, job.id)).limit(1);
    return { jobId: job.id, cached: false, status: done?.status ?? "failed", resultId: done?.resultId ?? null };
  }
  return { jobId: job.id, cached: false, status: "queued", resultId: null };
}

export async function executeJob(jobId: string): Promise<void> {
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, jobId)).limit(1);
  if (!job) throw new Error("job_not_found");
  const started = Date.now();
  await db
    .update(spatialAnalysisJobs)
    .set({ status: "running", startedAt: new Date(), stage: "initialising", progress: 0.02 })
    .where(eq(spatialAnalysisJobs.id, jobId));

  let lastWrite = 0;
  try {
    const ctx = await loadDataset(job.datasetId);
    if (!ctx) throw new Error("dataset_not_found");
    const payload = await runMethod(ctx, job.method as Method, job.params as AnalysisParams, async (progress, stage) => {
      const now = Date.now();
      if (now - lastWrite < 220 && progress < 0.99) return;
      lastWrite = now;
      await db.update(spatialAnalysisJobs).set({ progress, stage }).where(eq(spatialAnalysisJobs.id, jobId));
    });

    const [result] = await db
      .insert(spatialAnalysisResults)
      .values({
        jobId,
        datasetId: job.datasetId,
        method: job.method,
        params: job.params as Record<string, unknown>,
        srid: ctx.crs.srid,
        crsName: ctx.crs.name,
        sampleSize: payload.sampleSize,
        unitCount: payload.unitCount,
        runtimeMs: Date.now() - started,
        features: payload.features as unknown as Record<string, unknown>,
        stats: payload.stats,
        benchmark: payload.benchmark,
        formulation: payload.formulation,
      })
      .returning();

    await db
      .update(spatialAnalysisJobs)
      .set({
        status: "succeeded",
        progress: 1,
        stage: "complete",
        resultId: result.id,
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      })
      .where(eq(spatialAnalysisJobs.id, jobId));

    await db.insert(auditLogs).values({
      actorId: job.requestedBy,
      actorRole: "researcher",
      entity: "spatial_analysis_jobs",
      entityId: jobId,
      action: "analysis_completed",
      datasetId: job.datasetId,
      severity: "info",
      after: { method: job.method, runtimeMs: Date.now() - started, unitCount: payload.unitCount, sampleSize: payload.sampleSize },
    });
  } catch (err) {
    await db
      .update(spatialAnalysisJobs)
      .set({
        status: "failed",
        stage: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
        durationMs: Date.now() - started,
      })
      .where(eq(spatialAnalysisJobs.id, jobId));
    await db.insert(auditLogs).values({
      actorId: job.requestedBy,
      actorRole: "researcher",
      entity: "spatial_analysis_jobs",
      entityId: jobId,
      action: "analysis_failed",
      datasetId: job.datasetId,
      severity: "warning",
      after: { method: job.method, error: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    runnerMap.delete(jobId);
  }
}

export async function getJob(jobId: string) {
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, jobId)).limit(1);
  if (!job) return null;
  const result = job.resultId
    ? ((await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.id, job.resultId)).limit(1))[0] ?? null)
    : null;
  return { job, result };
}

export async function listJobs(datasetId?: string, limit = 40) {
  const conds = datasetId ? [eq(spatialAnalysisJobs.datasetId, datasetId)] : [];
  return db
    .select({
      id: spatialAnalysisJobs.id,
      method: spatialAnalysisJobs.method,
      status: spatialAnalysisJobs.status,
      progress: spatialAnalysisJobs.progress,
      stage: spatialAnalysisJobs.stage,
      error: spatialAnalysisJobs.error,
      createdAt: spatialAnalysisJobs.createdAt,
      durationMs: spatialAnalysisJobs.durationMs,
      resultId: spatialAnalysisJobs.resultId,
      params: spatialAnalysisJobs.params,
      datasetId: spatialAnalysisJobs.datasetId,
    })
    .from(spatialAnalysisJobs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(spatialAnalysisJobs.createdAt))
    .limit(limit);
}
