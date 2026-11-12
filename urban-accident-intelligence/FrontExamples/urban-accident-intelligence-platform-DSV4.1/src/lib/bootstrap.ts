/** Runtime bootstrap: creates tables if missing and seeds the synthetic dataset once. */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DDL_STATEMENTS } from "@/db/ddl";
import { datasetSources } from "@/db/schema";
import { seedDatabase } from "@/lib/seed/run";

let bootstrapPromise: Promise<void> | null = null;

async function runBootstrap(): Promise<void> {
  for (const statement of DDL_STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  const existing = await db
    .select({ id: datasetSources.id })
    .from(datasetSources)
    .limit(1);
  if (existing.length > 0) return;
  // Cross-process guard so parallel cold starts do not double-seed.
  await db.execute(sql`select pg_advisory_lock(918273645)`);
  try {
    const check = await db.select({ id: datasetSources.id }).from(datasetSources).limit(1);
    if (check.length === 0) await seedDatabase();
  } finally {
    await db.execute(sql`select pg_advisory_unlock(918273645)`);
  }
}

export function ensureBootstrap(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
