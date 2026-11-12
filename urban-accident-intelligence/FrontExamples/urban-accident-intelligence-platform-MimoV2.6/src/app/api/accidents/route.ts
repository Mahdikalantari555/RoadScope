import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { accidents, reportAttachments, reportVerifications, roadSegments } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  accidentsToGeoJson,
  insertAudit,
  loadVocabularies,
  mapAccident,
  mapSegment,
  queryAccidents,
} from "@/lib/repo";
import type { AccidentFilters, CategoryCode, ReportStatus, SeverityCode } from "@/lib/types";
import { nearestSegment } from "@/lib/geo";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  format: z.enum(["json", "geojson"]).default("json"),
  from: z.string().optional(),
  to: z.string().optional(),
  categories: z.string().optional(),
  severities: z.string().optional(),
  statuses: z.string().optional(),
  text: z.string().optional(),
  emergency: z.string().optional(),
  minVehicles: z.coerce.number().int().min(1).optional(),
  bbox: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20000).default(5000),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseFilters(q: URLSearchParams): AccidentFilters {
  const csv = (v: string | null) => v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const bbox = q.get("bbox");
  return {
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    categories: csv(q.get("categories")) as CategoryCode[] | undefined,
    severities: csv(q.get("severities")) as SeverityCode[] | undefined,
    statuses: csv(q.get("statuses")) as ReportStatus[] | undefined,
    text: q.get("text") ?? undefined,
    emergencyOnly: q.get("emergency") === "true",
    minVehicles: q.get("minVehicles") ? Number(q.get("minVehicles")) : undefined,
    bbox: bbox ? (bbox.split(",").map(Number) as [number, number, number, number]) : undefined,
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = listSchema.safeParse({
      format: url.searchParams.get("format") ?? "json",
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: url.searchParams.get("limit") ?? 5000,
      offset: url.searchParams.get("offset") ?? 0,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
    }
    const { limit, offset, format } = parsed.data;
    const filters = parseFilters(url.searchParams);
    const page = await queryAccidents(filters, limit, offset);
    if (format === "geojson") {
      return NextResponse.json({
        ...accidentsToGeoJson(page.data),
        meta: { total: page.total, limit, offset, synthetic: true },
      });
    }
    return NextResponse.json({ ...page, synthetic: true });
  } catch (err) {
    return NextResponse.json({ error: "Failed to query accidents", detail: String(err) }, { status: 500 });
  }
}

const createSchema = z
  .object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    occurredAt: z.string().min(4),
    categoryCode: z.string().min(2),
    severityCode: z.string().min(2),
    vehicles: z.number().int().min(1).max(30),
    casualties: z.number().int().min(0).max(30).default(0),
    description: z.string().max(2000).optional(),
    emergencyServices: z.boolean().default(false),
    reporterHandle: z.string().max(64).optional(),
    geocodePrecision: z.enum(["pin", "address", "street", "approximate"]).default("pin"),
    positionalAccuracyM: z.number().min(0).max(1000).default(5),
    weather: z.string().default("clear"),
    lighting: z.string().default("daylight"),
    roadSurface: z.string().default("dry"),
    attachments: z
      .array(
        z.object({
          filename: z.string().max(180),
          contentType: z.string().max(80),
          byteSize: z.number().int().min(0).max(25_000_000),
        }),
      )
      .max(6)
      .default([]),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        { status: 422 },
      );
    }
    const d = parsed.data;

    // Coordinate sanity: must fall inside the registered study area.
    const bounds = { minLon: 13.3, minLat: 52.44, maxLon: 13.55, maxLat: 52.59 };
    if (d.lon < bounds.minLon || d.lon > bounds.maxLon || d.lat < bounds.minLat || d.lat > bounds.maxLat) {
      return NextResponse.json(
        { error: "Coordinates outside the configured study area.", issues: [{ path: "lon/lat", message: "Outside study area bbox." }] },
        { status: 422 },
      );
    }

    const occurredAt = new Date(d.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json(
        { error: "Invalid timestamp", issues: [{ path: "occurredAt", message: "Not a valid ISO-8601 timestamp." }] },
        { status: 422 },
      );
    }
    const now = new Date();
    if (occurredAt.getTime() > now.getTime() + 3600_000) {
      return NextResponse.json(
        { error: "Timestamp in the future", issues: [{ path: "occurredAt", message: "Occurrence time cannot be in the future." }] },
        { status: 422 },
      );
    }

    // Nearest road segment assignment (metric snap).
    const segs = (await db.select().from(roadSegments)).map(mapSegment);
    const snap = nearestSegment(d.lon, d.lat, segs, 120);

    const voc = await loadVocabularies();
    const sev = voc.sevs.get(d.severityCode);
    const cat = voc.cats.get(d.categoryCode);
    if (!sev || !cat) {
      return NextResponse.json(
        { error: "Unknown vocabulary term", issues: [{ path: "categoryCode/severityCode", message: "Not in the controlled vocabulary." }] },
        { status: 422 },
      );
    }

    // Deterministic public id: MRD-<year>-<sequence>
    const year = occurredAt.getUTCFullYear();
    const seq = (await db.execute<{ n: number }>(`select count(*)::int as n from accidents`)).rows?.[0]?.n ?? 0;
    const publicId = `MRD-${year}-C${String(seq + 1).padStart(5, "0")}`;

    const inserted = await db
      .insert(accidents)
      .values({
        publicId,
        categoryCode: d.categoryCode,
        severityCode: d.severityCode,
        roadSegmentId: snap.segment?.id ?? null,
        lon: d.lon,
        lat: d.lat,
        reportedLon: d.lon,
        reportedLat: d.lat,
        positionalAccuracyM: d.positionalAccuracyM,
        geocodePrecision: d.geocodePrecision,
        occurredAt,
        reportedAt: now,
        reportDelayH: Math.max(0, (now.getTime() - occurredAt.getTime()) / 3600000),
        vehicles: d.vehicles,
        casualties: d.casualties,
        description: d.description ?? null,
        emergencyServices: d.emergencyServices,
        status: "pending",
        reporterHandle: d.reporterHandle ?? "anonymous",
        isSynthetic: true,
        datasetSourceId: 1,
        lighting: d.lighting,
        weather: d.weather,
        roadSurface: d.roadSurface,
      })
      .returning();

    const row = inserted[0];
    for (const a of d.attachments) {
      await db.insert(reportAttachments).values({
        accidentId: row.id,
        filename: a.filename,
        contentType: a.contentType,
        byteSize: a.byteSize,
        storageUrl: `synthetic://uploads/${row.publicId}/${a.filename}`,
        capturedAt: occurredAt,
      });
    }

    // Duplicate detection: within 75 m and 6 h of an existing record.
    const all = await db.select().from(accidents);
    const within = all.filter((o) => {
      if (o.id === row.id) return false;
      const dt = Math.abs(o.occurredAt.getTime() - occurredAt.getTime()) / 3600000;
      if (dt > 6) return false;
      const dLat = (o.lat - d.lat) * 111320;
      const dLon = (o.lon - d.lon) * 111320 * Math.cos((d.lat * Math.PI) / 180);
      return Math.hypot(dLat, dLon) <= 75;
    });

    await insertAudit({
      actorRole: "contributor",
      actorName: d.reporterHandle ?? "anonymous",
      action: "report.create",
      entityType: "accidents",
      entityId: row.publicId,
      detail: {
        category: d.categoryCode,
        severity: d.severityCode,
        snappedSegment: snap.segment?.segmentCode ?? null,
        snapDistanceM: Math.round(snap.distanceM * 10) / 10,
        duplicateCandidates: within.length,
      },
    });

    return NextResponse.json(
      {
        id: row.id,
        publicId: row.publicId,
        status: "pending",
        snappedSegment: snap.segment
          ? { id: snap.segment.id, segmentCode: snap.segment.segmentCode, streetName: snap.segment.streetName }
          : null,
        snapDistanceM: Math.round(snap.distanceM * 10) / 10,
        duplicateCandidates: within.map((w) => ({
          id: w.id,
          publicId: w.publicId,
          occurredAt: w.occurredAt.toISOString(),
          distanceM: Math.round(
            Math.hypot((w.lat - d.lat) * 111320, (w.lon - d.lon) * 111320 * Math.cos((d.lat * Math.PI) / 180)),
          ),
          status: w.status,
        })),
        notice: "Unverified citizen report — not counted as a confirmed accident until reviewed.",
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json({ error: "Failed to create report", detail: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const k of ["categoryCode", "severityCode", "description", "vehicles", "casualties", "lighting", "weather", "roadSurface"]) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    patch.updatedAt = new Date();
    const updated = await db.update(accidents).set(patch).where(eq(accidents.id, id)).returning();
    if (!updated.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await insertAudit({
      actorRole: body.actorRole ?? "administrator",
      actorName: body.actorName ?? "console",
      action: "report.edit",
      entityType: "accidents",
      entityId: updated[0].publicId,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: "Failed to update", detail: String(err) }, { status: 500 });
  }
}


