import { db } from "@/db";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { accidents, auditLogs, reportVerifications, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { handleApiError, json } from "@/lib/api";
import { mean, round, spearman } from "@/lib/stats/common";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/datasets/:id/quality — macro-level VGI data-quality diagnostics
 * (US-3.3): positional drift distributions, reporting-lag histograms, rejection
 * rates, snap-posterior/ambiguity distributions, synthetic vs empirical
 * separation and coverage of the lixel lattice by observations.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireDataset(id);
    const dsId = ctx.dataset.id;

    const [agg] = await db
      .select({
        reports: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where status='verified')::int`,
        rejected: sql<number>`count(*) filter (where status='rejected')::int`,
        merged: sql<number>`count(*) filter (where status='merged')::int`,
        triaged: sql<number>`count(*) filter (where status='triaged')::int`,
        unverified: sql<number>`count(*) filter (where status='unverified')::int`,
        corroborated: sql<number>`count(*) filter (where status='corroborated')::int`,
        falseAlarms: sql<number>`count(*) filter (where is_false_alarm)::int`,
        witnesses: sql<number>`count(*) filter (where is_duplicate_witness)::int`,
        meanDrift: sql<number>`coalesce(avg(injected_drift_m),0)`,
        sdDrift: sql<number>`coalesce(stddev_samp(injected_drift_m),0)`,
        p50Drift: sql<number>`coalesce(percentile_cont(0.5) within group (order by injected_drift_m),0)`,
        p95Drift: sql<number>`coalesce(percentile_cont(0.95) within group (order by injected_drift_m),0)`,
        meanPerp: sql<number>`coalesce(avg(snap_perp_distance_m),0)`,
        p95Perp: sql<number>`coalesce(percentile_cont(0.95) within group (order by snap_perp_distance_m),0)`,
        meanLag: sql<number>`coalesce(avg(reporting_lag_seconds),0)`,
        p50Lag: sql<number>`coalesce(percentile_cont(0.5) within group (order by reporting_lag_seconds),0)`,
        p95Lag: sql<number>`coalesce(percentile_cont(0.95) within group (order by reporting_lag_seconds),0)`,
        meanCredibility: sql<number>`coalesce(avg(credibility_score),0)`,
        meanPosterior: sql<number>`coalesce(avg(snap_posterior),0)`,
        meanAccuracy: sql<number>`coalesce(avg(positional_accuracy_m),0)`,
      })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, dsId));

    const driftHist = await db
      .select({ bucket: sql<number>`floor(injected_drift_m/5)::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(and(eq(vgiReports.datasetId, dsId), isNotNull(vgiReports.injectedDriftM)))
      .groupBy(sql`floor(injected_drift_m/5)::int`)
      .orderBy(asc(sql`floor(injected_drift_m/5)::int`));

    const lagHist = await db
      .select({ bucket: sql<number>`floor(ln(greatest(reporting_lag_seconds,1)))::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, dsId))
      .groupBy(sql`floor(ln(greatest(reporting_lag_seconds,1)))::int`)
      .orderBy(asc(sql`floor(ln(greatest(reporting_lag_seconds,1)))::int`));

    const posteriorHist = await db
      .select({ bucket: sql<number>`floor(coalesce(snap_posterior,0)*20)::int`, c: sql<number>`count(*)::int` })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, dsId))
      .groupBy(sql`floor(coalesce(snap_posterior,0)*20)::int`)
      .orderBy(asc(sql`floor(coalesce(snap_posterior,0)*20)::int`));

    const byClass = await db
      .select({
        roadClass: sql<string>`(select road_class from road_segments s where s.id = vgi_reports.snapped_segment_id)`,
        c: sql<number>`count(*)::int`,
        meanPerp: sql<number>`coalesce(avg(vgi_reports.snap_perp_distance_m),0)`,
        meanPosterior: sql<number>`coalesce(avg(vgi_reports.snap_posterior),0)`,
      })
      .from(vgiReports)
      .where(eq(vgiReports.datasetId, dsId))
      .groupBy(sql`(select road_class from road_segments s where s.id = vgi_reports.snapped_segment_id)`)
      .orderBy(desc(sql`count(*)`));

    const [coverage] = await db
      .select({ withReport: sql<number>`count(distinct lixel_id)::int` })
      .from(accidents)
      .where(and(eq(accidents.datasetId, dsId), eq(accidents.isGroundTruth, false)));

    const [truthAgg] = await db
      .select({
        groundTruth: sql<number>`count(*) filter (where is_ground_truth)::int`,
        canonical: sql<number>`count(*) filter (where not is_ground_truth)::int`,
        verified: sql<number>`count(*) filter (where not is_ground_truth and status='verified')::int`,
        rejected: sql<number>`count(*) filter (where not is_ground_truth and status='rejected')::int`,
      })
      .from(accidents)
      .where(eq(accidents.datasetId, dsId));

    const driftRows = await db
      .select({ drift: vgiReports.injectedDriftM, perp: vgiReports.snapPerpDistanceM, accuracy: vgiReports.positionalAccuracyM })
      .from(vgiReports)
      .where(and(eq(vgiReports.datasetId, dsId), isNotNull(vgiReports.injectedDriftM)));
    const pairs = driftRows.filter((r) => r.drift !== null && r.perp !== null);
    const declaredVsActual = pairs.length
      ? round(spearman(pairs.map((p) => p.accuracy ?? 0), pairs.map((p) => p.drift ?? 0)), 4)
      : 0;

    const verifications = await db
      .select({ action: reportVerifications.action, c: sql<number>`count(*)::int` })
      .from(reportVerifications)
      .where(eq(reportVerifications.datasetId, dsId))
      .groupBy(reportVerifications.action)
      .orderBy(desc(sql`count(*)`));

    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.datasetId, dsId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(25);

    const reports = agg?.reports ?? 0;
    return json({
      datasetId: dsId,
      provenance: {
        kind: ctx.dataset.kind,
        synthetic: ctx.dataset.kind === "synthetic",
        scenario: ctx.dataset.scenario,
        seed: ctx.dataset.seed,
        generatorVersion: ctx.dataset.generatorVersion,
        separationNote:
          ctx.dataset.kind === "synthetic"
            ? "SYNTHETIC — generated by the seeded inhomogeneous network point process. Oracle λ and injected drift are available for benchmarking; these records must never be mixed with empirical observations in a publication."
            : "EMPIRICAL — no oracle intensity is available; PAI/RRI/RMSE against ground truth are disabled.",
      },
      volumes: {
        reports,
        groundTruthRealizations: truthAgg?.groundTruth ?? 0,
        canonicalIncidents: truthAgg?.canonical ?? 0,
        verifiedIncidents: truthAgg?.verified ?? 0,
        rejectedIncidents: truthAgg?.rejected ?? 0,
        falseAlarms: agg?.falseAlarms ?? 0,
        witnessReports: agg?.witnesses ?? 0,
        lixelsWithAtLeastOneIncident: coverage?.withReport ?? 0,
        lixelCount: ctx.graph.lixels.length,
        coveragePct: round(((coverage?.withReport ?? 0) / Math.max(1, ctx.graph.lixels.length)) * 100, 2),
      },
      rates: {
        rejectionRatePct: round(((agg?.rejected ?? 0) / Math.max(1, reports)) * 100, 2),
        verificationRatePct: round(((agg?.verified ?? 0) / Math.max(1, reports)) * 100, 2),
        mergeRatePct: round(((agg?.merged ?? 0) / Math.max(1, reports)) * 100, 2),
        falseAlarmRatePct: round(((agg?.falseAlarms ?? 0) / Math.max(1, reports)) * 100, 2),
        duplicationRatePct: round(((agg?.witnesses ?? 0) / Math.max(1, reports)) * 100, 2),
      },
      positionalQuality: {
        meanInjectedDriftM: round(agg?.meanDrift ?? 0, 3),
        sdInjectedDriftM: round(agg?.sdDrift ?? 0, 3),
        medianInjectedDriftM: round(agg?.p50Drift ?? 0, 3),
        p95InjectedDriftM: round(agg?.p95Drift ?? 0, 3),
        meanSnapResidualM: round(agg?.meanPerp ?? 0, 3),
        p95SnapResidualM: round(agg?.p95Perp ?? 0, 3),
        meanDeclaredAccuracyM: round(agg?.meanAccuracy ?? 0, 3),
        declaredVsActualSpearman: declaredVsActual,
        residualReductionPct: round((1 - (agg?.meanPerp ?? 0) / Math.max(1e-6, agg?.meanDrift ?? 1)) * 100, 2),
        meanSnapPosterior: round(agg?.meanPosterior ?? 0, 4),
        driftHistogram: driftHist.map((d) => ({ bucket: `${d.bucket * 5}–${d.bucket * 5 + 5} m`, count: d.c })),
        snapPosteriorHistogram: posteriorHist.map((d) => ({ bucket: `${d.bucket * 5}–${d.bucket * 5 + 5}%`, count: d.c })),
        byRoadClass: byClass.map((b) => ({ roadClass: b.roadClass ?? "unknown", reports: b.c, meanResidualM: round(b.meanPerp, 3), meanPosterior: round(b.meanPosterior, 4) })),
      },
      temporalQuality: {
        meanLagSeconds: round(agg?.meanLag ?? 0, 1),
        medianLagSeconds: round(agg?.p50Lag ?? 0, 1),
        p95LagSeconds: round(agg?.p95Lag ?? 0, 1),
        meanLagMinutes: round((agg?.meanLag ?? 0) / 60, 2),
        lagHistogram: lagHist.map((d) => ({ bucketSeconds: Math.round(Math.exp(d.bucket)), logBucket: d.bucket, count: d.c })),
      },
      credibility: { mean: round(agg?.meanCredibility ?? 0, 2) },
      stewardship: {
        verificationActions: verifications.map((v) => ({ action: v.action, count: v.c })),
        recentAudit: audit.map((a) => ({ at: a.createdAt.toISOString(), actorRole: a.actorRole, entity: a.entity, action: a.action, severity: a.severity, entityId: a.entityId })),
      },
      statusBreakdown: {
        verified: agg?.verified ?? 0,
        rejected: agg?.rejected ?? 0,
        merged: agg?.merged ?? 0,
        triaged: agg?.triaged ?? 0,
        unverified: agg?.unverified ?? 0,
        corroborated: agg?.corroborated ?? 0,
      },
      meanDriftPerClass: round(mean(byClass.map((b) => b.meanPerp)), 3),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
