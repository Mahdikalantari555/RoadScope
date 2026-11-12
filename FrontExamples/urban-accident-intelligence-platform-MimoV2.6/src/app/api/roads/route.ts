import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roadSegments, accidents } from "@/db/schema";
import { mapSegment, segmentsToGeoJson, aggregateBySegmentDetails } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "geojson";
    const rows = await db.select().from(roadSegments).orderBy(roadSegments.id);
    const segments = rows.map(mapSegment);
    const accRows = await db.select().from(accidents);
    const enriched = aggregateBySegmentDetails(segments, accRows);

    if (format === "geojson") {
      return NextResponse.json({
        ...segmentsToGeoJson(enriched),
        meta: { total: enriched.length, synthetic: true, crs: "EPSG:4326" },
      });
    }
    return NextResponse.json({ data: enriched, total: enriched.length, synthetic: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load road network", detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const rows = await db.select().from(roadSegments).where(eq(roadSegments.id, id));
  if (!rows.length) return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  const segment = mapSegment(rows[0]);
  const accRows = await db.select().from(accidents).where(eq(accidents.roadSegmentId, id));
  const [enriched] = aggregateBySegmentDetails([segment], accRows);
  return NextResponse.json({ segment: enriched, accidents: accRows.length });
}
