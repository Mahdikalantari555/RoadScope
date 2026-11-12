import type { AnalysisMethod, Filters } from "@/lib/domain";
import { runAnalysis } from "@/lib/server/analysis";
import { handle, parseBody } from "@/lib/server/http";
import { analysisRequestSchema } from "@/lib/server/schemas";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** POST /api/analysis/run — synchronous (interactive) analysis for explorer layers. */
export const POST = handle(async (req: Request) => {
  await ensureSeeded();
  const b = await parseBody(req, analysisRequestSchema);
  const t0 = Date.now();
  const out = await runAnalysis(b.method as AnalysisMethod, b.params, b.filters as Filters);
  return Response.json({ ...out, summary: { ...out.summary, runtimeMs: Date.now() - t0 } });
});
