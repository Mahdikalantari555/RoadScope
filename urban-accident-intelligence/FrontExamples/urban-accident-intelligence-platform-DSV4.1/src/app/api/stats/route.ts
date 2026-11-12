import { jsonError, jsonOk, searchParamsOf } from "@/lib/api";
import { computeStatistics } from "@/lib/analytics";
import { countAccidentsByStatus, loadAccidents, loadMetadata } from "@/lib/data";
import { parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const filters = parseFilters(searchParamsOf(request));
    const [meta, accidents, statusCounts] = await Promise.all([
      loadMetadata(),
      loadAccidents(filters),
      countAccidentsByStatus(),
    ]);
    const categoryLabels = Object.fromEntries(meta.categories.map((c) => [c.code, { label: c.label, color: c.color }]));
    const severityLabels = Object.fromEntries(meta.severities.map((s) => [s.code, { label: s.label, color: s.color }]));
    const stats = computeStatistics(accidents, meta.segments, categoryLabels, severityLabels);
    return jsonOk({
      stats,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.count)])),
      filters,
      meta: {
        categories: meta.categories,
        severities: meta.severities,
        districts: meta.districts,
        datasets: meta.datasets,
        segments: meta.segments.length,
        intersections: meta.intersections.length,
      },
      syntheticNotice:
        "All statistics are computed from a synthetic dataset generated with a fixed seed. They must not be cited as real-world road safety findings.",
    });
  } catch (error) {
    console.error("GET /api/stats failed", error);
    return jsonError("Unable to compute statistics.", 500);
  }
}
