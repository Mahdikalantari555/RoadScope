import { poissonCI } from "@/lib/geo/stats";
import { localParts } from "@/lib/geo/time";
import { getNetwork, loadAccidents } from "@/lib/server/data";
import { ApiError, handle, parseFilters } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/roads/:id — segment attributes + accident statistics under the current filters. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id);
  const net = await getNetwork();
  const seg = net?.byId.get(id);
  if (!seg) throw new ApiError(404, "Road segment not found");
  const f = parseFilters(new URL(req.url).searchParams);
  const all = await loadAccidents({ ...f, statuses: ["verified", "reported"] });
  const rows = all.filter((r) => r.segmentId === id);
  const verified = rows.filter((r) => r.status === "verified");
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const hours = new Array<number>(24).fill(0);
  for (const r of verified) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    hours[localParts(r.t).hour]++;
  }
  const span = all.length ? Math.max(1 / 12, ((f.to ? Date.parse(f.to) : all[all.length - 1].t) - (f.from ? Date.parse(f.from) : all[0].t)) / (365.25 * 86400000)) : 1;
  const [lo, hi] = poissonCI(verified.length);
  const km = seg.lengthM / 1000;
  return Response.json({
    segment: { id: seg.id, name: seg.name, roadClass: seg.roadClass, speedLimit: seg.speedLimit, lanes: seg.lanes, lit: seg.lit, surface: seg.surface, lengthM: seg.lengthM, aadt: seg.aadt },
    years: span,
    verified: verified.length,
    pending: rows.length - verified.length,
    ci95: [lo, hi],
    densityKmYr: verified.length / km / span,
    densityCi: [lo / km / span, hi / km / span],
    ratePerMVKm: seg.aadt ? verified.length / ((km * seg.aadt * 365 * span) / 1e6) : null,
    bySeverity,
    byCategory,
    hours,
    incidents: rows.slice(-50).reverse().map((r) => ({ id: r.id, trackingCode: r.trackingCode, t: r.t, category: r.category, severity: r.severity, status: r.status })),
  });
});
