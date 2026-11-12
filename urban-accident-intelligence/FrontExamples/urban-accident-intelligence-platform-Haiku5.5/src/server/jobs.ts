/**
 * Asynchronous spatial analysis jobs. Requests are persisted with status and progress, executed in
 * the background, and their results are stored and cached by a content-derived key.
 */
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import type { AnalysisResultView, JobView, SessionUser } from "@/lib/api-types";
import type { AnalysisType } from "@/lib/domain";
import { runAnalysis, type Params } from "@/lib/analysis/pipelines";
import { filtersKey, type FilterSpec } from "@/lib/filters";
import { observationYears } from "./observation";
import { loadAccidentPoints } from "./accidents";
import { currentDataVersion, loadNetwork } from "./geo-data";
import { logger } from "./logger";
import { ApiError } from "./http";

const CACHE_VERSION = "analysis-v1";
const CACHE_WINDOW_MS = 30 * 60 * 1000;

type JobRow = typeof spatialAnalysisJobs.$inferSelect;

function cacheKeyFor(type: AnalysisType, params: Params, filters: FilterSpec): string {
  const payload = JSON.stringify({ v: CACHE_VERSION, type, params, filters: filtersKey(filters), data: currentDataVersion() });
  return createHash("sha256").update(payload).digest("hex");
}

function toView(job: JobRow, result: { payload: Record<string, unknown>; featureCollection: Record<string, unknown> | null } | null, cached: boolean): JobView {
  let resultView: AnalysisResultView | null = null;
  if (result) {
    const p = result.payload as { summary?: AnalysisResultView["summary"]; table?: AnalysisResultView["table"]; methodology?: AnalysisResultView["methodology"]; notes?: string[] };
    resultView = {
      kind: job.analysisType as AnalysisType,
      featureCollection: (result.featureCollection as AnalysisResultView["featureCollection"]) ?? null,
      summary: p.summary ?? {},
      table: p.table ?? [],
      methodology: p.methodology!,
      notes: p.notes ?? [],
    };
  }
  return {
    id: job.id,
    analysisType: job.analysisType as AnalysisType,
    status: job.status,
    progress: job.progress,
    progressMessage: job.progressMessage,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    cached,
    params: job.params,
    filters: job.filters,
    result: resultView,
  };
}

export async function getJob(id: string): Promise<JobView> {
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, id)).limit(1);
  if (!job) throw new ApiError(404, "not_found", "Analysis job not found");
  const [result] = await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.jobId, id)).limit(1);
  return toView(job, result ? { payload: result.payload, featureCollection: result.featureCollection } : null, false);
}

export async function listJobs(limit: number): Promise<JobView[]> {
  const rows = await db.select().from(spatialAnalysisJobs).orderBy(desc(spatialAnalysisJobs.createdAt)).limit(limit);
  return rows.map((job) => toView(job, null, false));
}

export async function submitJob(input: {
  type: AnalysisType;
  params: Params;
  filters: FilterSpec;
  user: SessionUser | null;
}): Promise<JobView> {
  const cacheKey = cacheKeyFor(input.type, input.params, input.filters);
  const [cached] = await db
    .select()
    .from(spatialAnalysisJobs)
    .where(and(eq(spatialAnalysisJobs.cacheKey, cacheKey), eq(spatialAnalysisJobs.status, "completed")))
    .orderBy(desc(spatialAnalysisJobs.createdAt))
    .limit(1);
  if (cached && Date.now() - cached.createdAt.getTime() < CACHE_WINDOW_MS) {
    const [result] = await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.jobId, cached.id)).limit(1);
    return toView(cached, result ? { payload: result.payload, featureCollection: result.featureCollection } : null, true);
  }

  const [job] = await db
    .insert(spatialAnalysisJobs)
    .values({
      analysisType: input.type,
      cacheKey,
      params: input.params,
      filters: JSON.parse(JSON.stringify(input.filters)) as Record<string, unknown>,
      status: "queued",
      progress: 0,
      progressMessage: "Queued",
      requestedByUserId: input.user?.id ?? null,
    })
    .returning();
  logger.info("analysis.queued", { jobId: job!.id, type: input.type });
  setImmediate(() => {
    void executeJob(job!.id, input.type, input.params, input.filters);
  });
  return toView(job!, null, false);
}

async function updateJob(id: string, values: Partial<typeof spatialAnalysisJobs.$inferInsert>): Promise<void> {
  await db.update(spatialAnalysisJobs).set(values).where(eq(spatialAnalysisJobs.id, id));
}

async function executeJob(id: string, type: AnalysisType, params: Params, filters: FilterSpec): Promise<void> {
  const started = Date.now();
  try {
    await updateJob(id, { status: "running", startedAt: new Date(), progress: 0.05, progressMessage: "Loading accidents and network" });
    const [points, network] = await Promise.all([loadAccidentPoints(filters), loadNetwork()]);
    const output = runAnalysis(
      type,
      { points, network, observationYears: observationYears(points) },
      params,
      (progress, message) => {
        // Progress is advisory; failures to persist it must not abort the analysis.
        void updateJob(id, { progress: Math.min(0.99, Math.max(0, progress)), progressMessage: message }).catch(() => undefined);
      },
    );
    await db.insert(spatialAnalysisResults).values({
      jobId: id,
      resultKind: type,
      featureCollection: output.featureCollection as Record<string, unknown> | null,
      payload: { summary: output.summary, table: output.table, methodology: output.methodology, notes: output.notes } as unknown as Record<string, unknown>,
    });
    const ms = Date.now() - started;
    await updateJob(id, { status: "completed", progress: 1, progressMessage: `Completed in ${ms} ms`, finishedAt: new Date() });
    logger.info("analysis.completed", { jobId: id, type, ms, events: points.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    logger.error("analysis.failed", { jobId: id, type, error });
    await updateJob(id, { status: "failed", errorMessage: message, progressMessage: "Failed", finishedAt: new Date() });
  }
}

export async function exportJob(id: string, format: "geojson" | "csv"): Promise<{ body: string; contentType: string; filename: string }> {
  const view = await getJob(id);
  if (view.status !== "completed" || !view.result) throw new ApiError(409, "not_ready", "The analysis has not completed yet");
  const base = `${view.analysisType}-${id.slice(0, 8)}`;
  if (format === "geojson") {
    return {
      body: JSON.stringify(view.result.featureCollection ?? { type: "FeatureCollection", features: [] }, null, 2),
      contentType: "application/geo+json; charset=utf-8",
      filename: `${base}.geojson`,
    };
  }
  const rows: Record<string, unknown>[] =
    view.result.table.length > 0
      ? (view.result.table as Record<string, unknown>[])
      : (view.result.featureCollection?.features ?? []).map((f) => {
          const flat: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(f.properties)) {
            if (v === null || typeof v !== "object") flat[k] = v;
          }
          return flat;
        });
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [keys.join(","), ...rows.map((r) => keys.map((k) => escape(r[k])).join(","))].join("\n");
  return { body, contentType: "text/csv; charset=utf-8", filename: `${base}.csv` };
}
