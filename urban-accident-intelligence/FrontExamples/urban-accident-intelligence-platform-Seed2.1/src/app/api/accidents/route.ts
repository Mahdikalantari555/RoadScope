import { NextResponse } from "next/server";
import { getAccidentsGeoJson } from "@/lib/db/repo";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statuses = searchParams.get("statuses")?.split(",").filter(Boolean);
  const severities = searchParams.get("severities")?.split(",").filter(Boolean);
  const fc = await getAccidentsGeoJson({ statuses, severities });
  return NextResponse.json(fc);
}
