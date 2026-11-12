/** Shared incident/report loading + weighting for the analysis laboratory. */
import { db } from "@/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { accidents, roadSegments, severityLevels, vgiReports, accidentCategories } from "@/db/schema";
import type { DatasetContext } from "@/lib/geo/datasetGraph";
import { epdoWeight, severityByCode } from "@/lib/domain/taxonomy";
import type { IncidentRecord } from "@/lib/stats/risk";
import type { ClusterPoint, WeightedPointAlias } from "@/lib/analysis/types";

export interface AnalysisFilters {
  includeGroundTruth?: boolean;
  includeUnverified?: boolean;
  statuses?: string[];
  severities?: string[];
  categories?: string[];
  dateFrom?: string;
  dateTo?: string;
  bboxMetric?: { minX: number; minY: number; maxX: number; maxY: number };
  weightBy?: "count" | "epdo" | "credibility" | "severity";
  credibilityFloor?: number;
  lixelSubset?: number[] | null;
}

export const DEFAULT_FILTERS: AnalysisFilters = {
  includeGroundTruth: false,
  includeUnverified: true,
  statuses: ["verified", "triaged", "unverified"],
  weightBy: "count",
  credibilityFloor: 0,
};

export interface LoadedIncidents {
  records: IncidentRecord[];
  clusterPoints: ClusterPoint[];
  severityById: Map<string, string>;
  categoryById: Map<string, string>;
  severityRankByCode: Map<string, number>;
  count: number;
  totalWeight: number;
  totalEpdo: number;
  timeRange: { min: number; max: number };
}

