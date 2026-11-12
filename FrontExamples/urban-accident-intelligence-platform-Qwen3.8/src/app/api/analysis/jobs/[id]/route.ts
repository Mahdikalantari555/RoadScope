import { eq } from "drizzle-orm";
import { spatialAnalysisResults } from "@/db/schema";
import { ApiError, bool, handleApiError, json, queryString } from "@/lib/api";
import { executeJob, getJob } from "@/lib/analysis/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/analysis/jobs/:id — job status, progress, provenance and (optionally)
 * the full result payload. `features=0` returns statistics only, which the
 * dashboard uses for cheap polling.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const q = queryString(req.url);
    const withFeatures = bool(q, "features", true);
    const found = await getJob(id);
    if (!found) throw new ApiError(404, "job_not_found");
    const { job, result } = found;

    // Self-healing: if a queued job lost its runner (process restart), re-execute.
    if (job.status === "queued" || job.status === "running") {
      const ageMs = Date.now() - (job.startedAt ?? job.createdAt).getTime();
      if (ageMs > 15000) {
        await executeJob(job.id);
        const retry = await getJob(id);
        return respond(retry!.job, retry!.result, withFeatures);
      }
    }
    return respond(job, result, withFeatures);
  } catch (err) {
    return handleApiError(err);
  }
}

function respond(job: any, result: typeof spatialAnalysisResults.$inferSelect | null, withFeatures: boolean) {
  return json({
    job: {
      id: job.id,
      datasetId: job.datasetId,
      method: job.method,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error,
      params: job.params,
      cacheKey: job.cacheKey,
      requestedBy: job.requestedBy,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: job.durationMs,
      resultId: job.resultId,
    },
    result: result
      ? {
          id: result.id,
          method: result.method,
          params: result.params,
          srid: result.srid,
          crsName: result.crsName,
          sampleSize: result.sampleSize,
          unitCount: result.unitCount,
          runtimeMs: result.runtimeMs,
          stats: result.stats,
          benchmark: result.benchmark,
          formulation: result.formulation,
          createdAt: result.createdAt,
          features: withFeatures ? result.features : undefined,
          featureCount: withFeatures ? undefined : ((result.features as any)?.features?.length ?? 0),
        }
      : null,
  });
}

