import { db } from "@/db";
import { desc } from "drizzle-orm";
import { datasetSources } from "@/db/schema";
import { createSyntheticDataset, seedReferenceData } from "@/lib/bootstrap";
import { resolveActor, writeAudit } from "@/lib/auth";
import { ApiError, handleApiError, json, readJson } from "@/lib/api";
import type { Scenario } from "@/lib/sim/intensity";
import { SCENARIO_LABELS } from "@/lib/sim/intensity";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCENARIOS = Object.keys(SCENARIO_LABELS) as Scenario[];

/** GET /api/datasets — dataset registry with provenance and record counts. */
export async function GET() {
  try {
    await seedReferenceData();
    const rows = await db.select().from(datasetSources).orderBy(desc(datasetSources.createdAt));
    return json({
      datasets: rows.map((d) => ({
        id: d.id,
        slug: d.slug,
        name: d.name,
        kind: d.kind,
        scenario: d.scenario,
        scenarioLabel: SCENARIO_LABELS[d.scenario as Scenario] ?? d.scenario,
        synthetic: d.kind === "synthetic",
        seed: d.seed,
        srid: d.srid,
        crsName: d.crsName,
        utmZone: d.utmZone,
        originLon: d.originLon,
        originLat: d.originLat,
        lixelLengthM: d.lixelLengthM,
        networkStats: d.networkStats,
        simParams: d.simParams,
        recordCounts: d.recordCounts,
        groundTruthAvailable: d.groundTruthAvailable,
        generatedAt: d.generatedAt,
        generatorVersion: d.generatorVersion,
      })),
      scenarios: SCENARIOS.map((s) => ({ code: s, label: SCENARIO_LABELS[s] })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/datasets — run the stochastic network ground-truth simulator. */
export async function POST(req: Request) {
  try {
    const actor = resolveActor(req);
    const body = await readJson(req);
    const scenario = (body.scenario ?? "multi_covariate_complex_urban") as Scenario;
    if (!SCENARIOS.includes(scenario)) throw new ApiError(400, "invalid_scenario", SCENARIOS);
    const seed = Number(body.seed ?? Math.floor(Math.random() * 1_000_000));
    if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31 - 1) throw new ApiError(400, "invalid_seed");
    const lixelLengthM = Number(body.lixelLengthM ?? 25);
    if (![10, 25, 50, 100].includes(lixelLengthM) && !(lixelLengthM >= 5 && lixelLengthM <= 500))
      throw new ApiError(400, "invalid_lixel_length", "lixelLengthM must be between 5 and 500 metres");
    const studyDays = Number(body.studyDays ?? 365);
    if (!(studyDays >= 30 && studyDays <= 1825)) throw new ApiError(400, "invalid_study_days");

    const started = Date.now();
    const { dataset, reused } = await createSyntheticDataset({ scenario, seed, lixelLengthM, studyDays, actorId: actor.id });
    await writeAudit({
      actor,
      entity: "dataset_sources",
      entityId: dataset.id,
      action: reused ? "dataset_reused" : "dataset_simulated",
      datasetId: dataset.id,
      severity: "notice",
      after: { scenario, seed, lixelLengthM, studyDays, durationMs: Date.now() - started },
      request: req,
    });
    return json({ ok: true, reused, durationMs: Date.now() - started, dataset }, { status: reused ? 200 : 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
