import { db } from "@/db";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { accidentCategories, accidents, severityLevels, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { bboxFromGeoJson } from "@/lib/geojson";
import { bboxParam, bool, csv, handleApiError, json, num, queryString } from "@/lib/api";
import { buildTimeBins, diurnalMatrix, mean, round } from "@/lib/stats/common";
import type { BinUnit } from "@/lib/stats/common";
import { epdoWeight } from "@/lib/domain/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/datasets/:id/stats
 * Cross-filtered statistical summaries powering the coordinated multiple views
 * (US-6.2). Every chart accepts the same spatial/temporal filter vocabulary as
 * the map, so brushing in either direction recomputes the other.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireDataset(id);
    const q = queryString(req.url);
    const bin = (q.get("bin") ?? "week") as BinUnit;
    const groundTruth = bool(q, "groundTruth", false);
    const severities = csv(q, "severity");
    const categories = csv(q, "category");
    const statuses = csv(q, "status") ?? ["verified", "triaged", "unverified"];
    const from = q.get("from");
    const to = q.get("to");
    const bbox = bboxParam(q);
    const topN = Math.min(50, num(q, "top", 12));

    const sevRows = await db.select().from(severityLevels).orderBy(asc(severityLevels.sortOrder));
    const catRows = await db.select().from(accidentCategories).orderBy(asc(accidentCategories.sortOrder));
    const sevById = new Map(sevRows.map((s) => [s.id, s]));
    const catById = new Map(catRows.map((c) => [c.id, c]));

    const conds = [eq(accidents.datasetId, ctx.dataset.id), eq(accidents.isGroundTruth, groundTruth)];
    if (!groundTruth) conds.push(inArray(accidents.status, statuses as any));
    if (severities?.length) conds.push(inArray(accidents.severityId, sevRows.filter((s) => severities.includes(s.code)).map((s) => s.id)));
    if (categories?.length) conds.push(inArray(accidents.categoryId, catRows.filter((c) => categories.includes(c.code)).map((c) => c.id)));
    if (from) conds.push(gte(accidents.occurredAt, new Date(from)));
    if (to) conds.push(lte(accidents.occurredAt, new Date(to)));
    if (bbox) {
      const m = bboxFromGeoJson(ctx.crs, bbox);
      conds.push(gte(accidents.x, m.minX), lte(accidents.x, m.maxX), gte(accidents.y, m.minY), lte(accidents.y, m.maxY));
    }

    const rows = await db.select().from(accidents).where(and(...conds));

    const severityMix: Record<string, { count: number; epdo: number }> = {};
    const categoryMix: Record<string, number> = {};
    const weatherMix: Record<string, number> = {};
    const lightingMix: Record<string, number> = {};
    const trafficMix: Record<string, number> = {};
    const classMix: Record<string, number> = {};
    const timestamps: number[] = [];
    const weights: number[] = [];
    const epdoPerSegment = new Map<string, { count: number; epdo: number; lengthKm: number }>();
    let totalEpdo = 0;
    let fatalities = 0;
    let injured = 0;
    let emergency = 0;

    for (const r of rows) {
      const sev = sevById.get(r.severityId);
      const sevCode = sev?.code ?? "property_damage";
      const w = epdoWeight(sevCode);
      severityMix[sevCode] = severityMix[sevCode] ?? { count: 0, epdo: 0 };
      severityMix[sevCode].count += 1;
      severityMix[sevCode].epdo += w;
      totalEpdo += w;
      const catCode = r.categoryId ? catById.get(r.categoryId)?.code ?? "unknown" : "unknown";
      categoryMix[catCode] = (categoryMix[catCode] ?? 0) + 1;
      weatherMix[r.weatherCode ?? "unknown"] = (weatherMix[r.weatherCode ?? "unknown"] ?? 0) + 1;
      lightingMix[r.lightingCode ?? "unknown"] = (lightingMix[r.lightingCode ?? "unknown"] ?? 0) + 1;
      trafficMix[r.trafficState] = (trafficMix[r.trafficState] ?? 0) + 1;
      if (r.segmentId) {
        const seg = ctx.graph.segmentById.get(r.segmentId);
        const cur = epdoPerSegment.get(r.segmentId) ?? { count: 0, epdo: 0, lengthKm: seg ? (seg.lengthM * seg.sinuosity) / 1000 : 0.2 };
        cur.count += 1;
        cur.epdo += w;
        epdoPerSegment.set(r.segmentId, cur);
        if (seg) classMix[seg.roadClass] = (classMix[seg.roadClass] ?? 0) + 1;
      }
      timestamps.push(r.occurredAt.getTime());
      weights.push(w);
      fatalities += r.fatalityCount;
      injured += r.injuredCount;
      if (r.emergencyResponse) emergency += 1;
    }

    const tMin = timestamps.length ? Math.min(...timestamps) : Date.now() - 365 * 86400e3;
    const tMax = timestamps.length ? Math.max(...timestamps) : Date.now();
    const bins = buildTimeBins(tMin, tMax + 1, bin);
    const binSize = bin === "hour" ? 3600e3 : bin === "day" ? 86400e3 : bin === "week" ? 7 * 86400e3 : 30 * 86400e3;
    const series = bins.map((b) => ({ key: b.key, label: b.label, start: new Date(b.startMs).toISOString(), end: new Date(b.endMs).toISOString(), count: 0, epdo: 0 }));
    timestamps.forEach((t, i) => {
      const idx = Math.min(series.length - 1, Math.max(0, Math.floor((t - bins[0].startMs) / binSize)));
      series[idx].count += 1;
      series[idx].epdo += weights[i];
    });

    const matrix = diurnalMatrix(timestamps, weights);
    const topSegments = Array.from(epdoPerSegment.entries())
      .map(([segId, v]) => {
        const seg = ctx.graph.segmentById.get(segId);
        return {
          segmentId: segId,
          name: seg?.name ?? "—",
          roadClass: seg?.roadClass ?? "unknown",
          lengthKm: round(v.lengthKm, 4),
          count: v.count,
          epdo: round(v.epdo, 3),
          densityPerKm: round(v.count / Math.max(1e-6, v.lengthKm), 4),
          epdoPerKm: round(v.epdo / Math.max(1e-6, v.lengthKm), 4),
          aadt: seg?.aadt ?? null,
          speedLimitKph: seg?.speedLimitKph ?? null,
          lanes: seg?.lanes ?? null,
        };
      })
      .sort((a, b) => b.epdo - a.epdo)
      .slice(0, topN);

    const [vgiAgg] = await db
      .select({
        reports: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where status = 'verified')::int`,
        rejected: sql<number>`count(*) filter (where status = 'rejected')::int`,
        unverified: sql<number>`count(*) filter (where status = 'unverified')::int`,
        triaged: sql<number>`count(*) filter (where status = 'triaged')::int`,
        corroborated: sql<number>`count(*) filter (where status = 'corroborated')::int`,
        merged: sql<number>`count(*) filter (where status = 'merged')::int`,
        falseAlarms: sql<number>`count(*) filter (where is_false_alarm)::int`,
        witnesses: sql<number>`count(*) filter (where is_duplicate_witness)::int`,
        meanLag: sql<number>`coalesce(avg(reporting_lag_seconds),0)`,
        medianLag: sql<number>`coalesce(percentile_cont(0.5) within group (order by reporting_lag_seconds),0)`,
        meanDrift: sql<number>`coalesce(avg(injected_drift_m),0)`,
        p90Drift: sql<number>`coalesce(percentile_cont(0.9) within group (order by injected_drift_m),0)`,
        meanPerp: sql<number>`coalesce(avg(snap_perp_distance_m),0)`,
        meanCredibility: sql<number>`coalesce(avg(credibility_score),0)`,
      })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, ctx.dataset.id));

    const driftHistogram = await db
      .select({ bucket: sql<number>`floor(injected_drift_m / 10)::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(and(eq(vgiReports.datasetId, ctx.dataset.id), sql`injected_drift_m is not null`))
      .groupBy(sql`floor(injected_drift_m / 10)::int`)
      .orderBy(asc(sql`floor(injected_drift_m / 10)::int`));

    const lagHistogram = await db
      .select({ bucket: sql<number>`floor(ln(greatest(reporting_lag_seconds,1)))::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, ctx.dataset.id))
      .groupBy(sql`floor(ln(greatest(reporting_lag_seconds,1)))::int`)
      .orderBy(asc(sql`floor(ln(greatest(reporting_lag_seconds,1)))::int`));

    const snapPosterior = await db
      .select({ bucket: sql<number>`floor(coalesce(snap_posterior,0) * 10)::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, ctx.dataset.id))
      .groupBy(sql`floor(coalesce(snap_posterior,0) * 10)::int`)
      .orderBy(asc(sql`floor(coalesce(snap_posterior,0) * 10)::int`));

    return json({
      datasetId: ctx.dataset.id,
      filters: { bin, groundTruth, severities, categories, statuses, from, to, bbox },
      totals: {
        incidents: rows.length,
        epdo: round(totalEpdo, 2),
        fatalities,
        injured,
        emergencyResponse: emergency,
        meanEpdoPerIncident: round(rows.length ? totalEpdo / rows.length : 0, 3),
        timeRange: { from: new Date(tMin).toISOString(), to: new Date(tMax).toISOString() },
        networkLengthKm: ctx.dataset.networkStats?.totalLengthKm ?? null,
        incidentsPerKmPerYear: ctx.dataset.networkStats?.totalLengthKm
          ? round(rows.length / ctx.dataset.networkStats.totalLengthKm / ((tMax - tMin) / (365 * 86400e3) || 1), 4)
          : null,
      },
      series,
      diurnalMatrix: matrix.map((row) => row.map((v) => round(v, 3))),
      severityMix: sevRows.map((s) => ({ code: s.code, label: s.label, color: s.color, rank: s.rank, count: severityMix[s.code]?.count ?? 0, epdo: round(severityMix[s.code]?.epdo ?? 0, 3) })),
      categoryMix: catRows.map((c) => ({ code: c.code, label: c.label, count: categoryMix[c.code] ?? 0 })),
      weatherMix: Object.entries(weatherMix).map(([k, v]) => ({ code: k, count: v })).sort((a, b) => b.count - a.count),
      lightingMix: Object.entries(lightingMix).map(([k, v]) => ({ code: k, count: v })).sort((a, b) => b.count - a.count),
      trafficMix: Object.entries(trafficMix).map(([k, v]) => ({ code: k, count: v })).sort((a, b) => b.count - a.count),
      classMix: Object.entries(classMix).map(([k, v]) => ({ code: k, count: v })).sort((a, b) => b.count - a.count),
      topSegments,
      vgi: {
        reports: vgiAgg?.reports ?? 0,
        statusBreakdown: {
          verified: vgiAgg?.verified ?? 0,
          rejected: vgiAgg?.rejected ?? 0,
          unverified: vgiAgg?.unverified ?? 0,
          triaged: vgiAgg?.triaged ?? 0,
          corroborated: vgiAgg?.corroborated ?? 0,
          merged: vgiAgg?.merged ?? 0,
        },
        falseAlarms: vgiAgg?.falseAlarms ?? 0,
        witnessReports: vgiAgg?.witnesses ?? 0,
        meanLagSeconds: round(vgiAgg?.meanLag ?? 0, 1),
        medianLagSeconds: round(vgiAgg?.medianLag ?? 0, 1),
        meanDriftM: round(vgiAgg?.meanDrift ?? 0, 2),
        p90DriftM: round(vgiAgg?.p90Drift ?? 0, 2),
        meanSnapPerpDistanceM: round(vgiAgg?.meanPerp ?? 0, 2),
        meanCredibility: round(vgiAgg?.meanCredibility ?? 0, 2),
        rejectionRate: round(((vgiAgg?.rejected ?? 0) / Math.max(1, vgiAgg?.reports ?? 1)) * 100, 2),
        driftHistogram: driftHistogram.map((d) => ({ bucket: `${d.bucket * 10}–${d.bucket * 10 + 10} m`, count: d.c })),
        lagHistogram: lagHistogram.map((d) => ({ bucket: `e^${d.bucket} s ≈ ${Math.round(Math.exp(d.bucket))} s`, logBucket: d.bucket, count: d.c })),
        snapPosteriorHistogram: snapPosterior.map((d) => ({ bucket: `${d.bucket * 10}–${d.bucket * 10 + 10}%`, count: d.c })),
        syntheticShare: 100,
      },
      meanIntervalHours: round(timestamps.length > 1 ? (tMax - tMin) / (timestamps.length - 1) / 3600e3 : 0, 3),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
