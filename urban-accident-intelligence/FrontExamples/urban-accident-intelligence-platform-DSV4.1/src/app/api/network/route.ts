import { jsonError, jsonOk } from "@/lib/api";
import { loadMetadata } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const meta = await loadMetadata();
    const byKind = (kind: string) =>
      meta.features
        .filter((f) => f.kind === kind)
        .map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: { name: f.name, ...(f.properties ?? {}) } }));
    return jsonOk({
      center: meta.districts[0]?.centroid ?? null,
      segments: {
        type: "FeatureCollection",
        features: meta.segments.map((s) => ({
          type: "Feature",
          geometry: s.geometry,
          properties: {
            segmentId: s.id,
            name: s.name,
            roadClass: s.roadClass,
            lanes: s.lanes,
            speedLimitKmh: s.speedLimitKmh,
            surface: s.surface,
            isLit: s.isLit,
            district: s.district,
            lengthM: s.lengthM,
            aadt: s.aadt,
            heavyVehiclePct: s.heavyVehiclePct,
          },
        })),
      },
      intersections: {
        type: "FeatureCollection",
        features: meta.intersections.map((i) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [i.lng, i.lat] },
          properties: { id: i.id, name: i.name, isSignalised: i.isSignalised, district: i.district, roads: i.roadNames },
        })),
      },
      water: { type: "FeatureCollection", features: byKind("water") },
      parks: { type: "FeatureCollection", features: byKind("park") },
      districts: { type: "FeatureCollection", features: byKind("district") },
      categories: meta.categories,
      severities: meta.severities,
      districtsMeta: meta.districts,
      datasets: meta.datasets,
      note: "Synthetic network geometry generated from a fixed seed. Not a real municipality.",
    });
  } catch (error) {
    console.error("GET /api/network failed", error);
    return jsonError("Unable to load the road network.", 500);
  }
}
