import { NextRequest, NextResponse } from "next/server";
import { getPlatformState } from "@/lib/geo/platformService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getPlatformState();
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    console.error("Error in GET /api/platform:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load platform state",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const weights = body?.weights;
    const state = await getPlatformState(weights);
    return NextResponse.json({ ok: true, data: state });
  } catch (error) {
    console.error("Error in POST /api/platform:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to recompute portfolio",
      },
      { status: 500 }
    );
  }
}
