import { db } from "@/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { accidents, reportVerifications, severityLevels, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { ApiError, bool, handleApiError, json, num, readJson, queryString } from "@/lib/api";
import { resolveActor, requirePermission, writeAudit } from "@/lib/auth";
import { DEFAULT_CONFLATION, conflateReports, type ConflationReport } from "@/lib/vgi/mapmatch";
import { mean, round } from "@/lib/stats/common";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/reports/conflate — batch spatiotemporal deduplication & witness
 * aggregation across the unverified pool (US-3.2). GET returns the current
 * cluster diagnostics without mutating anything.
 */
export async function GET(req: Request) {
  try {
    const q = queryString(req.url);
    const datasetId = q.get("datasetId");
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    const ctx = await requireDataset(datasetId);
    const rows = await db
      .select({ clusterId: vgiReports.clusterId, status: vgiReports.status, credibility: vgiReports.credibilityScore, id: vgiReports.id, accidentId: vgiReports.accidentId })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, ctx.dataset.id));
    const clusters = new Map<string, number>();
    for (const r of rows) if (r.clusterId) clusters.set(r.clusterId, (clusters.get(r.clusterId) ?? 0) + 1);
    const sizes = Array.from(clusters.values());
    const histogram = [1, 2, 3, 4, 5].map((s) => ({ size: s, clusters: sizes.filter((v) => v === s).length }));
    histogram.push({ size: 6, clusters: sizes.filter((v) => v >= 6).length });
    return json({
      datasetId: ctx.dataset.id,
      reports: rows.length,
      clusters: clusters.size,
      duplicateReports: rows.length - clusters.size,
      duplicationRate: round(((rows.length - clusters.size) / Math.max(1, rows.length)) * 100, 2),
      clusterSizeHistogram: histogram,
      meanClusterSize: round(mean(sizes), 3),
      meanCredibility: round(mean(rows.map((r) => r.credibility ?? 0).filter((v) => v > 0)), 2),
      statusBreakdown: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
      params: DEFAULT_CONFLATION,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const actor = resolveActor(req);
    requirePermission(actor, "report:verify");
    const q = queryString(req.url);
    const body = await readJson(req);
    const datasetId = String(body.datasetId ?? q.get("datasetId") ?? "");
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    const ctx = await requireDataset(datasetId);
    const apply = bool(new URLSearchParams(`a=${body.apply ?? true}`), "a", true);
    const params = {
      networkDistanceM: Math.min(1000, Math.max(20, num(new URLSearchParams(`d=${body.networkDistanceM ?? DEFAULT_CONFLATION.networkDistanceM}`), "d", DEFAULT_CONFLATION.networkDistanceM))),
      timeWindowMinutes: Math.min(1440, Math.max(5, num(new URLSearchParams(`t=${body.timeWindowMinutes ?? DEFAULT_CONFLATION.timeWindowMinutes}`), "t", DEFAULT_CONFLATION.timeWindowMinutes))),
      kernelThreshold: Math.min(0.95, Math.max(0.05, Number(body.kernelThreshold ?? DEFAULT_CONFLATION.kernelThreshold))),
    };

    const rows = await db
      .select()
      .from(vgiReports)
      .where(and(eq(vgiReports.datasetId, ctx.dataset.id), inArray(vgiReports.status, ["unverified", "triaged", "corroborated"] as any)));
    const sevRows = await db.select().from(severityLevels);
    const sevById = new Map(sevRows.map((s) => [s.id, s.code]));

    const input: ConflationReport[] = rows.map((r) => ({
      id: r.id,
      x: r.rawX,
      y: r.rawY,
      lixelIndex: r.snappedLixelId ? ctx.graph.lixelIndexById.get(r.snappedLixelId) ?? -1 : -1,
      segmentId: r.snappedSegmentId,
      occurredAt: r.occurrenceTime.getTime(),
      severityCode: sevById.get(r.severityId) ?? "property_damage",
      categoryCode: null,
      credibilityScore: r.credibilityScore,
      status: r.status,
    }));

    const clusters = conflateReports(ctx.graph, input, params);
    const byId = new Map(rows.map((r) => [r.id, r]));

    let merged = 0;
    let triaged = 0;
    const sizeHistogram = [1, 2, 3, 4, 5].map((s) => ({ size: s, count: clusters.filter((c) => c.memberIds.length === s).length }));
    sizeHistogram.push({ size: 6, count: clusters.filter((c) => c.memberIds.length >= 6).length });

    if (apply) {
      for (const c of clusters) {
        const canonical = byId.get(c.canonicalId);
        if (!canonical) continue;
        const multi = c.memberIds.length > 1;
        for (const mid of c.memberIds) {
          const r = byId.get(mid);
          if (!r) continue;
          const isCanonical = mid === c.canonicalId;
          await db
            .update(vgiReports)
            .set({
              clusterId: c.id,
              credibility: c.credibility,
              credibilityScore: c.credibility.total,
              status: isCanonical ? (multi ? "triaged" : r.status === "unverified" ? "unverified" : r.status) : "merged",
              mergedIntoReportId: isCanonical ? null : canonical.id,
              accidentId: isCanonical ? r.accidentId : canonical.accidentId,
              isDuplicateWitness: multi && !isCanonical,
            })
            .where(eq(vgiReports.id, mid));
          if (!isCanonical) merged++;
        }
        if (multi && canonical.accidentId) {
          await db
            .update(accidents)
            .set({ witnessCount: c.memberIds.length, credibilityScore: c.credibility.total, status: "triaged" })
            .where(eq(accidents.id, canonical.accidentId));
          triaged++;
        }
        await db.insert(reportVerifications).values({
          reportId: canonical.id,
          datasetId: ctx.dataset.id,
          actorId: actor.id,
          actorRole: actor.role,
          action: multi ? "merged" : "triaged",
          fromStatus: canonical.status,
          toStatus: multi ? "triaged" : canonical.status,
          reason: `automatic_conflation cluster=${c.id} size=${c.memberIds.length} credibility=${c.credibility.total}`,
        });
      }
    }

    await writeAudit({
      actor,
      entity: "vgi_reports",
      action: apply ? "conflation_applied" : "conflation_preview",
      datasetId: ctx.dataset.id,
      severity: "notice",
      after: { params, clusters: clusters.length, merged, triaged, poolSize: rows.length },
      request: req,
    });

    return json({
      ok: true,
      applied: apply,
      params,
      poolSize: rows.length,
      clusterCount: clusters.length,
      duplicateReportsMerged: merged,
      canonicalIncidentsTriaged: triaged,
      duplicationRate: round(((rows.length - clusters.length) / Math.max(1, rows.length)) * 100, 2),
      clusterSizeHistogram: sizeHistogram,
      meanClusterSize: round(mean(clusters.map((c) => c.memberIds.length)), 3),
      meanCredibility: round(mean(clusters.map((c) => c.credibility.total)), 2),
      meanSpatialProximity: round(mean(clusters.map((c) => c.credibility.spatialProximity)), 4),
      meanAttributeConsistency: round(mean(clusters.map((c) => c.credibility.attributeConsistency)), 4),
      largestClusters: clusters.slice(0, 12).map((c) => ({
        clusterId: c.id,
        size: c.memberIds.length,
        canonicalId: c.canonicalId,
        credibility: c.credibility.total,
        meanNetworkDistanceM: round(c.meanNetworkDistanceM, 2),
        timeRangeMinutes: round(c.timeRangeMinutes, 2),
        severityAgreement: round(c.severityAgreement, 3),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
