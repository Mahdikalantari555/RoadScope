/**
 * Dashboard statistics, segment statistics, road-segment layers and data-quality indicators.
 * All aggregations are descriptive: they summarise recorded incidents and never imply risk.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { AccidentStatus, AccidentPoint, CategoryCode, SegmentRow } from "@/lib/domain";
import { ACCIDENT_STATUSES, CATEGORY_CODES, CATEGORY_META, DOW_LABELS, MONTH_LABELS, QUALITY_FLAGS, SEVERITY_IDS, SEVERITY_META, STUDY_AREA, type GeoFeature } from "@/lib/domain";
import type { DashboardStats, QualityReport, SegmentDetail, SegmentStatsRow } from "@/lib/api-types";
import { type FilterSpec, DEFAULT_FILTERS } from "@/lib/filters";
import { quantile, topShare } from "@/lib/stats";
import { seasonOf, SEASON_LABELS } from "@/lib/time";
import { loadNetwork, type NetworkSnapshot } from "./geo-data";
import { loadAccidentPoints, recentForSegment } from "./accidents";
import { observationYears } from "./observation";
import { ApiError } from "./http";
import { round } from "@/lib/format";

const CELL_M = 500;

const zeroStatus = (): Record<AccidentStatus, number> => ({ reported: 0, verified: 0, rejected: 0, duplicate: 0 });

export function buildDashboard(all: AccidentPoint[], chartStatuses: AccidentStatus[], net: NetworkSnapshot): DashboardStats {
  const byStatus = zeroStatus();
  for (const p of all) byStatus[p.status]++;
  const chart = all.filter((p) => chartStatuses.includes(p.status));

  const severity = SEVERITY_IDS.map((id) => ({
    id,
    label: SEVERITY_META[id].label,
    weight: SEVERITY_META[id].weight,
    colorHex: SEVERITY_META[id].colorHex,
    count: chart.reduce((s, p) => s + (p.severityId === id ? 1 : 0), 0),
  }));
  const categories = CATEGORY_CODES.map((code) => ({
    code,
    label: CATEGORY_META[code].label,
    colorHex: CATEGORY_META[code].colorHex,
    count: chart.reduce((s, p) => s + (p.categoryCode === code ? 1 : 0), 0),
  }));

  const monthMap = new Map<string, { count: number; severityWeight: number }>();
  for (const p of chart) {
    const key = `${p.yearLocal}-${String(p.monthLocal).padStart(2, "0")}`;
    const m = monthMap.get(key) ?? { count: 0, severityWeight: 0 };
    m.count++;
    m.severityWeight += p.severityWeight;
    monthMap.set(key, m);
  }
  const monthly = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v }));

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: chart.reduce((s, p) => s + (p.hourLocal === hour ? 1 : 0), 0) }));
  const dayOfWeek = DOW_LABELS.map((label, dow) => ({ dow, label, count: chart.reduce((s, p) => s + (p.dowLocal === dow ? 1 : 0), 0) }));
  const monthOfYear = MONTH_LABELS.map((label, i) => ({ month: i + 1, label, count: chart.reduce((s, p) => s + (p.monthLocal === i + 1 ? 1 : 0), 0) }));
  const seasons = ["DJF", "MAM", "JJA", "SON"] as const;
  const seasonal = seasons.map((season) => ({
    season,
    label: SEASON_LABELS[season],
    count: chart.reduce((s, p) => s + (seasonOf(p.monthLocal) === season ? 1 : 0), 0),
  }));

  const segAgg = new Map<number, { count: number; weight: number }>();
  for (const p of chart) {
    if (p.segmentId === null) continue;
    const a = segAgg.get(p.segmentId) ?? { count: 0, weight: 0 };
    a.count++;
    a.weight += p.severityWeight;
    segAgg.set(p.segmentId, a);
  }
  const topSegments: SegmentStatsRow[] = [...segAgg.entries()]
    .map(([id, a]) => {
      const seg = net.segmentById.get(id);
      if (!seg) return null;
      const km = seg.lengthM / 1000;
      return {
        segmentId: id,
        name: seg.name,
        roadClass: seg.roadClass,
        lengthM: Math.round(seg.lengthM),
        count: a.count,
        severityWeight: round(a.weight, 1),
        perKm: round(a.count / km, 2),
        severityPerKm: round(a.weight / km, 2),
        aadt: net.traffic.get(id) ?? null,
      };
    })
    .filter((r): r is SegmentStatsRow => r !== null)
    .sort((a, b) => b.count - a.count || b.severityWeight - a.severityWeight)
    .slice(0, 15);

  // Spatial concentration: incidents per 500 m cell across the network extent (zeros included).
  const xs = net.segments.flatMap((s) => s.utm.map((p) => p[0]));
  const ys = net.segments.flatMap((s) => s.utm.map((p) => p[1]));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = Math.max(1, Math.ceil((Math.max(...xs) - minX) / CELL_M));
  const rows = Math.max(1, Math.ceil((Math.max(...ys) - minY) / CELL_M));
  const cellCounts = new Float64Array(cols * rows);
  for (const p of chart) {
    const c = Math.floor((p.x - minX) / CELL_M);
    const r = Math.floor((p.y - minY) / CELL_M);
    if (c >= 0 && r >= 0 && c < cols && r < rows) cellCounts[r * cols + c]! += 1;
  }
  const sortedCells = Array.from(cellCounts).sort((a, b) => a - b);
  const totalInc = sortedCells.reduce((s, v) => s + v, 0);
  let cum = 0;
  const lorenz: [number, number][] = [[0, 0]];
  sortedCells.forEach((v, i) => {
    cum += v;
    if ((i + 1) % Math.max(1, Math.round(sortedCells.length / 10)) === 0 || i === sortedCells.length - 1) {
      lorenz.push([round((i + 1) / sortedCells.length, 3), totalInc > 0 ? round(cum / totalInc, 3) : 0]);
    }
  });

  const delays = chart.map((p) => p.reportingDelayMin);
  const med = quantile(delays, 0.5);
  const p90 = quantile(delays, 0.9);

  return {
    scope: {
      records: chart.length,
      byStatus,
      syntheticShare: chart.length ? round(chart.filter((p) => p.isSynthetic).length / chart.length, 3) : 0,
      datasets: new Set(chart.map((p) => p.datasetId)).size,
      years: [...new Set(chart.map((p) => p.yearLocal))].sort((a, b) => a - b),
      statusesIncluded: chartStatuses,
    },
    severity,
    categories,
    monthly,
    hourly,
    dayOfWeek,
    monthOfYear,
    seasonal,
    topSegments,
    concentration: {
      cellSizeM: CELL_M,
      occupiedCells: cellCounts.reduce((s, v) => s + (v > 0 ? 1 : 0), 0),
      top10PctShare: round(topShare(cellCounts, 0.1), 3),
      lorenz,
    },
    reportingDelay: { medianMin: med === null ? null : Math.round(med), p90Min: p90 === null ? null : Math.round(p90) },
  };
}

export async function dashboard(f: FilterSpec, viewerIsAdmin: boolean) {
  const allowed = viewerIsAdmin ? [...ACCIDENT_STATUSES] : (["verified"] as AccidentStatus[]);
  const points = await loadAccidentPoints({ ...f, statuses: allowed });
  const net = await loadNetwork();
  const chartStatuses = f.statuses.filter((s) => allowed.includes(s));
  return buildDashboard(points, chartStatuses.length ? chartStatuses : ["verified"], net);
}

export async function segmentsLayer(f: FilterSpec, viewerIsAdmin: boolean) {
  const statuses = viewerIsAdmin ? f.statuses : (["verified"] as AccidentStatus[]);
  const points = await loadAccidentPoints({ ...f, statuses });
  const net = await loadNetwork();
  const years = observationYears(points);
  const counts = new Map<number, { count: number; weight: number; cats: Partial<Record<CategoryCode, number>> }>();
  for (const p of points) {
    if (p.segmentId === null) continue;
    const c = counts.get(p.segmentId) ?? { count: 0, weight: 0, cats: {} };
    c.count++;
    c.weight += p.severityWeight;
    c.cats[p.categoryCode] = (c.cats[p.categoryCode] ?? 0) + 1;
    counts.set(p.segmentId, c);
  }
  const features: GeoFeature[] = net.segments.map((s: SegmentRow) => {
    const c = counts.get(s.id) ?? { count: 0, weight: 0, cats: {} };
    const km = s.lengthM / 1000;
    const aadt = net.traffic.get(s.id) ?? null;
    const exposure = aadt && years > 0 ? (c.count / years) / ((aadt * km * 365) / 1e6) : null;
    return {
      type: "Feature",
      geometry: { type: "LineString", coordinates: s.lonLat },
      properties: {
        segmentId: s.id,
        name: s.name,
        roadClass: s.roadClass,
        speedLimitKmh: s.speedLimitKmh,
        lanes: s.lanes,
        lightingScore: s.lightingScore,
        lengthM: Math.round(s.lengthM),
        count: c.count,
        severityWeight: round(c.weight, 1),
        perKm: round(c.count / km, 2),
        severityPerKm: round(c.weight / km, 2),
        aadt,
        exposureRate: exposure === null ? null : round(exposure, 2),
        value: round(c.count / km, 2),
      },
    };
  });
  return { type: "FeatureCollection" as const, features, meta: { totalIncidents: points.length, years: round(years, 2) } };
}

export async function segmentDetail(segmentId: number, f: FilterSpec, viewerIsAdmin: boolean): Promise<SegmentDetail> {
  const net = await loadNetwork();
  const seg = net.segmentById.get(segmentId);
  if (!seg) throw new ApiError(404, "not_found", "Road segment not found");
  const statuses = viewerIsAdmin ? f.statuses : (["verified"] as AccidentStatus[]);
  const points = (await loadAccidentPoints({ ...f, statuses })).filter((p) => p.segmentId === segmentId);
  const km = seg.lengthM / 1000;
  const years = observationYears(points);
  const aadt = net.traffic.get(segmentId) ?? null;
  const sevSum = points.reduce((s, p) => s + p.severityWeight, 0);
  const recent = await recentForSegment(segmentId, statuses, 12);
  const byCategory = CATEGORY_CODES.map((code) => ({
    code,
    label: CATEGORY_META[code].label,
    count: points.filter((p) => p.categoryCode === code).length,
  }));
  const bySeverity = SEVERITY_IDS.map((id) => ({ id, label: SEVERITY_META[id].label, count: points.filter((p) => p.severityId === id).length }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: points.filter((p) => p.hourLocal === hour).length }));
  void years;
  return {
    segment: {
      id: seg.id,
      code: seg.code,
      name: seg.name,
      roadClass: seg.roadClass,
      speedLimitKmh: seg.speedLimitKmh,
      lanes: seg.lanes,
      lightingScore: seg.lightingScore,
      lengthM: Math.round(seg.lengthM),
      aadt,
    },
    stats: {
      count: points.length,
      severityWeight: round(sevSum, 1),
      perKm: round(points.length / km, 2),
      severityPerKm: round(sevSum / km, 2),
      meanSeverity: points.length ? round(points.reduce((s, p) => s + p.severityId, 0) / points.length, 2) : null,
      byCategory,
      bySeverity,
      byHour,
    },
    recent,
  };
}

export async function qualityReport(): Promise<QualityReport> {
  const all = await loadAccidentPoints({ ...DEFAULT_FILTERS, statuses: [...ACCIDENT_STATUSES], datasetIds: null });
  const totals = { ...zeroStatus(), all: all.length, syntheticShare: 0 };
  for (const p of all) totals[p.status]++;
  totals.syntheticShare = all.length ? round(all.filter((p) => p.isSynthetic).length / all.length, 3) : 0;
  const flags: Record<string, number> = {};
  for (const flag of QUALITY_FLAGS) flags[flag] = all.filter((p) => p.qualityFlags.includes(flag)).length;
  const delays = all.map((p) => p.reportingDelayMin);
  const med = quantile(delays, 0.5);
  const p90 = quantile(delays, 0.9);
  const verifiedLike = totals.verified + totals.rejected + totals.duplicate;

  const comp = await db.execute<{ total: string; described: string; vehicles_ok: string; timestamps_ok: string }>(sql`
    select count(*) as total,
      count(*) filter (where a.description <> '') as described,
      count(*) filter (where a.vehicles_involved between 1 and 50) as vehicles_ok,
      count(*) filter (where a.occurred_at <= a.reported_at) as timestamps_ok
    from accidents a join dataset_sources d on d.id = a.dataset_source_id
    where d.is_active = true
  `);
  const c = comp.rows[0];
  const total = Number(c?.total ?? 0) || 1;

  const acc = await db.execute<{ p50: string | null; p90: string | null; n: string }>(sql`
    select percentile_cont(0.5) within group (order by a.reported_accuracy_m) as p50,
           percentile_cont(0.9) within group (order by a.reported_accuracy_m) as p90,
           count(*) as n
    from accidents a join dataset_sources d on d.id = a.dataset_source_id
    where d.kind = 'citizen' and a.reported_accuracy_m is not null
  `);
  const a = acc.rows[0];

  const activity = await db.execute<{ day: string; reports: string }>(sql`
    select to_char((a.reported_at at time zone ${STUDY_AREA.timeZone})::date, 'YYYY-MM-DD') as day, count(*) as reports
    from accidents a join dataset_sources d on d.id = a.dataset_source_id
    where d.kind = 'citizen' and a.reported_at >= now() - interval '30 days'
    group by 1 order by 1
  `);

  return {
    generatedAt: new Date().toISOString(),
    totals,
    completeness: {
      description: round(Number(c?.described ?? 0) / total, 3),
      coordinates: 1,
      vehicles: round(Number(c?.vehicles_ok ?? 0) / total, 3),
      timestamps: round(Number(c?.timestamps_ok ?? 0) / total, 3),
    },
    flags,
    reportingDelay: { medianMin: med === null ? null : Math.round(med), p90Min: p90 === null ? null : Math.round(p90) },
    verificationRate: verifiedLike > 0 ? round(totals.verified / verifiedLike, 3) : null,
    positionalAccuracy: {
      medianM: a?.p50 === null || a?.p50 === undefined ? null : round(Number(a.p50), 1),
      p90M: a?.p90 === null || a?.p90 === undefined ? null : round(Number(a.p90), 1),
      sample: Number(a?.n ?? 0),
    },
    activityByDay: activity.rows.map((r) => ({ date: r.day, reports: Number(r.reports) })),
    duplicateCandidates: all.filter((p) => p.duplicateCandidateId !== null && p.status === "reported").length,
  };
}

export { CATEGORY_CODES as _categoryCodes };
export type { CategoryCode };
