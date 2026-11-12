import { db } from "@/db";
import { accidents, roadSegments, severityLevels } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";
import { filterSQL, parseFilters } from "@/lib/api/filters";

export const dynamic = "force-dynamic";

/** Linked-view statistics: all aggregates are recomputed for the current spatial/temporal/attribute subset. */
export async function GET(req: Request) {
  const loaded = await loadNetwork();
  if (!loaded) return Response.json({ empty: true });
  const f = parseFilters(new URL(req.url).searchParams);
  const where = filterSQL(loaded.source.id, f);
  const sevs = await db.select().from(severityLevels);
  const [daily, matrix, bySev, byCat, byWeather, byLight, bySeg, totals] = await Promise.all([
    db.select({ day: sql<string>`to_char(date_trunc('day', ${accidents.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`, n: sql<number>`count(*)::int`, verified: sql<number>`sum(case when ${accidents.status}='verified' then 1 else 0 end)::int` }).from(accidents).where(where).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ hour: sql<number>`extract(hour from ${accidents.occurredAt} at time zone 'UTC')::int`, dow: sql<number>`extract(dow from ${accidents.occurredAt} at time zone 'UTC')::int`, n: sql<number>`count(*)::int` }).from(accidents).where(where).groupBy(sql`1`, sql`2`),
    db.select({ severityId: accidents.severityId, n: sql<number>`count(*)::int` }).from(accidents).where(where).groupBy(accidents.severityId),
    db.select({ categoryId: accidents.categoryId, n: sql<number>`count(*)::int` }).from(accidents).where(where).groupBy(accidents.categoryId),
    db.select({ weather: accidents.weather, n: sql<number>`count(*)::int` }).from(accidents).where(where).groupBy(accidents.weather),
    db.select({ lighting: accidents.lighting, n: sql<number>`count(*)::int` }).from(accidents).where(where).groupBy(accidents.lighting),
    db.select({ segmentId: accidents.segmentId, n: sql<number>`count(*)::int`, epdo: sql<number>`sum(${severityLevels.epdoWeight})::float`, lengthM: roadSegments.lengthM, roadClass: roadSegments.roadClass, aadt: roadSegments.aadt })
      .from(accidents).innerJoin(severityLevels, eq(severityLevels.id, accidents.severityId)).innerJoin(roadSegments, eq(roadSegments.id, accidents.segmentId)).where(where)
      .groupBy(accidents.segmentId, roadSegments.lengthM, roadSegments.roadClass, roadSegments.aadt).orderBy(sql`count(*) desc`).limit(15),
    db.select({ n: sql<number>`count(*)::int`, verified: sql<number>`sum(case when ${accidents.status}='verified' then 1 else 0 end)::int`, raw: sql<number>`sum(case when ${accidents.status}='raw' then 1 else 0 end)::int`, meanCred: sql<number>`avg(${accidents.credibility})::float`, meanSnap: sql<number>`avg(${accidents.snapDistanceM})::float`, meanLag: sql<number>`avg(extract(epoch from (${accidents.reportedAt}-${accidents.occurredAt}))/60)::float`, multiWitness: sql<number>`sum(case when ${accidents.witnessCount}>1 then 1 else 0 end)::int`, pedestrians: sql<number>`sum(${accidents.pedestrians})::int`, vehicles: sql<number>`sum(${accidents.vehicles})::int` }).from(accidents).where(where),
  ]);
  const epdoTotal = bySev.reduce((a, r) => a + r.n * (sevs.find((s) => s.id === r.severityId)?.epdoWeight ?? 1), 0);
  return Response.json({ source: { id: loaded.source.id, name: loaded.source.name, kind: loaded.source.kind }, daily, matrix, bySev, byCat, byWeather, byLight, topSegments: bySeg.map((s) => ({ ...s, density: s.n / (s.lengthM / 1000) })), totals: { ...totals[0], epdo: epdoTotal } });
}