export async function loadIncidents(ctx: DatasetContext, filters: AnalysisFilters = {}): Promise<LoadedIncidents> {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const sevRows = await db.select().from(severityLevels);
  const catRows = await db.select().from(accidentCategories);
  const severityById = new Map(sevRows.map((s) => [s.id, s.code]));
  const categoryById = new Map(catRows.map((c) => [c.id, c.code]));
  const severityRankByCode = new Map(sevRows.map((s) => [s.code, s.rank]));

  const conds = [eq(accidents.datasetId, ctx.dataset.id)];
  if (!f.includeGroundTruth) conds.push(eq(accidents.isGroundTruth, false));
  if (f.statuses && f.statuses.length > 0) conds.push(inArray(accidents.status, f.statuses as any));
  if (f.dateFrom) conds.push(gte(accidents.occurredAt, new Date(f.dateFrom)));
  if (f.dateTo) conds.push(lte(accidents.occurredAt, new Date(f.dateTo)));
  if (f.severities && f.severities.length > 0) {
    const ids = sevRows.filter((s) => f.severities!.includes(s.code)).map((s) => s.id);
    if (ids.length) conds.push(inArray(accidents.severityId, ids));
  }
  if (f.categories && f.categories.length > 0) {
    const ids = catRows.filter((c) => f.categories!.includes(c.code)).map((c) => c.id);
    if (ids.length) conds.push(inArray(accidents.categoryId, ids));
  }
  if (f.bboxMetric) {
    conds.push(gte(accidents.x, f.bboxMetric.minX));
    conds.push(lte(accidents.x, f.bboxMetric.maxX));
    conds.push(gte(accidents.y, f.bboxMetric.minY));
    conds.push(lte(accidents.y, f.bboxMetric.maxY));
  }

  const rows = await db.select().from(accidents).where(and(...conds));
  const lixelIndexById = ctx.graph.lixelIndexById;

  // Report-level provenance for VGI-vs-verified ratios and drift statistics.
  const reportRows = await db
    .select({
      accidentId: vgiReports.accidentId,
      status: vgiReports.status,
      drift: vgiReports.injectedDriftM,
      perp: vgiReports.snapPerpDistanceM,
      credibility: vgiReports.credibilityScore,
    })
    .from(vgiReports)
    .where(eq(vgiReports.datasetId, ctx.dataset.id));
  const reportsByAccident = new Map<string, typeof reportRows>();
  for (const r of reportRows) {
    if (!r.accidentId) continue;
    const arr = reportsByAccident.get(r.accidentId);
    if (arr) arr.push(r);
    else reportsByAccident.set(r.accidentId, [r]);
  }

  const records: IncidentRecord[] = [];
  const clusterPoints: ClusterPoint[] = [];
  let totalWeight = 0;
  let totalEpdo = 0;
  let minT = Infinity;
  let maxT = -Infinity;

  for (const row of rows) {
    const severityCode = severityById.get(row.severityId) ?? "property_damage";
    const reports = reportsByAccident.get(row.id) ?? [];
    const verified = reports.length === 0 ? row.status === "verified" : reports.some((r) => r.status === "verified");
    const unverifiedOnly = reports.length > 0 && reports.every((r) => r.status === "unverified" || r.status === "triaged");
    if (!f.includeUnverified && unverifiedOnly && !row.isGroundTruth) continue;
    const credibility = row.credibilityScore ?? (reports.length ? meanNullable(reports.map((r) => r.credibility)) ?? 50 : 50);
    if ((f.credibilityFloor ?? 0) > 0 && credibility < (f.credibilityFloor ?? 0)) continue;

    let lixelIndex = row.lixelId ? lixelIndexById.get(row.lixelId) ?? -1 : -1;
    if (lixelIndex < 0 && row.x !== null && row.y !== null) {
      const cands = ctx.graph.candidateLixels(row.x, row.y, 60);
      let best = -1;
      let bestD = Infinity;
      for (const ci of cands) {
        const l = ctx.graph.lixels[ci];
        const d = Math.hypot(l.x - (row.x ?? 0), l.y - (row.y ?? 0));
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      }
      lixelIndex = best;
    }
    if (lixelIndex < 0) continue;
    if (f.lixelSubset && !f.lixelSubset.includes(lixelIndex)) continue;

    const epdo = epdoWeight(severityCode);
    const rank = severityRankByCode.get(severityCode) ?? 2;
    let weight = 1;
    if (f.weightBy === "epdo") weight = epdo;
    else if (f.weightBy === "credibility") weight = Math.max(0.05, credibility / 100);
    else if (f.weightBy === "severity") weight = rank / 3;

    const drift = meanNullable(reports.map((r) => r.perp ?? r.drift)) ?? 0;
    records.push({
      lixelIndex,
      segmentId: row.segmentId ?? ctx.graph.lixels[lixelIndex]?.segmentId ?? "",
      weight,
      epdo,
      severityRank: rank,
      isVerified: Boolean(verified),
      isVgiOnly: !verified && !row.isGroundTruth,
      positionalDriftM: drift,
    });
    clusterPoints.push({
      id: row.id,
      lixelIndex,
      x: row.x ?? ctx.graph.lixels[lixelIndex].x,
      y: row.y ?? ctx.graph.lixels[lixelIndex].y,
      weight,
      severityCode,
      occurredAt: row.occurredAt.getTime(),
    });
    totalWeight += weight;
    totalEpdo += epdo;
    const t = row.occurredAt.getTime();
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }

  return {
    records,
    clusterPoints,
    severityById,
    categoryById,
    severityRankByCode,
    count: records.length,
    totalWeight,
    totalEpdo,
    timeRange: { min: Number.isFinite(minT) ? minT : 0, max: Number.isFinite(maxT) ? maxT : 0 },
  };
}

export function meanNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

export async function segmentAttributes(ctx: DatasetContext): Promise<Map<string, typeof roadSegments.$inferSelect>> {
  const rows = await db.select().from(roadSegments).where(eq(roadSegments.datasetId, ctx.dataset.id));
  return new Map(rows.map((r) => [r.id, r]));
}

export function severityEpdo(code: string): number {
  return epdoWeight(code);
}

export function severityRank(code: string): number {
  return severityByCode(code).rank;
}

export async function countWhere(table: any, ...conds: any[]): Promise<number> {
  const rows = await db.select({ c: sql<number>`count(*)::int` }).from(table).where(and(...conds));
  return rows[0]?.c ?? 0;
}

export function orderAsc(col: any) {
  return asc(col);
}

export function orderDesc(col: any) {
  return desc(col);
}

export function notNull(col: any) {
  return isNotNull(col);
}
