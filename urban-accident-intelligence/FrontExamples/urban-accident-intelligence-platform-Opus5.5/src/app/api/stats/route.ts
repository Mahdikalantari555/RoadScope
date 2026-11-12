import { DEFAULT_ANALYSIS_STATUSES } from "@/lib/domain";
import { gini } from "@/lib/geo/stats";
import { temporalProfile } from "@/lib/geo/temporal";
import { segmentAggregation } from "@/lib/server/analysis";
import { getNetwork, loadAccidents } from "@/lib/server/data";
import { handle, parseFilters } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** GET /api/stats — dashboard aggregates. KPIs use all statuses; analytical charts use `statuses` (default: verified). */
export const GET = handle(async (req: Request) => {
  await ensureSeeded();
  const f = parseFilters(new URL(req.url).searchParams);
  const all = await loadAccidents({ ...f, statuses: undefined });
  const statuses = f.statuses?.length ? f.statuses : DEFAULT_ANALYSIS_STATUSES;
  const rows = all.filter((r) => statuses.includes(r.status));
  const byStatus: Record<string, number> = { reported: 0, verified: 0, rejected: 0, duplicate: 0 };
  all.forEach((r) => (byStatus[r.status] = (byStatus[r.status] ?? 0) + 1));
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byWeather: Record<string, number> = {};
  const byLight: Record<string, number> = {};
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    if (r.weather) byWeather[r.weather] = (byWeather[r.weather] ?? 0) + 1;
    if (r.light) byLight[r.light] = (byLight[r.light] ?? 0) + 1;
  }
  const temporal = temporalProfile(rows);
  const net = await getNetwork();
  const years = rows.length ? Math.max(1 / 12, ((f.to ? Date.parse(f.to) : rows[rows.length - 1].t) - (f.from ? Date.parse(f.from) : rows[0].t)) / (365.25 * 86400000)) : 1;
  const agg = net ? segmentAggregation(rows, net.segments, years) : [];
  const sorted = [...agg].sort((a, b) => b.densityKmYr - a.densityKmYr);
  const totalLen = agg.reduce((a, s) => a + s.lengthM, 0);
  let len = 0;
  let cnt = 0;
  for (const s of sorted) {
    if (len >= totalLen * 0.05) break;
    len += s.lengthM;
    cnt += s.n;
  }
  const synthetic = all.filter((r) => r.isSynthetic).length;
  return Response.json({
    statusesUsed: statuses,
    total: all.length,
    byStatus,
    analysed: rows.length,
    bySeverity,
    byCategory,
    byWeather,
    byLight,
    fatalSerious: (bySeverity.fatal ?? 0) + (bySeverity.serious ?? 0),
    temporal,
    years,
    topSegments: sorted.filter((s) => s.n > 0).slice(0, 12),
    concentration: { gini: gini(agg.map((a) => a.densityKmYr)), shareTop5PctLength: rows.length ? cnt / rows.length : 0, segmentsWithEvents: agg.filter((a) => a.n > 0).length, segments: agg.length },
    unassigned: rows.filter((r) => !r.segmentId).length,
    syntheticShare: all.length ? synthetic / all.length : 0,
  });
});
