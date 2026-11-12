import { desc } from "drizzle-orm";
import { db } from "@/db";
import { spatialAnalysisJobs, spatialAnalysisResults } from "@/db/schema";
import { jsonError, jsonOk, logAudit, searchParamsOf } from "@/lib/api";
import { DEFAULT_ANALYSIS_PARAMS, parseAnalysisParams, runAnalysis, type AnalysisKind } from "@/lib/analysis";
import { loadAccidents, loadEnvironmentObservations, loadMetadata } from "@/lib/data";
import { parseFilters, type FilterInput } from "@/lib/filters";

export const dynamic = "force-dynamic";

const KINDS: AnalysisKind[] = ["kde", "hotspot", "dbscan", "segment", "environment", "temporal"];

export async function GET() {
  try {
    const jobs = await db
      .select({
        id: spatialAnalysisJobs.id,
        kind: spatialAnalysisJobs.kind,
        status: spatialAnalysisJobs.status,
        createdAt: spatialAnalysisJobs.startedAt,
        durationMs: spatialAnalysisJobs.durationMs,
        featureCount: spatialAnalysisJobs.featureCount,
        params: spatialAnalysisJobs.params,
        summary: spatialAnalysisJobs.summary,
        createdBy: spatialAnalysisJobs.createdBy,
      })
      .from(spatialAnalysisJobs)
      .orderBy(desc(spatialAnalysisJobs.id))
      .limit(12);
    return jsonOk({ jobs });
  } catch (error) {
    console.error("GET /api/analysis failed", error);
    return jsonError("Unable to list analysis jobs.", 500);
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const url = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      filters?: FilterInput;
      params?: Record<string, string>;
    };
    const kind = (body.kind ?? url.searchParams.get("kind") ?? "kde") as AnalysisKind;
    if (!KINDS.includes(kind)) return jsonError(`Unsupported analysis kind. Supported: ${KINDS.join(", ")}`, 400);

    const filterInput: FilterInput = { ...searchParamsOf(request), ...(body.filters ?? {}) };
    const filters = parseFilters(filterInput);
    const params = body.params ? parseAnalysisParams(body.params) : DEFAULT_ANALYSIS_PARAMS;

    const [meta, accidents, environmentObservations] = await Promise.all([
      loadMetadata(),
      loadAccidents(filters),
      loadEnvironmentObservations(1200),
    ]);
    const result = runAnalysis(kind, accidents, meta.segments, params, environmentObservations);

    const job = await db
      .insert(spatialAnalysisJobs)
      .values({
        kind,
        params: { analysis: params, filters, sampleSize: accidents.length },
        status: "completed",
        createdBy: "web-session",
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Math.round(Date.now() - started),
        featureCount: result.features.features.length,
        summary: {
          title: result.title,
          metrics: result.metrics,
          assumptions: result.assumptions,
          limitations: result.limitations,
        },
      })
      .returning({ id: spatialAnalysisJobs.id });

    const jobId = job[0].id;
    const storable = result.features.features.slice(0, 1200);
    if (storable.length > 0) {
      await db.insert(spatialAnalysisResults).values(
        storable.map((feature, index) => ({
          jobId,
          geometry: feature.geometry,
          value:
            typeof feature.properties?.value === "number"
              ? (feature.properties.value as number)
              : typeof feature.properties?.z === "number"
                ? (feature.properties.z as number)
                : null,
          classification:
            typeof feature.properties?.classification === "string"
              ? (feature.properties.classification as string)
              : null,
          rank: index + 1,
          properties: feature.properties ?? {},
        })),
      );
    }

    await logAudit({
      actor: "web-session",
      action: `analysis.${kind}`,
      entityType: "spatial_analysis_job",
      entityId: String(jobId),
      detail: { sampleSize: accidents.length, durationMs: Date.now() - started, featureCount: result.features.features.length },
    });

    return jsonOk({
      jobId,
      ...result,
      sampleSize: accidents.length,
      storedFeatures: storable.length,
      truncated: result.features.features.length > storable.length,
    });
  } catch (error) {
    console.error("POST /api/analysis failed", error);
    return jsonError("Spatial analysis failed. Adjust the parameters and retry.", 500);
  }
}

export const runtime = "nodejs";
export const maxDuration = 60;
