import { db } from "@/db";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { accidentCategories, accidents, severityLevels } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { bboxFromGeoJson, fc, pointFeature, type Feature } from "@/lib/geojson";
import { bboxParam, bool, csv, handleApiError, json, num, queryString } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/datasets/:id/incidents
 * Canonical network-referenced incidents. Ground-truth oracle points are only
 * returned when `groundTruth=1` and are always flagged `isGroundTruth`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireDataset(id);
    const q = queryString(req.url);
    const groundTruth = bool(q, "groundTruth", false);
    const includeUnverified = bool(q, "includeUnverified", true);
    const limit = Math.min(20000, num(q, "limit", 8000));
    const severities = csv(q, "severity");
    const categories = csv(q, "category");
    const statuses = csv(q, "status") ?? ["verified", "triaged", "unverified"];
    const from = q.get("from");
    const to = q.get("to");
    const bbox = bboxParam(q);

    const sevRows = await db.select().from(severityLevels).orderBy(asc(severityLevels.sortOrder));
    const catRows = await db.select().from(accidentCategories);
    const sevById = new Map(sevRows.map((s) => [s.id, s]));
    const catById = new Map(catRows.map((c) => [c.id, c]));

    const conds = [eq(accidents.datasetId, ctx.dataset.id)];
    conds.push(groundTruth ? eq(accidents.isGroundTruth, true) : eq(accidents.isGroundTruth, false));
    if (!groundTruth) conds.push(inArray(accidents.status, statuses as any));
    if (!includeUnverified && !groundTruth) conds.push(inArray(accidents.status, ["verified", "triaged"] as any));
    if (severities?.length) conds.push(inArray(accidents.severityId, sevRows.filter((s) => severities.includes(s.code)).map((s) => s.id)));
    if (categories?.length) conds.push(inArray(accidents.categoryId, catRows.filter((c) => categories.includes(c.code)).map((c) => c.id)));
    if (from) conds.push(gte(accidents.occurredAt, new Date(from)));
    if (to) conds.push(lte(accidents.occurredAt, new Date(to)));
    if (bbox) {
      const m = bboxFromGeoJson(ctx.crs, bbox);
      conds.push(gte(accidents.x, m.minX), lte(accidents.x, m.maxX), gte(accidents.y, m.minY), lte(accidents.y, m.maxY));
    }

    const rows = await db.select().from(accidents).where(and(...conds)).orderBy(desc(accidents.occurredAt)).limit(limit);

    const features: Feature[] = rows.map((r) => {
      const sev = sevById.get(r.severityId);
      return pointFeature(
        ctx.crs,
        r.x ?? 0,
        r.y ?? 0,
        {
          kind: "incident",
          accidentId: r.id,
          isGroundTruth: r.isGroundTruth,
          synthetic: r.isSynthetic,
          severityCode: sev?.code ?? null,
          severityLabel: sev?.label ?? null,
          severityRank: sev?.rank ?? null,
          epdoWeight: sev?.epdoWeight ?? 1,
          categoryCode: r.categoryId ? catById.get(r.categoryId)?.code ?? null : null,
          categoryLabel: r.categoryId ? catById.get(r.categoryId)?.label ?? null : null,
          occurredAt: r.occurredAt.toISOString(),
          reportedAt: r.reportedAt?.toISOString() ?? null,
          status: r.status,
          witnessCount: r.witnessCount,
          credibilityScore: r.credibilityScore,
          segmentId: r.segmentId,
          lixelId: r.lixelId,
          mOffset: r.mOffset === null ? null : Math.round(r.mOffset * 100) / 100,
          weatherCode: r.weatherCode,
          lightingCode: r.lightingCode,
          trafficState: r.trafficState,
          roadSurfaceState: r.roadSurfaceState,
          vehicleCount: r.vehicleCount,
          pedestrianCount: r.pedestrianCount,
          cyclistCount: r.cyclistCount,
          injuredCount: r.injuredCount,
          fatalityCount: r.fatalityCount,
          emergencyResponse: r.emergencyResponse,
          trueLixelId: groundTruth ? r.trueLixelId : null,
        },
        r.id,
      );
    });

    return json({
      datasetId: ctx.dataset.id,
      groundTruth,
      count: rows.length,
      limit,
      geojson: fc(ctx.crs, features),
      severityLevels: sevRows.map((s) => ({ code: s.code, label: s.label, rank: s.rank, epdoWeight: s.epdoWeight, color: s.color })),
      categories: catRows.map((c) => ({ code: c.code, label: c.label, reportingPropensity: c.reportingPropensity })),
      crs: { canonical: { srid: ctx.crs.srid, name: ctx.crs.name }, serialised: "CRS84 (WGS84 lon/lat)" },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
