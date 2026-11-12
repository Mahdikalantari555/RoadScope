import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { spatialAnalysisJobs } from "@/db/schema";
import { ApiError, bool, handleApiError, json, queryString, readJson } from "@/lib/api";
import { resolveActor, requirePermission } from "@/lib/auth";
import { listJobs, submitJob } from "@/lib/analysis/jobs";
import { METHODS, type Method } from "@/lib/analysis/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/analysis/jobs — job ledger with progress states. */
export async function GET(req: Request) {
  try {
    const q = queryString(req.url);
    const datasetId = q.get("datasetId") ?? undefined;
    const jobs = await listJobs(datasetId, Math.min(200, Number(q.get("limit") ?? 40)));
    return json({ jobs });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/analysis/jobs — submit an asynchronous geocomputation job.
 * Returns immediately with a job id unless `wait=1`; results are cached by a
 * content hash of (dataset, method, parameters).
 */
export async function POST(req: Request) {
  try {
    const actor = resolveActor(req);
    requirePermission(actor, "analysis:run");
    const body = await readJson(req);
    const datasetId = String(body.datasetId ?? "");
    const method = String(body.method ?? "") as Method;
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    if (!METHODS.includes(method)) throw new ApiError(400, "invalid_method", METHODS);
    if (method === "simulation") throw new ApiError(400, "simulation_is_a_dataset_operation", "use POST /api/datasets");

    const params = (body.params ?? {}) as Record<string, unknown>;
    if (params.bandwidthM !== undefined) {
      const h = Number(params.bandwidthM);
      if (!Number.isFinite(h) || h < 20 || h > 5000) throw new ApiError(400, "invalid_bandwidth", "bandwidthM must be within 20–5000 m");
    }
    if (params.epsilonM !== undefined) {
      const e = Number(params.epsilonM);
      if (!Number.isFinite(e) || e < 20 || e > 3000) throw new ApiError(400, "invalid_epsilon", "epsilonM must be within 20–3000 m");
    }
    if (params.minPoints !== undefined) {
      const m = Number(params.minPoints);
      if (!Number.isInteger(m) || m < 2 || m > 200) throw new ApiError(400, "invalid_min_points");
    }
    if (params.permutations !== undefined) {
      const p = Number(params.permutations);
      if (!Number.isInteger(p) || p < 99 || p > 1999) throw new ApiError(400, "invalid_permutations", "99–1999");
    }

    const wait = bool(new URLSearchParams(`w=${body.wait ?? req.headers.get("x-uai-wait") ?? "0"}`), "w", false);
    const submitted = await submitJob(datasetId, method, params as any, { requestedBy: actor.id ?? undefined, waitForCompletion: wait });
    const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, submitted.jobId)).orderBy(desc(spatialAnalysisJobs.createdAt)).limit(1);
    return json({ ok: true, ...submitted, job }, { status: 202 });
  } catch (err) {
    return handleApiError(err);
  }
}

