import { eq } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { ApiError, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/analysis/jobs/:id — job status; includes result when succeeded. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, id));
  if (!job) throw new ApiError(404, "Job not found");
  const [result] = job.status === "succeeded" ? await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.jobId, id)) : [];
  return Response.json({ job, result: result ?? null });
});
