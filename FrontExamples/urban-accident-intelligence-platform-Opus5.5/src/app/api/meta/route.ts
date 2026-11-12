import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accidents, datasetSources } from "@/db/schema";
import { STATUSES } from "@/lib/domain";
import { currentUser } from "@/lib/server/auth";
import { getMeta, getNetwork, toLonLat } from "@/lib/server/data";
import { handle } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await ensureSeeded();
  const meta = await getMeta();
  const net = await getNetwork();
  const datasets = await db
    .select({ id: datasetSources.id, code: datasetSources.code, name: datasetSources.name, kind: datasetSources.kind, isActive: datasetSources.isActive, scenario: datasetSources.scenario, seed: datasetSources.seed, records: count(accidents.id) })
    .from(datasetSources)
    .leftJoin(accidents, eq(accidents.datasetId, datasetSources.id))
    .groupBy(datasetSources.id)
    .orderBy(datasetSources.id);
  const [range] = await db.select({ min: sql<string>`min(${accidents.occurredAt})`, max: sql<string>`max(${accidents.occurredAt})` }).from(accidents);
  const user = await currentUser();
  return Response.json({
    categories: meta.categories,
    severities: meta.severities,
    statuses: STATUSES,
    datasets,
    timeRange: range,
    bounds: net ? [...toLonLat([net.extent.minX, net.extent.minY]), ...toLonLat([net.extent.maxX, net.extent.maxY])] : null,
    crs: { storage: "EPSG:4326 + EPSG:32633", metric: "EPSG:32633 (WGS 84 / UTM 33N)" },
    user,
  });
});
