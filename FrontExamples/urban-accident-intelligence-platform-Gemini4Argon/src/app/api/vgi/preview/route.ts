import { NextRequest, NextResponse } from "next/server";
import { previewCitizenPinAndConflation } from "@/lib/geo/platformService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const preview = await previewCitizenPinAndConflation({
      lon: body.lon !== undefined ? Number(body.lon) : undefined,
      lat: body.lat !== undefined ? Number(body.lat) : undefined,
      xM: body.xM !== undefined ? Number(body.xM) : undefined,
      yM: body.yM !== undefined ? Number(body.yM) : undefined,
      observationalRadiusM: Number(body.observationalRadiusM ?? 15),
      incidentTimestampUtc: body.incidentTimestampUtc,
      categoryCode: body.categoryCode,
      severityCode: body.severityCode,
      preferGradeSeparatedOverpass: Boolean(body.preferGradeSeparatedOverpass),
    });

    return NextResponse.json({ ok: true, data: preview });
  } catch (error) {
    console.error("Error in POST /api/vgi/preview:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to compute VGI preview",
      },
      { status: 400 }
    );
  }
}
