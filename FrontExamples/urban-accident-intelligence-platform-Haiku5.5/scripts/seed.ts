/**
 * Seeds the database with the reproducible synthetic demonstration workspace.
 *
 *   npx tsx scripts/seed.ts           # seed only if empty (idempotent)
 *   npx tsx scripts/seed.ts --reset   # drop all application data, then re-seed
 *
 * Migrations are applied first. The same bootstrap also runs automatically on the first API request.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureReady } from "@/server/bootstrap";
import { logger } from "@/server/logger";

async function main(): Promise<void> {
  const started = Date.now();
  if (process.argv.includes("--reset")) {
    logger.warn("seed.reset", { message: "Truncating application tables" });
    await db.execute(sql`
      TRUNCATE audit_logs, report_verifications, report_attachments, spatial_analysis_results, spatial_analysis_jobs,
        environmental_observations, traffic_observations, road_intersections, road_segments, accidents, dataset_sources,
        sessions RESTART IDENTITY CASCADE
    `);
  }
  await ensureReady();
  const counts = await db.execute<{ datasets: string; accidents: string; segments: string }>(sql`
    select
      (select count(*) from dataset_sources) as datasets,
      (select count(*) from accidents) as accidents,
      (select count(*) from road_segments) as segments
  `);
  const row = counts.rows[0];
  console.log(
    JSON.stringify({
      status: "seeded",
      datasets: Number(row?.datasets ?? 0),
      accidents: Number(row?.accidents ?? 0),
      roadSegments: Number(row?.segments ?? 0),
      seconds: Math.round((Date.now() - started) / 100) / 10,
    }),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error("seed.failed", { error });
  process.exit(1);
});
