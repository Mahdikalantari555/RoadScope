import { z } from "zod";
import type { Filters } from "@/lib/domain";
import { computeRisk } from "@/lib/server/analysis";
import { handle, parseBody } from "@/lib/server/http";
import { filtersSchema } from "@/lib/server/schemas";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** POST /api/risk — transparent segment risk assessment (EB, EPDO, configurable relative index, rank uncertainty). */
export const POST = handle(async (req: Request) => {
  await ensureSeeded();
  const b = await parseBody(req, z.object({ filters: filtersSchema, config: z.record(z.string(), z.unknown()).default({}) }));
  const t0 = Date.now();
  const out = await computeRisk(b.filters as Filters, b.config);
  return Response.json({ ...out, runtimeMs: Date.now() - t0 });
});
