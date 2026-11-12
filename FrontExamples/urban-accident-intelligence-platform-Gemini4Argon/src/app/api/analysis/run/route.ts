import { NextRequest, NextResponse } from "next/server";
import {
  executeAndPersistSpatialLabJob,
  getPlatformState,
  DEFAULT_LAB_PARAMS,
  LabAnalysisParameters,
} from "@/lib/geo/platformService";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const params: LabAnalysisParameters = {
      kernel:
        body.kernel === "gaussian" ||
        body.kernel === "epanechnikov" ||
        body.kernel === "quartic"
          ? body.kernel
          : DEFAULT_LAB_PARAMS.kernel,
      bandwidthM: Number.isFinite(Number(body.bandwidthM))
        ? Math.max(40, Math.min(600, Number(body.bandwidthM)))
        : DEFAULT_LAB_PARAMS.bandwidthM,
      useSeverityWeights:
        typeof body.useSeverityWeights === "boolean"
          ? body.useSeverityWeights
          : DEFAULT_LAB_PARAMS.useSeverityWeights,
      equalSplitAttenuation: Number.isFinite(Number(body.equalSplitAttenuation))
        ? Math.max(0, Math.min(1, Number(body.equalSplitAttenuation)))
        : DEFAULT_LAB_PARAMS.equalSplitAttenuation,
      giStarCutoffM: Number.isFinite(Number(body.giStarCutoffM))
        ? Math.max(80, Math.min(700, Number(body.giStarCutoffM)))
        : DEFAULT_LAB_PARAMS.giStarCutoffM,
      useFdrCorrection:
        typeof body.useFdrCorrection === "boolean"
          ? body.useFdrCorrection
          : DEFAULT_LAB_PARAMS.useFdrCorrection,
      dbscanEpsM: Number.isFinite(Number(body.dbscanEpsM))
        ? Math.max(40, Math.min(500, Number(body.dbscanEpsM)))
        : DEFAULT_LAB_PARAMS.dbscanEpsM,
      dbscanMinPts: Number.isFinite(Number(body.dbscanMinPts))
        ? Math.max(2, Math.min(15, Number(body.dbscanMinPts)))
        : DEFAULT_LAB_PARAMS.dbscanMinPts,
      includeUnverifiedVgi:
        typeof body.includeUnverifiedVgi === "boolean"
          ? body.includeUnverifiedVgi
          : DEFAULT_LAB_PARAMS.includeUnverifiedVgi,
      weights: body.weights ?? DEFAULT_LAB_PARAMS.weights,
    };

    const runResult = await executeAndPersistSpatialLabJob(params);

    await db.insert(auditLogs).values({
      actorRole: "gis_researcher",
      actorName: "Prof. Elena Vance",
      actionType: "SPATIAL_ANALYSIS_JOB_EXECUTED",
      entityType: "spatial_analysis_jobs",
      entityId: runResult.job.jobCode,
      detailsJson: {
        kernel: params.kernel,
        bandwidthM: params.bandwidthM,
        giStarCutoffM: params.giStarCutoffM,
        dbscanEpsM: params.dbscanEpsM,
        executionTimeMs: runResult.job.executionTimeMs,
        sampleSize: runResult.job.sampleSize,
      },
    });

    const state = await getPlatformState(params.weights);
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    console.error("Error in POST /api/analysis/run:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to run spatial analysis laboratory job",
      },
      { status: 500 }
    );
  }
}
