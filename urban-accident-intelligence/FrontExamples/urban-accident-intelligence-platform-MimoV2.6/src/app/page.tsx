import { db } from "@/db";
import { accidents, reportAttachments, roadSegments, trafficObservations } from "@/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import ConsoleShell from "@/components/ConsoleShell";
import type { Accident, RoadSegment } from "@/lib/types";
import { accidentCategories, severityLevels } from "@/db/schema";
import { mapAccident, mapSegment } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [accRows, segRows, catRows, sevRows, trafficRows] = await Promise.all([
    db.select().from(accidents).orderBy(asc(accidents.id)),
    db.select().from(roadSegments).orderBy(asc(roadSegments.id)),
    db.select().from(accidentCategories),
    db.select().from(severityLevels),
    db
      .select({
        roadSegmentId: trafficObservations.roadSegmentId,
        aadt: sql<number | null>`max(${trafficObservations.aadt})`,
        coverageRatio: sql<number>`avg(${trafficObservations.coverageRatio})`,
        volume: sql<number>`avg(${trafficObservations.volumeVehPerHour})`,
      })
      .from(trafficObservations)
      .groupBy(trafficObservations.roadSegmentId),
  ]);

  const cats = new Map(catRows.map((c) => [c.code, c]));
  const sevs = new Map(sevRows.map((s) => [s.code, s]));
  const segById = new Map(segRows.map((s) => [s.id, s]));

  const attachmentCounts = await db
    .select({
      accidentId: reportAttachments.accidentId,
      n: sql<number>`count(*)::int`,
    })
    .from(reportAttachments)
    .groupBy(reportAttachments.accidentId);
  const attachMap = new Map(attachmentCounts.map((a) => [a.accidentId, a.n]));

  const accidentsOut: Accident[] = accRows.map((r) =>
    mapAccident(r, cats.get(r.categoryCode), sevs.get(r.severityCode), segById.get(r.roadSegmentId ?? -1), attachMap.get(r.id) ?? 0),
  );
  const segmentsOut: RoadSegment[] = segRows.map(mapSegment);
  const traffic = trafficRows.map((t) => ({
    segmentId: t.roadSegmentId,
    aadt: t.aadt,
    coverageRatio: Number(t.coverageRatio ?? 0),
    volume: Number(t.volume ?? 0),
  }));

  return (
    <ConsoleShell accidents={accidentsOut} segments={segmentsOut} traffic={traffic} />
  );
}
