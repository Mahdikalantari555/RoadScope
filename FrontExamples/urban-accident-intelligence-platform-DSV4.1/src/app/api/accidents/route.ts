import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidents, reportAttachments } from "@/db/schema";
import { jsonError, jsonOk, logAudit, paginate, searchParamsOf } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { loadAccidents, loadMetadata, findDuplicateCandidates } from "@/lib/data";
import { parseFilters } from "@/lib/filters";
import { accidentWhere } from "@/lib/filters";
import { nearestSegmentDistance } from "@/lib/analysis";
import { CITY } from "@/lib/seed/city";
import { pointInPolygon, type LngLat } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = searchParamsOf(request);
    const filters = parseFilters(params);
    const format = typeof params.format === "string" ? params.format : "geojson";
    const records = await loadAccidents(filters, 8000);
    const where = accidentWhere(filters);
    const totalRows = await db.select({ value: count() }).from(accidents).where(where);
    const total = totalRows[0]?.value ?? records.length;

    if (format === "geojson") {
      return jsonOk({
        type: "FeatureCollection",
        features: records.map((record) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [record.lng, record.lat] },
          properties: {
            id: record.id,
            publicId: record.publicId,
            status: record.status,
            category: record.categoryCode,
            severity: record.severityCode,
            occurredAt: record.occurredAt,
            lat: record.lat,
            lng: record.lng,
            district: record.district,
            segmentId: record.roadSegmentId,
            casualties: record.casualties,
            fatalities: record.fatalities,
            weather: record.weather,
            surface: record.roadSurface,
            lighting: record.lighting,
            uncertaintyM: record.positionalUncertaintyM,
            duplicateOfId: record.duplicateOfId,
            duplicateScore: record.duplicateScore,
            description: record.description,
            datasetName: record.datasetName,
            synthetic: true,
          },
        })),
        meta: {
          total,
          returned: records.length,
          truncated: records.length >= 8000,
          filters,
          note: "All features are synthetic demonstration data (generator v1.0, fixed seed).",
        },
      });
    }

    const page = Number(typeof params.page === "string" ? params.page : 1) || 1;
    const pageSize = Number(typeof params.pageSize === "string" ? params.pageSize : 50) || 50;
    const paged = await paginate(records, page, pageSize);
    return jsonOk({ ...paged, total, filters });
  } catch (error) {
    console.error("GET /api/accidents failed", error);
    return jsonError("Unable to retrieve accidents.", 500);
  }
}

const attachmentSchema = z.object({
  filename: z.string().min(1).max(160),
  mimeType: z.string().regex(/^image\/(png|jpe?g|webp)$/),
  dataUrl: z.string().max(2_200_000),
});

const reportSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  occurredAt: z.string(),
  categoryCode: z.string().min(2).max(40),
  severityCode: z.number().int().min(1).max(4),
  vehicles: z.number().int().min(1).max(12),
  casualties: z.number().int().min(0).max(60).optional(),
  fatalities: z.number().int().min(0).max(30).optional(),
  emergencyServices: z.boolean().optional(),
  description: z.string().min(12, "Please describe the incident in at least 12 characters.").max(1500),
  reporterName: z.string().max(80).optional(),
  reporterContact: z.string().max(120).optional(),
  attachments: z.array(attachmentSchema).max(2).optional(),
  acknowledgeSynthetic: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("The report contains invalid fields.", 422, parsed.error.flatten());
    }
    const input = parsed.data;

    const latSpan = (CITY.halfHeightM / 111_132) * 1.15;
    const lngSpan = (CITY.halfWidthM / 68_000) * 1.15;
    if (
      Math.abs(input.lat - CITY.center.lat) > latSpan ||
      Math.abs(input.lng - CITY.center.lng) > lngSpan
    ) {
      return jsonError(
        "Location is outside the Vantia study area. Place the incident inside the mapped network.",
        422,
      );
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return jsonError("Invalid incident date/time.", 422);
    if (occurredAt.getTime() > Date.now() + 3_600_000) return jsonError("Incident time cannot be in the future.", 422);
    if (occurredAt.getTime() < Date.UTC(2024, 0, 1)) {
      return jsonError("Crowdsourced reporting accepts incidents from 1 January 2024 onwards.", 422);
    }

    const meta = await loadMetadata();
    if (!meta.categories.some((c) => c.code === input.categoryCode)) {
      return jsonError("Unknown accident category.", 422);
    }

    const candidates = await findDuplicateCandidates(input.lat, input.lng, occurredAt, input.categoryCode);
    const best = candidates[0];
    const suspectedDuplicate = best && best.duplicateScore >= 0.85;
    const possibleDuplicate = best && best.duplicateScore >= 0.6 && !suspectedDuplicate;

    const nearest = nearestSegmentDistance(input.lat, input.lng, meta.segments);
    const segment =
      nearest && nearest.distanceM <= 70
        ? meta.segments.find((s) => s.id === nearest.segmentId) ?? null
        : null;
    const districtFeature = meta.features.find(
      (f) => f.kind === "district" && f.geometry.type === "Polygon" && pointInPolygon([input.lng, input.lat], (f.geometry.coordinates as LngLat[][])[0]),
    );

    const session = await getSession();
    const year = occurredAt.getUTCFullYear();
    const suffix = `${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();
    const publicId = `VNT-${year}-C${suffix}`;
    const qualityFlags: string[] = [];
    if (possibleDuplicate) qualityFlags.push("possible_duplicate");
    if (suspectedDuplicate) qualityFlags.push("duplicate_suspected");
    if (!segment) qualityFlags.push("position_offset_from_network");
    qualityFlags.push("environmental_context_missing");

    const inserted = await db
      .insert(accidents)
      .values({
        publicId,
        datasetId: meta.datasets.find((d) => d.slug === "vnt-citizen")?.id ?? null,
        reporterId: session?.userId ?? null,
        status: suspectedDuplicate ? "duplicate" : "reported",
        categoryCode: input.categoryCode,
        severityCode: input.severityCode,
        occurredAt,
        reportedAt: new Date(),
        lat: input.lat,
        lng: input.lng,
        originalLat: input.lat,
        originalLng: input.lng,
        positionalUncertaintyM: 25,
        locationMethod: "map_pick",
        geom: { type: "Point", coordinates: [input.lng, input.lat] },
        district: districtFeature?.name ?? segment?.district ?? null,
        roadSegmentId: segment?.id ?? null,
        vehicles: input.vehicles,
        casualties: input.casualties ?? 0,
        fatalities: input.fatalities ?? 0,
        emergencyServices: input.emergencyServices ?? false,
        description: input.description,
        hour: occurredAt.getUTCHours(),
        dow: occurredAt.getUTCDay(),
        month: occurredAt.getUTCMonth() + 1,
        duplicateOfId: suspectedDuplicate ? best.id : null,
        duplicateScore: best ? best.duplicateScore : null,
        qualityFlags,
      })
      .returning({ id: accidents.id, publicId: accidents.publicId });

    const accidentId = inserted[0].id;
    if (input.attachments && input.attachments.length > 0) {
      await db.insert(reportAttachments).values(
        input.attachments.map((attachment) => {
          const base64 = attachment.dataUrl.split(",")[1] ?? "";
          return {
            accidentId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: Math.round((base64.length * 3) / 4),
            content: base64,
          };
        }),
      );
    }

    await logAudit({
      actor: session ? `${session.name} (${session.email})` : "anonymous reporter",
      action: suspectedDuplicate ? "report.duplicate_suspected" : "report.submitted",
      entityType: "accident",
      entityId: inserted[0].publicId,
      detail: { categoryCode: input.categoryCode, severity: input.severityCode, district: districtFeature?.name ?? null },
    });

    return jsonOk(
      {
        publicId: inserted[0].publicId,
        status: suspectedDuplicate ? "duplicate" : "reported",
        message: suspectedDuplicate
          ? "Report received and provisionally flagged as a possible duplicate of an existing incident. A moderator will review it."
          : "Report received. It is pending moderation and is not treated as a confirmed accident.",
        duplicateCandidates: candidates,
        nearestSegment: segment ? { id: segment.id, name: segment.name, distanceM: Math.round(nearest?.distanceM ?? 0) } : null,
        district: districtFeature?.name ?? null,
        qualityFlags,
        positionalUncertaintyM: 25,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/accidents failed", error);
    return jsonError("Unable to submit the report. Please retry.", 500);
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") return jsonError("Administrator role required.", 403);
  const url = new URL(request.url);
  const publicId = url.searchParams.get("publicId");
  if (!publicId) return jsonError("publicId is required.", 400);
  await db.update(accidents).set({ status: "rejected", updatedAt: new Date() }).where(and(eq(accidents.publicId, publicId)));
  await logAudit({ actor: session.email, action: "record.soft_deleted", entityType: "accident", entityId: publicId });
  return jsonOk({ ok: true, note: "Records are rejected, never physically deleted, to preserve the audit trail." });
}

export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";
void sql;
