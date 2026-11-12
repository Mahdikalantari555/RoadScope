import { db } from "@/db";
import { and, eq, gte, lte } from "drizzle-orm";
import { accidents, severityLevels, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { toUtm } from "@/lib/geo/projection";
import { point } from "@/lib/geojson";
import { ApiError, handleApiError, json, readJson, validateCoordinates, validateTimestamp } from "@/lib/api";
import { DEFAULT_CONFLATION, kernelValue } from "@/lib/vgi/mapmatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/reports/candidates — real-time spatiotemporal conflation alert.
 * Given a pin (lon/lat) and an incident time, returns the active reports inside
 * a *network* neighbourhood Δd_net and temporal window Δt, ranked by the
 * conflation kernel value, so the citizen can corroborate rather than duplicate.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const datasetId = String(body.datasetId ?? "");
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    const ctx = await requireDataset(datasetId);
    const { lon, lat } = validateCoordinates(body.lon, body.lat);
    const occurredAt = validateTimestamp(body.occurrenceTime ?? new Date().toISOString(), "occurrence_time");
    const networkDistanceM = Math.min(2000, Math.max(20, Number(body.networkDistanceM ?? DEFAULT_CONFLATION.networkDistanceM) || DEFAULT_CONFLATION.networkDistanceM));
    const timeWindowMinutes = Math.min(4320, Math.max(5, Number(body.timeWindowMinutes ?? DEFAULT_CONFLATION.timeWindowMinutes)));

    const utm = toUtm(lon, lat, ctx.crs);
    const candidates = ctx.graph.candidateLixels(utm.x, utm.y, networkDistanceM * 1.5);
    let anchor = -1;
    let bestD = Infinity;
    for (const ci of candidates) {
      const l = ctx.graph.lixels[ci];
      const d = Math.hypot(l.x - utm.x, l.y - utm.y);
      if (d < bestD) {
        bestD = d;
        anchor = ci;
      }
    }
    if (anchor < 0) throw new ApiError(422, "outside_network_coverage", { lon, lat });

    const reachable = new Map<number, number>();
    for (const t of ctx.graph.spread(anchor, networkDistanceM * 1.5, false)) reachable.set(t.lixelIndex, t.distance);
    const lixelIds = Array.from(reachable.keys()).map((i) => ctx.graph.lixels[i].id);

    const windowMs = timeWindowMinutes * 60000;
    const sevRows = await db.select().from(severityLevels);
    const sevById = new Map(sevRows.map((s) => [s.id, s]));

    const nearby = await db
      .select()
      .from(accidents)
      .where(
        and(
          eq(accidents.datasetId, ctx.dataset.id),
          eq(accidents.isGroundTruth, false),
          gte(accidents.occurredAt, new Date(occurredAt.getTime() - windowMs * 3)),
          lte(accidents.occurredAt, new Date(occurredAt.getTime() + windowMs * 3)),
        ),
      );

    const results = nearby
      .filter((a) => a.lixelId && reachable.has(ctx.graph.lixelIndexById.get(a.lixelId) ?? -1))
      .map((a) => {
        const lixelIdx = ctx.graph.lixelIndexById.get(a.lixelId!) ?? -1;
        const dNet = reachable.get(lixelIdx) ?? Infinity;
        const dtMinutes = (occurredAt.getTime() - a.occurredAt.getTime()) / 60000;
        const k = kernelValue(dNet, dtMinutes, true, true, { ...DEFAULT_CONFLATION, networkDistanceM, timeWindowMinutes });
        return {
          accidentId: a.id,
          status: a.status,
          severityCode: sevById.get(a.severityId)?.code ?? null,
          occurredAt: a.occurredAt.toISOString(),
          networkDistanceM: Math.round(dNet * 100) / 100,
          euclideanDistanceM: a.x !== null && a.y !== null ? Math.round(Math.hypot(a.x - utm.x, a.y - utm.y) * 100) / 100 : null,
          timeDeltaMinutes: Math.round(dtMinutes * 100) / 100,
          witnessCount: a.witnessCount,
          credibilityScore: a.credibilityScore,
          roadName: a.segmentId ? ctx.graph.segmentById.get(a.segmentId)?.name ?? null : null,
          roadClass: a.segmentId ? ctx.graph.segmentById.get(a.segmentId)?.roadClass ?? null : null,
          position: a.x !== null && a.y !== null ? point(ctx.crs, a.x, a.y) : null,
          kernelValue: Math.round(k * 10000) / 10000,
          recommendation: k >= 0.55 ? "strong_duplicate_candidate" : k >= 0.3 ? "possible_duplicate" : "distinct_incident",
        };
      })
      .sort((a, b) => b.kernelValue - a.kernelValue);

    const reportCount = await db
      .select({ id: vgiReports.id })
      .from(vgiReports)
      .where(and(eq(vgiReports.datasetId, ctx.dataset.id), eq(vgiReports.status, "unverified")))
      .limit(1);

    return json({
      anchor: { lonLat: point(ctx.crs, utm.x, utm.y), metric: { x: utm.x, y: utm.y, srid: ctx.crs.srid }, lixelId: ctx.graph.lixels[anchor]?.id ?? null },
      search: { networkDistanceM, timeWindowMinutes, reachableLixels: lixelIds.length, kernel: "exp(-(d_net/Δd)²)·exp(-|Δt|/Δt*)" },
      candidates: results.slice(0, 25),
      candidateCount: results.length,
      duplicateLikely: results.length > 0 && results[0].kernelValue >= DEFAULT_CONFLATION.kernelThreshold,
      unverifiedReportPool: reportCount.length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
