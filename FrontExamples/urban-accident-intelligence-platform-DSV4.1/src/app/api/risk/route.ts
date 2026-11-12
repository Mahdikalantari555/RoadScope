import { jsonError, jsonOk, searchParamsOf } from "@/lib/api";
import { aggregateBySegment } from "@/lib/analytics";
import { loadAccidents, loadMetadata } from "@/lib/data";
import { parseFilters } from "@/lib/filters";
import { computeRisk, DEFAULT_RISK_OPTIONS, parseRiskOptions } from "@/lib/risk";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = searchParamsOf(request);
    const filters = parseFilters(params);
    const flat: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(params)) flat[key] = Array.isArray(value) ? value[0] : value;
    const options = { ...DEFAULT_RISK_OPTIONS, ...parseRiskOptions(flat) };
    const [meta, accidents] = await Promise.all([loadMetadata(), loadAccidents(filters)]);
    const aggregates = aggregateBySegment(accidents, meta.segments);
    const risk = computeRisk(aggregates, options);
    const maxIndex = Math.max(1, ...risk.segments.map((s) => s.riskIndex));
    return jsonOk({
      ...risk,
      options,
      segments: risk.segments.map(({ geometry, ...rest }) => ({ ...rest, hasGeometry: GeometryType(geometry) })),
      features: {
        type: "FeatureCollection",
        features: risk.segments
          .filter((s) => s.count > 0)
          .map((s) => ({
            type: "Feature",
            geometry: s.geometry,
            properties: {
              segmentId: s.segmentId,
              name: s.name,
              roadClass: s.roadClass,
              district: s.district,
              count: s.count,
              ksi: s.ksi,
              severityWeighted: s.severityWeighted,
              densityPerKm: Number(s.densityPerKm.toFixed(2)),
              riskIndex: Number(s.riskIndex.toFixed(1)),
              phase: Number(((s.riskIndex / maxIndex) * 100).toFixed(1)),
              rank: s.rank,
              uncertainty: Number(s.uncertainty.toFixed(2)),
              ratePer100mVehKm: s.ratePer100mVehKm === null ? null : Number(s.ratePer100mVehKm.toFixed(3)),
              aadt: s.aadt,
            },
          })),
      },
      filters,
      recordCount: accidents.length,
      disclaimer:
        "Relative risk index only. Not a calibrated probability, not a prediction, and not validated against independent outcomes.",
    });
  } catch (error) {
    console.error("GET /api/risk failed", error);
    return jsonError("Unable to compute the risk index.", 500);
  }
}

function GeometryType(geometry: { type: string }): string {
  return geometry.type;
}
