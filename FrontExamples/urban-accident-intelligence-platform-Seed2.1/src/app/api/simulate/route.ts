import { NextResponse } from "next/server";
import { seedReferenceData, seedSyntheticDataset } from "@/lib/db/repo";
import type { SimulationParams, Scenario } from "@/lib/simulation/generator";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Partial<SimulationParams>;
    await seedReferenceData();
    const params: Partial<SimulationParams> = {
      seed: body.seed ?? 42,
      scenario: (body.scenario as Scenario) ?? "complex_urban",
      lixelResolutionM: body.lixelResolutionM ?? 50,
      expectedCrashesPerYear: body.expectedCrashesPerYear ?? 800,
      vgiPositionalNoiseSigmaM: body.vgiPositionalNoiseSigmaM ?? 18,
      vgiDuplicateRate: body.vgiDuplicateRate ?? 0.35,
      vgiFalseAlarmRate: body.vgiFalseAlarmRate ?? 0.08,
    };
    const result = await seedSyntheticDataset(params);
    return NextResponse.json({
      ok: true,
      datasetId: result.datasetId,
      params: result.generated.params,
      stats: {
        nodes: result.nodeCount,
        segments: result.segmentCount,
        lixels: result.lixelCount,
        accidents: result.accidentCount,
        totalNetworkLengthKm: +(result.generated.totalNetworkLengthM / 1000).toFixed(2),
        scenarioName: result.generated.scenarioName,
      },
    });
  } catch (err) {
    console.error("simulate error:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  try {
    await seedReferenceData();
    const params = {
      seed: 42,
      scenario: "complex_urban" as Scenario,
      lixelResolutionM: 50,
      expectedCrashesPerYear: 800,
      vgiPositionalNoiseSigmaM: 18,
      vgiDuplicateRate: 0.35,
      vgiFalseAlarmRate: 0.08,
    };
    const result = await seedSyntheticDataset(params);
    return NextResponse.json({
      ok: true,
      datasetId: result.datasetId,
      params: result.generated.params,
      stats: {
        nodes: result.nodeCount,
        segments: result.segmentCount,
        lixels: result.lixelCount,
        accidents: result.accidentCount,
        totalNetworkLengthKm: +(result.generated.totalNetworkLengthM / 1000).toFixed(2),
        scenarioName: result.generated.scenarioName,
      },
    });
  } catch (err) {
    console.error("simulate GET error:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
