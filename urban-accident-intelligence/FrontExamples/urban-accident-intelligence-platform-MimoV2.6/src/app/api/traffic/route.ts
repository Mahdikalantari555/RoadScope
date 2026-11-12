import { NextRequest, NextResponse } from "next/server";
import { getTraffic } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const segmentId = new URL(req.url).searchParams.get("segmentId");
  const rows = await getTraffic(segmentId ? Number(segmentId) : undefined);
  return NextResponse.json({ data: rows, total: rows.length, synthetic: true });
}
