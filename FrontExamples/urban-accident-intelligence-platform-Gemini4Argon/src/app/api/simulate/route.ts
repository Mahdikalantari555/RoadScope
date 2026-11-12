import { NextRequest, NextResponse } from "next/server";
import {
  rebuildSimulationDataset,
  getPlatformState,
} from "@/lib/geo/platformService";
import type { SimulationScenarioType } from "@/lib/geo/simulator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validScenarios: SimulationScenarioType[] = [
      "uniform_baseline",
      "intersection_clustered",
      "diurnal_rush_hour_shock",
      "multi_covariate_complex_urban",
    ];
    const scenarioType: SimulationScenarioType = validScenarios.includes(
      body.scenarioType
    )
      ? body.scenarioType
      : "multi_covariate_complex_urban";

    const seed = Number.isFinite(Number(body.seed)) ? Number(body.seed) : 42;
    const lixelSizeM = Number.isFinite(Number(body.lixelSizeM))
      ? Math.max(10, Math.min(200, Number(body.lixelSizeM)))
      : 50;
    const baseIntensityMultiplier = Number.isFinite(
      Number(body.baseIntensityMultiplier)
    )
      ? Math.max(0.25, Math.min(2.5, Number(body.baseIntensityMultiplier)))
      : 1.0;
    const gaussianDriftStdM = Number.isFinite(Number(body.gaussianDriftStdM))
      ? Math.max(2.0, Math.min(50.0, Number(body.gaussianDriftStdM)))
      : 14.0;
    const duplicateBurstRate = Number.isFinite(Number(body.duplicateBurstRate))
      ? Math.max(0.0, Math.min(0.85, Number(body.duplicateBurstRate)))
      : 0.32;
    const falseAlarmRate = Number.isFinite(Number(body.falseAlarmRate))
      ? Math.max(0.0, Math.min(0.4, Number(body.falseAlarmRate)))
      : 0.08;

    await rebuildSimulationDataset({
      scenarioType,
      seed,
      lixelSizeM,
      baseIntensityMultiplier,
      gaussianDriftStdM,
      duplicateBurstRate,
      falseAlarmRate,
    });

    const state = await getPlatformState();
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    console.error("Error in POST /api/simulate:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to run network simulation",
      },
      { status: 500 }
    );
  }
}
