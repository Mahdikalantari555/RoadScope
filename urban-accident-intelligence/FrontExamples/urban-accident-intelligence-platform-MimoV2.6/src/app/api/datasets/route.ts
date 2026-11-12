import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDatasets, insertAudit } from "@/lib/repo";
import { seedDatabase } from "@/db/seed";
import { DEFAULT_CONFIG, type Scenario } from "@/lib/synthetic";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await listDatasets();
  return NextResponse.json({
    data,
    total: data.length,
    notice: "Datasets marked `isSynthetic` are generated, not observed.",
  });
}

const reseedSchema = z.object({
  scenario: z.enum(["uniform", "intersection_dominated", "rush_hour_dominated", "mixed"]).default("mixed"),
  seed: z.number().int().min(1).max(2 ** 31 - 1).default(DEFAULT_CONFIG.seed),
  accidentCount: z.number().int().min(100).max(12000).default(DEFAULT_CONFIG.accidentCount),
  actorName: z.string().min(2).max(80).default("Meridian Traffic Control"),
});

/**
 * Regenerate the synthetic corpus with a different scenario / seed.
 * Destructive: replaces the synthetic datasets only.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = reseedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 },
    );
  }
  const d = parsed.data;
  const result = await seedDatabase({
    ...DEFAULT_CONFIG,
    scenario: d.scenario as Scenario,
    seed: d.seed,
    accidentCount: d.accidentCount,
  });
  await insertAudit({
    actorRole: "administrator",
    actorName: d.actorName,
    action: "dataset.regenerate",
    entityType: "dataset_source",
    entityId: "synthetic-meridian",
    detail: { scenario: d.scenario, seed: d.seed, ...result },
  });
  return NextResponse.json({ ok: true, scenario: d.scenario, seed: d.seed, result });
}
