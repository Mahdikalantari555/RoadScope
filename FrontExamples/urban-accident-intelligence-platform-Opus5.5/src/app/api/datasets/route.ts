import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidents, datasetSources } from "@/db/schema";
import { SCENARIOS } from "@/lib/domain";
import { requireAdmin } from "@/lib/server/auth";
import { handle, parseBody } from "@/lib/server/http";
import { ensureSeeded, regenerateSynthetic } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await ensureSeeded();
  const rows = await db
    .select({ id: datasetSources.id, code: datasetSources.code, name: datasetSources.name, kind: datasetSources.kind, description: datasetSources.description, scenario: datasetSources.scenario, seed: datasetSources.seed, crs: datasetSources.crs, license: datasetSources.license, isActive: datasetSources.isActive, config: datasetSources.config, createdAt: datasetSources.createdAt, records: count(accidents.id) })
    .from(datasetSources)
    .leftJoin(accidents, eq(accidents.datasetId, datasetSources.id))
    .groupBy(datasetSources.id)
    .orderBy(datasetSources.id);
  return Response.json({ items: rows });
});

const genSchema = z.object({
  scenario: z.enum(SCENARIOS.map((s) => s.code) as [string, ...string[]]),
  seed: z.number().int().min(1).max(1_000_000),
  accidents: z.number().int().min(200).max(8000).default(2600),
  duplicateRate: z.number().min(0).max(0.3).default(0.05),
  grossErrorRate: z.number().min(0).max(0.2).default(0.02),
  gpsSigmaM: z.number().min(0).max(100).default(12),
  pendingShare: z.number().min(0).max(0.8).default(0.12),
});

/** POST /api/datasets — regenerate the synthetic dataset (admin). Citizen reports are preserved and re-snapped. */
export const POST = handle(async (req: Request) => {
  const admin = await requireAdmin();
  const b = await parseBody(req, genSchema);
  const res = await regenerateSynthetic(b as Parameters<typeof regenerateSynthetic>[0], admin.id);
  return Response.json(res, { status: 201 });
});
