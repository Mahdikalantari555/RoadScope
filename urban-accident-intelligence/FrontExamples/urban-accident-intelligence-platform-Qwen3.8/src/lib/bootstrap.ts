/**
 * Cold-start bootstrap: reference vocabularies, persona accounts, synthetic
 * citizen contributors and (on demand) a default seeded synthetic dataset so
 * the platform is scientifically usable out-of-the-box with zero external data.
 */
import { db } from "@/db";
import { eq, sql } from "drizzle-orm";
import { accidentCategories, auditLogs, datasetSources, severityLevels, users } from "@/db/schema";
import { CATEGORIES, CITIZEN_NAMES, PERSONAS, SEVERITIES } from "@/lib/domain/taxonomy";
import { simulateDataset, type SimulateInput } from "@/lib/sim/simulate";
import type { Scenario } from "@/lib/sim/intensity";
import { clearGraphCache } from "@/lib/geo/datasetGraph";

export interface SeedResult {
  severityIds: Record<string, string>;
  categoryIds: Record<string, string>;
  contributorIds: string[];
  stewardId: string | null;
  created: boolean;
}

export async function seedReferenceData(): Promise<SeedResult> {
  const existingSeverity = await db.select().from(severityLevels);
  const severityIds: Record<string, string> = {};
  if (existingSeverity.length === 0) {
    const rows = await db
      .insert(severityLevels)
      .values(SEVERITIES.map((s) => ({ code: s.code, label: s.label, rank: s.rank, epdoWeight: s.epdoWeight, injuryWeight: s.injuryWeight, color: s.color, sortOrder: s.sortOrder })))
      .returning();
    for (const r of rows) severityIds[r.code] = r.id;
  } else {
    for (const r of existingSeverity) severityIds[r.code] = r.id;
  }

  const existingCat = await db.select().from(accidentCategories);
  const categoryIds: Record<string, string> = {};
  if (existingCat.length === 0) {
    const rows = await db
      .insert(accidentCategories)
      .values(CATEGORIES.map((c) => ({ code: c.code, label: c.label, description: c.description, reportingPropensity: c.reportingPropensity, sortOrder: c.sortOrder })))
      .returning();
    for (const r of rows) categoryIds[r.code] = r.id;
  } else {
    for (const r of existingCat) categoryIds[r.code] = r.id;
  }

  const existingUsers = await db.select().from(users);
  const byEmail = new Map(existingUsers.map((u) => [u.email, u]));
  const contributorIds: string[] = [];
  let stewardId: string | null = null;

  for (const p of PERSONAS) {
    const found = byEmail.get(p.email);
    if (found) {
      if (p.role === "data_steward") stewardId = found.id;
      continue;
    }
    const [u] = await db
      .insert(users)
      .values({ email: p.email, displayName: p.displayName, role: p.role, permissions: p.permissions, isSyntheticActor: p.synthetic })
      .returning();
    byEmail.set(p.email, u);
    if (p.role === "data_steward") stewardId = u.id;
  }

  for (let i = 0; i < CITIZEN_NAMES.length; i++) {
    const email = `citizen${String(i + 1).padStart(3, "0")}@vgi.city`;
    const found = byEmail.get(email);
    if (found) {
      contributorIds.push(found.id);
      continue;
    }
    const [u] = await db
      .insert(users)
      .values({
        email,
        displayName: CITIZEN_NAMES[i],
        role: "citizen_reporter",
        permissions: ["report:create", "report:read_own"],
        isSyntheticActor: true,
      })
      .returning();
    contributorIds.push(u.id);
  }

  return { severityIds, categoryIds, contributorIds, stewardId, created: existingSeverity.length === 0 };
}

export async function ensureBootstrap(): Promise<{ ready: boolean; datasets: number; seeded: boolean }> {
  const seeded = await seedReferenceData();
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(datasetSources);
  return { ready: (row?.c ?? 0) > 0, datasets: row?.c ?? 0, seeded: seeded.created };
}

export interface CreateDatasetInput {
  name?: string;
  scenario?: Scenario;
  seed?: number;
  lixelLengthM?: number;
  studyDays?: number;
  actorId?: string | null;
}

export async function createSyntheticDataset(input: CreateDatasetInput = {}) {
  const ref = await seedReferenceData();
  const scenario: Scenario = input.scenario ?? "multi_covariate_complex_urban";
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000);
  const lixelLengthM = input.lixelLengthM ?? 25;
  const slug = `synthetic-${scenario.replace(/_/g, "-")}-${seed}-${lixelLengthM}m`;
  const existing = await db.select().from(datasetSources).where(eq(datasetSources.slug, slug)).limit(1);
  if (existing[0]) return { dataset: existing[0], reused: true };

  const simInput: SimulateInput = {
    name: input.name ?? `Synthetic Urban Network — ${scenario.replace(/_/g, " ")} (seed ${seed})`,
    slug,
    scenario,
    seed,
    lixelLengthM,
    severityIds: ref.severityIds,
    categoryIds: ref.categoryIds,
    contributorIds: ref.contributorIds,
    studyDays: input.studyDays ?? 365,
    actorId: input.actorId ?? undefined,
  };
  const dataset = await simulateDataset(simInput);
  clearGraphCache();
  await db.insert(auditLogs).values({
    actorId: input.actorId ?? null,
    actorRole: "simulation_scientist",
    entity: "dataset_sources",
    entityId: dataset.id,
    action: "dataset_created",
    datasetId: dataset.id,
    severity: "notice",
    after: { scenario, seed, lixelLengthM, synthetic: true },
  });
  return { dataset, reused: false };
}
