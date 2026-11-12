import { NextResponse } from "next/server";
import { runAllSpatialEngineTests } from "@/lib/geo/spatialEngineTests";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = runAllSpatialEngineTests();
  return NextResponse.json(report, { status: report.allPassed ? 200 : 500 });
}
