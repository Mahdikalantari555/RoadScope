import { desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accidents, datasetSources, reportVerifications } from "@/db/schema";
import { PointGrid, type XY } from "@/lib/geo/geometry";
import { DEFAULT_DUP_OPTIONS, duplicateScore, evaluateDetector } from "@/lib/geo/duplicates";
import { quantile } from "@/lib/geo/stats";
import { requireAdmin } from "@/lib/server/auth";
import { getMeta } from "@/lib/server/data";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/admin/quality — data-quality indicators + duplicate-detector evaluation against synthetic ground truth. */
export const GET = handle(async () => {
  await requireAdmin();
  const meta = await getMeta();
  const rows = await db
    .select({ id: accidents.id, datasetId: accidents.datasetId, status: accidents.status, occurredAt: accidents.occurredAt, reportedAt: accidents.reportedAt, x: accidents.x, y: accidents.y, snap: accidents.snapDistanceM, segmentId: accidents.segmentId, flags: accidents.qualityFlags, description: accidents.description, weather: accidents.weather, categoryId: accidents.categoryId, severityId: accidents.severityId, truth: accidents.syntheticTruth, isSynthetic: accidents.isSynthetic })
    .from(accidents);
  const ds = await db.select({ id: datasetSources.id, code: datasetSources.code, kind: datasetSources.kind }).from(datasetSources);
  const n = rows.length || 1;
  const snaps = rows.map((r) => r.snap).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const delays = rows.map((r) => (r.reportedAt.getTime() - r.occurredAt.getTime()) / 60000).filter((d) => d >= 0).sort((a, b) => a - b);
  const snapHist = [0, 5, 10, 15, 20, 25, 30, 40, 60, 100, Infinity].slice(0, -1).map((lo, i, arr) => {
    const hi = [5, 10, 15, 20, 25, 30, 40, 60, 100, Infinity][i];
    return { bin: hi === Infinity ? `>${lo} m` : `${lo}–${hi} m`, count: snaps.filter((s) => s >= lo && s < hi).length, _: arr.length };
  });
  const delayBins = [0, 15, 60, 180, 720, 1440, 4320, Infinity];
  const delayLabels = ["<15 min", "15–60 min", "1–3 h", "3–12 h", "12–24 h", "1–3 d", ">3 d"];
  const delayHist = delayLabels.map((label, i) => ({ bin: label, count: delays.filter((d) => d >= delayBins[i] && d < delayBins[i + 1]).length }));
  const flagCounts: Record<string, number> = {};
  rows.forEach((r) => r.flags.forEach((f) => (flagCounts[f] = (flagCounts[f] ?? 0) + 1)));
  const perDataset = ds.map((d) => {
    const rs = rows.filter((r) => r.datasetId === d.id);
    const by: Record<string, number> = {};
    rs.forEach((r) => (by[r.status] = (by[r.status] ?? 0) + 1));
    return { ...d, total: rs.length, byStatus: by };
  });

  // Duplicate detector evaluation (synthetic records carry generator ground truth).
  const syn = rows.filter((r) => r.isSynthetic && r.truth && r.truth.kind !== "false_report").sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
  const pts: XY[] = syn.map((r) => [r.x, r.y]);
  const grid = new PointGrid(pts, DEFAULT_DUP_OPTIONS.radius);
  const best = syn.map((r, i) => {
    let s = 0;
    for (const j of grid.within(pts[i], DEFAULT_DUP_OPTIONS.radius)) {
      if (j >= i) continue; // only earlier reports
      const o = syn[j];
      const sc = duplicateScore(
        { id: r.id, x: r.x, y: r.y, t: r.occurredAt.getTime(), category: meta.catById.get(r.categoryId) ?? "", severityRank: meta.sevById.get(r.severityId)?.rank ?? 1 },
        { id: o.id, x: o.x, y: o.y, t: o.occurredAt.getTime(), category: meta.catById.get(o.categoryId) ?? "", severityRank: meta.sevById.get(o.severityId)?.rank ?? 1 },
      );
      if (sc.dtMin <= DEFAULT_DUP_OPTIONS.windowMin) s = Math.max(s, sc.score);
    }
    return { score: s, actual: r.truth?.kind === "duplicate" };
  });
  const thresholds = [0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9];
  const evaluation = syn.length
    ? thresholds.map((t) => ({ threshold: t, ...evaluateDetector(best.map((b) => ({ predicted: b.score >= t, actual: b.actual }))) }))
    : [];
  const gross = rows.filter((r) => r.truth?.kind === "gross_error");
  const grossFlagged = gross.filter((r) => r.flags.includes("off_network") || r.flags.includes("low_positional_confidence")).length;

  const since = new Date(Date.now() - 30 * 86400000);
  const reviews = await db.select({ day: sql<string>`to_char(date_trunc('day', ${reportVerifications.createdAt}), 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` }).from(reportVerifications).where(gte(reportVerifications.createdAt, since)).groupBy(sql`1`).orderBy(sql`1`);
  const citizenId = ds.find((d) => d.kind === "citizen")?.id ?? -1;
  const submissions = await db.select({ day: sql<string>`to_char(date_trunc('day', ${accidents.reportedAt}), 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` }).from(accidents).where(eq(accidents.datasetId, citizenId)).groupBy(sql`1`).orderBy(desc(sql`1`)).limit(30);

  return Response.json({
    total: rows.length,
    completeness: {
      description: rows.filter((r) => r.description.trim().length >= 10).length / n,
      segmentAssigned: rows.filter((r) => r.segmentId !== null).length / n,
      weatherLinked: rows.filter((r) => r.weather !== null).length / n,
    },
    positional: { median: quantile(snaps, 0.5), p90: quantile(snaps, 0.9), p99: quantile(snaps, 0.99), offNetwork: flagCounts.off_network ?? 0, histogram: snapHist.map(({ bin, count }) => ({ bin, count })) },
    reportingDelay: { medianMin: quantile(delays, 0.5), p90Min: quantile(delays, 0.9), histogram: delayHist },
    flags: flagCounts,
    perDataset,
    pending: rows.filter((r) => r.status === "reported").length,
    possibleDuplicates: rows.filter((r) => r.status === "reported" && r.flags.includes("possible_duplicate")).length,
    duplicateDetector: { options: DEFAULT_DUP_OPTIONS, evaluated: syn.length, actualDuplicates: best.filter((b) => b.actual).length, evaluation },
    grossErrorDetection: { injected: gross.length, flagged: grossFlagged, recall: gross.length ? grossFlagged / gross.length : null },
    activity: { reviews, submissions: submissions.reverse() },
  });
});
