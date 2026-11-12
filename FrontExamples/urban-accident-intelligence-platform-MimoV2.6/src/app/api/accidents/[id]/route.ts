import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accidents,
  accidentCategories,
  environmentalObservations,
  reportAttachments,
  reportVerifications,
  roadSegments,
  severityLevels,
  trafficObservations,
} from "@/db/schema";
import { mapAccident, mapSegment } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) {
    return NextResponse.json({ error: "Invalid accident id" }, { status: 400 });
  }
  const rows = await db.select().from(accidents).where(eq(accidents.id, numeric));
  if (!rows.length) return NextResponse.json({ error: "Accident not found" }, { status: 404 });
  const row = rows[0];

  const [cat, sev, segRows, attach, env, traffic, verifs] = await Promise.all([
    db.select().from(accidentCategories).where(eq(accidentCategories.code, row.categoryCode)),
    db.select().from(severityLevels).where(eq(severityLevels.code, row.severityCode)),
    db.select().from(roadSegments),
    db.select().from(reportAttachments).where(eq(reportAttachments.accidentId, numeric)),
    db
      .select()
      .from(environmentalObservations)
      .where(eq(environmentalObservations.accidentId, numeric)),
    row.roadSegmentId
      ? db
          .select()
          .from(trafficObservations)
          .where(eq(trafficObservations.roadSegmentId, row.roadSegmentId))
      : Promise.resolve([]),
    db.select().from(reportVerifications).where(eq(reportVerifications.accidentId, numeric)),
  ]);

  const segRow = segRows.find((s) => s.id === row.roadSegmentId);
  const accident = mapAccident(row, cat[0], sev[0], segRow, attach.length);

  return NextResponse.json({
    accident,
    segment: segRow ? mapSegment(segRow) : null,
    attachments: attach.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      byteSize: a.byteSize,
      storageUrl: a.storageUrl,
      capturedAt: a.capturedAt?.toISOString() ?? null,
    })),
    environmental: env.map((e) => ({
      weather: e.weather,
      temperatureC: e.temperatureC,
      visibilityM: e.visibilityM,
      precipitationMm: e.precipitationMm,
      windKph: e.windKph,
      roadSurfaceCondition: e.roadSurfaceCondition,
      source: e.source,
    })),
    traffic: traffic.map((t) => ({
      hourOfDay: t.hourOfDay,
      dayType: t.dayType,
      volumeVehPerHour: t.volumeVehPerHour,
      avgSpeedKph: t.avgSpeedKph,
      congestionIndex: t.congestionIndex,
      coverageRatio: t.coverageRatio,
    })),
    verifications: verifs.map((v) => ({
      decision: v.decision,
      reviewerName: v.reviewerName,
      confidence: v.confidence,
      notes: v.notes,
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
