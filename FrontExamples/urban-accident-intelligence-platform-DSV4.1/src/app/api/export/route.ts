import { jsonError } from "@/lib/api";
import { aggregateBySegment } from "@/lib/analytics";
import { loadAccidents, loadMetadata } from "@/lib/data";
import { parseFilters } from "@/lib/filters";
import { computeRisk, parseRiskOptions } from "@/lib/risk";
import { spatialAnalysisResults, spatialAnalysisJobs } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "no_rows\n";
  const keys = columns ?? Object.keys(rows[0]);
  const header = keys.join(",");
  const body = rows.map((row) => keys.map((key) => csvEscape(row[key])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "accidents";
    const format = url.searchParams.get("format") ?? "csv";
    const filters = parseFilters(Object.fromEntries(url.searchParams.entries()));
    const meta = await loadMetadata();

    if (kind === "analysis") {
      const jobId = Number(url.searchParams.get("jobId"));
      if (!Number.isInteger(jobId)) return jsonError("jobId is required for analysis exports.", 400);
      const jobs = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, jobId)).limit(1);
      if (jobs.length === 0) return jsonError("Analysis job not found.", 404);
      const results = await db
        .select()
        .from(spatialAnalysisResults)
        .where(eq(spatialAnalysisResults.jobId, jobId))
        .orderBy(asc(spatialAnalysisResults.rank))
        .limit(1500);
      if (format === "geojson") {
        const payload = {
          type: "FeatureCollection",
          metadata: {
            jobId,
            kind: jobs[0].kind,
            params: jobs[0].params,
            generatedAt: new Date().toISOString(),
            synthetic: true,
            licence: "Synthetic demonstration data — not for operational use.",
          },
          features: results.map((r) => ({
            type: "Feature",
            geometry: r.geometry,
            properties: { ...(r.properties as Record<string, unknown>), value: r.value, classification: r.classification, rank: r.rank },
          })),
        };
        return new Response(JSON.stringify(payload, null, 2), {
          headers: {
            "Content-Type": "application/geo+json",
            "Content-Disposition": `attachment; filename="uai-analysis-${jobId}-${jobs[0].kind}.geojson"`,
          },
        });
      }
      const csv = toCsv(
        results.map((r) => ({
          rank: r.rank,
          classification: r.classification,
          value: r.value,
          geometry: JSON.stringify(r.geometry),
          properties: JSON.stringify(r.properties),
        })),
      );
      return new Response(`# synthetic analysis export, job ${jobId}, kind ${jobs[0].kind}\n${csv}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="uai-analysis-${jobId}-${jobs[0].kind}.csv"`,
        },
      });
    }

    if (kind === "risk") {
      const flat: Record<string, string | undefined> = Object.fromEntries(url.searchParams.entries());
      const options = parseRiskOptions(flat);
      const accidents = await loadAccidents(filters);
      const risk = computeRisk(aggregateBySegment(accidents, meta.segments), options);
      const rows = risk.segments.map((s) => ({
        rank: s.rank,
        segment_id: s.segmentId,
        name: s.name,
        road_class: s.roadClass,
        district: s.district,
        length_m: Math.round(s.lengthM),
        accidents: s.count,
        ksi: s.ksi,
        severity_weighted: s.severityWeighted,
        density_per_km: Number(s.densityPerKm.toFixed(3)),
        aadt: s.aadt ?? "",
        rate_per_100m_veh_km: s.ratePer100mVehKm === null ? "" : Number(s.ratePer100mVehKm.toFixed(4)),
        frequency_component: Number(s.components.frequency.toFixed(4)),
        severity_component: Number(s.components.severity.toFixed(4)),
        density_component: Number(s.components.density.toFixed(4)),
        exposure_component: Number(s.components.exposure.toFixed(4)),
        environment_component: Number(s.components.environment.toFixed(4)),
        risk_index_0_100: Number(s.riskIndex.toFixed(2)),
        uncertainty: Number(s.uncertainty.toFixed(3)),
        evidence_class: s.evidenceClass,
        note: "relative index, not a probability",
      }));
      if (format === "geojson") {
        return new Response(
          JSON.stringify(
            {
              type: "FeatureCollection",
              metadata: { synthetic: true, generatedAt: new Date().toISOString(), weights: options.weights },
              features: risk.segments
                .filter((s) => s.count > 0)
                .map((s) => ({
                  type: "Feature",
                  geometry: s.geometry,
                  properties: {
                    segmentId: s.segmentId,
                    name: s.name,
                    riskIndex: Number(s.riskIndex.toFixed(2)),
                    accidents: s.count,
                    ksi: s.ksi,
                    rank: s.rank,
                  },
                })),
            },
            null,
            2,
          ),
          {
            headers: {
              "Content-Type": "application/geo+json",
              "Content-Disposition": 'attachment; filename="uai-risk-segments.geojson"',
            },
          },
        );
      }
      return new Response(`# synthetic relative risk export — not a probability\n${toCsv(rows)}`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="uai-risk-segments.csv"',
        },
      });
    }

    const records = await loadAccidents(filters);
    if (format === "geojson") {
      return new Response(
        JSON.stringify(
          {
            type: "FeatureCollection",
            metadata: {
              synthetic: true,
              generator: "Urban Accident Intelligence synthetic generator v1.0",
              seed: meta.datasets[0]?.seed ?? null,
              filters,
              exportedAt: new Date().toISOString(),
            },
            features: records.map((r) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [r.lng, r.lat] },
              properties: {
                publicId: r.publicId,
                status: r.status,
                category: r.categoryCode,
                severity: r.severityCode,
                occurredAt: r.occurredAt,
                reportedAt: r.reportedAt,
                district: r.district,
                segmentId: r.roadSegmentId,
                weather: r.weather,
                surface: r.roadSurface,
                lighting: r.lighting,
                casualties: r.casualties,
                fatalities: r.fatalities,
                positionalUncertaintyM: r.positionalUncertaintyM,
                synthetic: true,
              },
            })),
          },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/geo+json",
            "Content-Disposition": 'attachment; filename="uai-accidents.geojson"',
          },
        },
      );
    }
    const rows = records.map((r) => ({
      public_id: r.publicId,
      status: r.status,
      occurred_at_utc: r.occurredAt,
      reported_at_utc: r.reportedAt,
      category: r.categoryCode,
      severity: r.severityCode,
      lat: r.lat,
      lng: r.lng,
      district: r.district ?? "",
      road_segment_id: r.roadSegmentId ?? "",
      vehicles: r.vehicles,
      casualties: r.casualties,
      fatalities: r.fatalities,
      weather: r.weather ?? "",
      road_surface: r.roadSurface ?? "",
      lighting: r.lighting ?? "",
      positional_uncertainty_m: r.positionalUncertaintyM,
      quality_flags: r.qualityFlags.join("|"),
      dataset: r.datasetName ?? "",
      synthetic: "true",
    }));
    return new Response(`# Urban Accident Intelligence — synthetic export (${rows.length} records)\n${toCsv(rows)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="uai-accidents.csv"',
      },
    });
  } catch (error) {
    console.error("export failed", error);
    return jsonError("Export failed.", 500);
  }
}
