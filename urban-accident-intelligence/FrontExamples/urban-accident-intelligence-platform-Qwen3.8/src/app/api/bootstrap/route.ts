import { db } from "@/db";
import { sql } from "drizzle-orm";
import { accidents, auditLogs, datasetSources, riskEstimates, spatialAnalysisJobs, vgiReports } from "@/db/schema";
import { createSyntheticDataset, ensureBootstrap } from "@/lib/bootstrap";
import { ApiError, handleApiError, json } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/bootstrap — cold-start status of the spatial foundation. */
export async function GET() {
  try {
    const state = await ensureBootstrap();
    const [counts] = await db
      .select({
        datasets: sql<number>`(select count(*)::int from ${datasetSources})`,
        groundTruth: sql<number>`(select count(*)::int from ${accidents} where is_ground_truth)`,
        vgi: sql<number>`(select count(*)::int from ${accidents} where not is_ground_truth)`,
        reports: sql<number>`(select count(*)::int from ${vgiReports})`,
        jobs: sql<number>`(select count(*)::int from ${spatialAnalysisJobs})`,
        riskRows: sql<number>`(select count(*)::int from ${riskEstimates})`,
        audit: sql<number>`(select count(*)::int from ${auditLogs})`,
      })
      .from(datasetSources)
      .limit(1);
    return json({ ok: true, ...state, counts: counts ?? {} });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/bootstrap — materialise the default synthetic ground-truth dataset. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { scenario?: any; seed?: number; lixelLengthM?: number; force?: boolean };
    if (body.force !== true) {
      const existing = await db.select().from(datasetSources).limit(1);
      if (existing[0]) return json({ ok: true, reused: true, dataset: existing[0] });
    }
    const started = Date.now();
    const result = await createSyntheticDataset({
      scenario: body.scenario,
      seed: body.seed,
      lixelLengthM: body.lixelLengthM,
    });
    if (!result.dataset) throw new ApiError(500, "simulation_failed");
    return json({ ok: true, reused: result.reused, durationMs: Date.now() - started, dataset: result.dataset });
  } catch (err) {
    return handleApiError(err);
  }
}
