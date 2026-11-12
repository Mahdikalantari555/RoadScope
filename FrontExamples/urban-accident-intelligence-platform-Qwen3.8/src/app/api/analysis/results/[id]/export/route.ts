import { db } from "@/db";
import { eq } from "drizzle-orm";
import { spatialAnalysisResults } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { toUtm } from "@/lib/geo/projection";
import { toCsv, toWkt } from "@/lib/geojson";
import { ApiError, handleApiError, queryString } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const FORMATS = ["geojson", "csv", "wkt", "json"] as const;

/**
 * GET /api/analysis/results/:id/export?format=geojson|csv|wkt|json
 * Open-standard export for publication figures and external reproduction.
 * WKT is emitted in the canonical metric CRS with an explicit SRID header;
 * GeoJSON in CRS84; CSV flattens feature properties; JSON is the full
 * provenance manifest (parameters, CRS, runtime, formulation, benchmark).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const q = queryString(req.url);
    const format = (q.get("format") ?? "geojson") as (typeof FORMATS)[number];
    if (!FORMATS.includes(format)) throw new ApiError(400, "invalid_format", FORMATS);

    const [result] = await db.select().from(spatialAnalysisResults).where(eq(spatialAnalysisResults.id, id)).limit(1);
    if (!result) throw new ApiError(404, "result_not_found");
    const ctx = await requireDataset(result.datasetId);
    const features = ((result.features as any)?.features ?? []) as any[];
    const stem = `uai_${result.method}_${result.id.slice(0, 8)}`;

    if (format === "geojson") {
      return new Response(JSON.stringify(result.features ?? { type: "FeatureCollection", features: [] }, null, 2), {
        headers: { "content-type": "application/geo+json", "content-disposition": `attachment; filename="${stem}.geojson"` },
      });
    }

    if (format === "csv") {
      const rows = features.map((f) => {
        const geom = f.geometry;
        let lon: number | null = null;
        let lat: number | null = null;
        if (geom?.type === "Point") {
          lon = geom.coordinates[0];
          lat = geom.coordinates[1];
        } else if (geom?.type === "LineString") {
          const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
          lon = mid[0];
          lat = mid[1];
        } else if (geom?.type === "Polygon") {
          const ring = geom.coordinates[0];
          lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        }
        const props = f.properties ?? {};
        const flat: Record<string, unknown> = { feature_id: f.id ?? null, lon_wgs84: lon, lat_wgs84: lat, srid_canonical: result.srid };
        for (const [k, v] of Object.entries(props)) {
          flat[k] = Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v;
        }
        return flat;
      });
      return new Response(toCsv(rows), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${stem}.csv"` },
      });
    }

    if (format === "wkt") {
      const geometries = features.map((f) => {
        const geom = f.geometry;
        const toMetric = (c: [number, number]) => {
          const p = toUtm(c[0], c[1], ctx.crs);
          return [p.x, p.y] as [number, number];
        };
        if (geom?.type === "Point") return { type: "point" as const, coords: [toMetric(geom.coordinates)], props: f.properties ?? {} };
        if (geom?.type === "LineString") return { type: "line" as const, coords: geom.coordinates.map(toMetric), props: f.properties ?? {} };
        return { type: "line" as const, coords: (geom?.coordinates?.[0] ?? []).map(toMetric), props: f.properties ?? {} };
      });
      return new Response(toWkt(ctx.crs, geometries), {
        headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${stem}.wkt"` },
      });
    }

    const manifest = {
      provenance: {
        platform: "Urban Accident Intelligence",
        generatorVersion: ctx.dataset.generatorVersion,
        exportedAt: new Date().toISOString(),
        resultId: result.id,
        jobId: result.jobId,
        method: result.method,
        parameters: result.params,
        crs: { canonical: { authority: ctx.dataset.crsAuthority, srid: result.srid, name: result.crsName, units: "metre" }, serialised: "OGC CRS84" },
        dataset: { id: ctx.dataset.id, slug: ctx.dataset.slug, kind: ctx.dataset.kind, scenario: ctx.dataset.scenario, seed: ctx.dataset.seed, synthetic: ctx.dataset.kind === "synthetic" },
        sampleSize: result.sampleSize,
        unitCount: result.unitCount,
        runtimeMs: result.runtimeMs,
        lixelLengthM: ctx.dataset.lixelLengthM,
      },
      formulation: result.formulation,
      statistics: result.stats,
      benchmark: result.benchmark,
    };
    return new Response(JSON.stringify(manifest, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${stem}_manifest.json"` },
    });
  } catch (err) {
    const e = err;
    if (e instanceof ApiError) return Response.json({ error: e.message, detail: e.detail }, { status: e.status });
    return handleApiError(e);
  }
}
