import { desc } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs } from "@/db/schema";
import type { AnalysisMethod, Filters } from "@/lib/domain";
import { currentUser } from "@/lib/server/auth";
import { handle, parseBody } from "@/lib/server/http";
import { createJob } from "@/lib/server/jobs";
import { analysisRequestSchema } from "@/lib/server/schemas";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const jobs = await db.select().from(spatialAnalysisJobs).orderBy(desc(spatialAnalysisJobs.createdAt)).limit(30);
  return Response.json({ items: jobs });
});

/** POST /api/analysis/jobs — enqueue an asynchronous analysis job (202 Accepted). */
export const POST = handle(async (req: Request) => {
  await ensureSeeded();
  const b = await parseBody(req, analysisRequestSchema);
  const user = await currentUser();
  const job = await createJob(b.method as AnalysisMethod, b.params, b.filters as Filters, user?.id ?? null);
  return Response.json(job, { status: 202 });
});
