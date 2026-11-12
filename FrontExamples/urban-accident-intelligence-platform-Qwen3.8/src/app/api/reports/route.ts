import { db } from "@/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { accidentCategories, accidents, reportAttachments, reportVerifications, severityLevels, users, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { gridKey, toUtm } from "@/lib/geo/projection";
import { point } from "@/lib/geojson";
import { ApiError, bool, csv, handleApiError, json, num, queryString, readJson, validateCoordinates, validateTimestamp } from "@/lib/api";
import { resolveActor, requirePermission, writeAudit } from "@/lib/auth";
import { DEFAULT_CONFLATION, computeCredibility, scoreSnapCandidates } from "@/lib/vgi/mapmatch";
import { CATEGORIES, SEVERITIES, LIGHTING_CODES, WEATHER_CODES } from "@/lib/domain/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SEVERITY_CODES = SEVERITIES.map((s) => s.code);
const CATEGORY_CODES = CATEGORIES.map((c) => c.code);
const WEATHER_CODES_LIST = WEATHER_CODES.map((w) => w.code);
const LIGHTING_CODES_LIST = LIGHTING_CODES.map((l) => l.code);

/** GET /api/reports — steward triage queue with provenance and map-match detail. */
export async function GET(req: Request) {
  try {
    const q = queryString(req.url);
    const datasetId = q.get("datasetId");
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    const ctx = await requireDataset(datasetId);
    const statuses = csv(q, "status") ?? ["unverified", "triaged", "corroborated"];
    const limit = Math.min(2000, num(q, "limit", 200));
    const clusterId = q.get("clusterId");
    const onlyWitnesses = bool(q, "onlyWitnesses", false);
    const onlyFalseAlarms = bool(q, "onlyFalseAlarms", false);
    const minCredibility = num(q, "minCredibility", -1);
    const sort = q.get("sort") ?? "recent";

    const conds = [eq(vgiReports.datasetId, ctx.dataset.id)];
    if (statuses.length && statuses[0] !== "all") conds.push(inArray(vgiReports.status, statuses as any));
    if (clusterId) conds.push(eq(vgiReports.clusterId, clusterId));
    if (onlyWitnesses) conds.push(eq(vgiReports.isDuplicateWitness, true));
    if (onlyFalseAlarms) conds.push(eq(vgiReports.isFalseAlarm, true));
    if (minCredibility >= 0) conds.push(gte(vgiReports.credibilityScore, minCredibility));

    const rows = await db
      .select()
      .from(vgiReports)
      .where(and(...conds))
      .orderBy(sort === "credibility" ? desc(vgiReports.credibilityScore) : sort === "drift" ? desc(vgiReports.snapPerpDistanceM) : desc(vgiReports.occurrenceTime))
      .limit(limit);

    const sevRows = await db.select().from(severityLevels);
    const catRows = await db.select().from(accidentCategories);
    const userRows = await db.select().from(users);
    const sevById = new Map(sevRows.map((s) => [s.id, s]));
    const catById = new Map(catRows.map((c) => [c.id, c]));
    const userById = new Map(userRows.map((u) => [u.id, u]));

    return json({
      datasetId: ctx.dataset.id,
      count: rows.length,
      reports: rows.map((r) => ({
        id: r.id,
        accidentId: r.accidentId,
        clusterId: r.clusterId,
        status: r.status,
        rawPosition: { x: r.rawX, y: r.rawY, lonLat: point(ctx.crs, r.rawX, r.rawY) },
        snappedPosition: r.snappedX !== null && r.snappedY !== null ? { x: r.snappedX, y: r.snappedY, lonLat: point(ctx.crs, r.snappedX, r.snappedY) } : null,
        snapPerpDistanceM: r.snapPerpDistanceM,
        snapPosterior: r.snapPosterior,
        positionalAccuracyM: r.positionalAccuracyM,
        injectedDriftM: r.injectedDriftM,
        occurrenceTime: r.occurrenceTime.toISOString(),
        reportedTime: r.reportedTime.toISOString(),
        reportingLagSeconds: r.reportingLagSeconds,
        severity: r.severityId ? { code: sevById.get(r.severityId)?.code, label: sevById.get(r.severityId)?.label, rank: sevById.get(r.severityId)?.rank, color: sevById.get(r.severityId)?.color } : null,
        category: r.categoryId ? { code: catById.get(r.categoryId)?.code, label: catById.get(r.categoryId)?.label } : null,
        weatherCode: r.weatherCode,
        lightingCode: r.lightingCode,
        trafficState: r.trafficState,
        vehicleCount: r.vehicleCount,
        pedestrianCount: r.pedestrianCount,
        injuredCount: r.injuredCount,
        fatalityCount: r.fatalityCount,
        emergencyResponse: r.emergencyResponse,
        narrative: r.narrative,
        deviceType: r.deviceType,
        contributor: r.contributorId ? { id: r.contributorId, name: userById.get(r.contributorId)?.displayName ?? "unknown", synthetic: userById.get(r.contributorId)?.isSyntheticActor ?? false } : null,
        isFalseAlarm: r.isFalseAlarm,
        isDuplicateWitness: r.isDuplicateWitness,
        mapMatch: r.mapMatch
          ? {
              ...r.mapMatch,
              candidates: (r.mapMatch.candidates ?? []).map((c: any) => ({ ...c, lonLat: point(ctx.crs, c.x, c.y) })),
            }
          : null,
        credibility: r.credibility,
        credibilityScore: r.credibilityScore,
        segmentId: r.snappedSegmentId,
        lixelId: r.snappedLixelId,
        mOffset: r.snappedM,
        roadName: r.snappedSegmentId ? ctx.graph.segmentById.get(r.snappedSegmentId)?.name ?? null : null,
        roadClass: r.snappedSegmentId ? ctx.graph.segmentById.get(r.snappedSegmentId)?.roadClass ?? null : null,
        mediaMetadataStripped: r.mediaMetadataStripped,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/reports — uncertainty-aware citizen report ingestion (US-2.1/2.2).
 * Raw observational provenance is persisted alongside the map-matched network
 * reference; the report is created in the `unverified` state and never enters a
 * confirmed analytical layer without steward action.
 */
export async function POST(req: Request) {
  try {
    const actor = resolveActor(req);
    requirePermission(actor, "report:create");
    const body = await readJson(req);
    const datasetId = String(body.datasetId ?? "");
    if (!datasetId) throw new ApiError(400, "datasetId_required");
    const ctx = await requireDataset(datasetId);

    const { lon, lat } = validateCoordinates(body.lon, body.lat);
    const positionalAccuracyM = Number(body.positionalAccuracyM ?? 15);
    if (!Number.isFinite(positionalAccuracyM) || positionalAccuracyM < 1 || positionalAccuracyM > 5000)
      throw new ApiError(400, "invalid_positional_accuracy", "expected 1–5000 metres");

    const now = Date.now();
    const occurrenceTime = validateTimestamp(body.occurrenceTime ?? new Date(now).toISOString(), "occurrence_time", now);
    const reportedTime = validateTimestamp(body.reportedTime ?? new Date(now).toISOString(), "reported_time", now);
    if (reportedTime.getTime() < occurrenceTime.getTime() - 60000)
      throw new ApiError(400, "reported_before_occurrence", "reportedTime must not precede occurrenceTime");

    const severityCode = String(body.severityCode ?? "property_damage");
    if (!SEVERITY_CODES.includes(severityCode)) throw new ApiError(400, "invalid_severity", SEVERITY_CODES);
    const categoryCode = body.categoryCode ? String(body.categoryCode) : null;
    if (categoryCode && !CATEGORY_CODES.includes(categoryCode)) throw new ApiError(400, "invalid_category", CATEGORY_CODES);
    const weatherCode = body.weatherCode ? String(body.weatherCode) : null;
    if (weatherCode && !WEATHER_CODES_LIST.includes(weatherCode)) throw new ApiError(400, "invalid_weather", WEATHER_CODES_LIST);
    const lightingCode = body.lightingCode ? String(body.lightingCode) : null;
    if (lightingCode && !LIGHTING_CODES_LIST.includes(lightingCode)) throw new ApiError(400, "invalid_lighting", LIGHTING_CODES_LIST);

    const narrative = body.narrative === undefined || body.narrative === null ? null : String(body.narrative).slice(0, 2000);
    const intField = (v: unknown, min: number, max: number, dflt: number) => {
      if (v === undefined || v === null || v === "") return dflt;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, "invalid_count_field", `${min}..${max} expected`);
      return n;
    };
    const vehicleCount = intField(body.vehicleCount, 0, 50, 1);
    const pedestrianCount = intField(body.pedestrianCount, 0, 50, 0);
    const injuredCount = intField(body.injuredCount, 0, 100, 0);
    const fatalityCount = intField(body.fatalityCount, 0, 100, 0);
    if (fatalityCount > 0 && injuredCount < fatalityCount) throw new ApiError(400, "inconsistent_casualties", "injuredCount must be ≥ fatalityCount");
    const emergencyResponse = Boolean(body.emergencyResponse);
    if (fatalityCount > 0 && !emergencyResponse) throw new ApiError(400, "inconsistent_emergency_response", "a fatality requires emergency response = true");

    const severityRow = await db.select().from(severityLevels).where(eq(severityLevels.code, severityCode)).limit(1);
    const categoryRow = categoryCode ? await db.select().from(accidentCategories).where(eq(accidentCategories.code, categoryCode)).limit(1) : [];
    if (!severityRow[0]) throw new ApiError(400, "unknown_severity_code");

    const utm = toUtm(lon, lat, ctx.crs);
    const extent = ctx.dataset;
    const pad = 2500;
    if (
      utm.x < (extent.extentXMin ?? -Infinity) - pad ||
      utm.x > (extent.extentXMax ?? Infinity) + pad ||
      utm.y < (extent.extentYMin ?? -Infinity) - pad ||
      utm.y > (extent.extentYMax ?? Infinity) + pad
    )
      throw new ApiError(422, "coordinate_outside_study_area", { x: utm.x, y: utm.y, extent });

    const sigma = Math.max(6, positionalAccuracyM * 0.9);
    const match = scoreSnapCandidates(ctx.graph, utm.x, utm.y, categoryCode, { sigmaM: sigma });
    if (!match.chosen) throw new ApiError(422, "no_road_network_candidate", "the observation could not be matched to any centreline");

    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 8) : [];
    const lagSeconds = Math.round((reportedTime.getTime() - occurrenceTime.getTime()) / 1000);

    const [report] = await db
      .insert(vgiReports)
      .values({
        datasetId: ctx.dataset.id,
        srid: ctx.crs.srid,
        contributorId: actor.id,
        rawX: utm.x,
        rawY: utm.y,
        gridKey: gridKey(utm.x, utm.y),
        positionalAccuracyM,
        occurrenceTime,
        reportedTime,
        reportingLagSeconds: lagSeconds,
        categoryId: categoryRow[0]?.id ?? null,
        severityId: severityRow[0].id,
        weatherCode,
        lightingCode,
        trafficState: body.trafficState ? String(body.trafficState) : "unknown",
        vehicleCount,
        pedestrianCount,
        injuredCount,
        fatalityCount,
        emergencyResponse,
        narrative,
        deviceType: body.deviceType === "web_form" || body.deviceType === "in_vehicle" ? body.deviceType : "mobile_app",
        mapMatch: {
          candidates: match.candidates.slice(0, 6).map((c) => ({
            segmentId: c.segmentId,
            lixelId: c.lixelId,
            m: Math.round(c.m * 100) / 100,
            x: c.x,
            y: c.y,
            perpDistanceM: Math.round(c.perpDistanceM * 100) / 100,
            bearingDeltaDeg: Math.round(c.bearingDeltaDeg * 100) / 100,
            roadClass: c.roadClass,
            classPrior: Math.round(c.classPrior * 10000) / 10000,
            topologyBonus: Math.round(c.topologyBonus * 10000) / 10000,
            posterior: Math.round(c.posterior * 100000) / 100000,
          })),
          chosenIndex: match.chosenIndex,
          sigmaM: match.sigmaM,
          entropyNats: Math.round(match.entropyNats * 10000) / 10000,
          ambiguity: Math.round(match.ambiguity * 10000) / 10000,
        },
        snappedSegmentId: match.chosen.segmentId,
        snappedLixelId: match.chosen.lixelId,
        snappedM: Math.round(match.chosen.m * 100) / 100,
        snappedX: match.chosen.x,
        snappedY: match.chosen.y,
        snapPerpDistanceM: Math.round(match.chosen.perpDistanceM * 100) / 100,
        snapPosterior: Math.round(match.chosen.posterior * 100000) / 100000,
        credibility: computeCredibility({
          witnesses: 1,
          severityAgreement: 1,
          categoryAgreement: 1,
          meanNetworkDistanceM: 0,
          timeRangeMinutes: 0,
          meanPriorScore: 45,
          oldestReportAgeHours: (Date.now() - occurrenceTime.getTime()) / 3600e3,
          params: DEFAULT_CONFLATION,
        }),
        credibilityScore: computeCredibility({
          witnesses: 1,
          severityAgreement: 1,
          categoryAgreement: 1,
          meanNetworkDistanceM: 0,
          timeRangeMinutes: 0,
          meanPriorScore: 45,
          oldestReportAgeHours: 0,
          params: DEFAULT_CONFLATION,
        }).total,
        status: "unverified",
        mediaMetadataStripped: true,
        consentGiven: Boolean(body.consentGiven ?? true),
      })
      .returning();

    for (const a of attachments) {
      await db.insert(reportAttachments).values(reportAttachmentsRow(a, report.id));
    }

    await db.insert(reportVerifications).values({
      reportId: report.id,
      datasetId: ctx.dataset.id,
      actorId: actor.id,
      actorRole: actor.role,
      action: "created",
      toStatus: "unverified",
      reason: "citizen_submission",
    });

    // Corroboration path (US-2.3): attach to an existing canonical incident.
    const corroborateId = body.corroborateAccidentId ? String(body.corroborateAccidentId) : null;
    let accidentId: string | null = null;
    if (corroborateId) {
      const [target] = await db.select().from(accidents).where(and(eq(accidents.id, corroborateId), eq(accidents.datasetId, ctx.dataset.id))).limit(1);
      if (!target) throw new ApiError(404, "corroboration_target_not_found");
      accidentId = target.id;
      await db.update(vgiReports).set({ accidentId, isDuplicateWitness: true, status: "corroborated" }).where(eq(vgiReports.id, report.id));
      await db
        .update(accidents)
        .set({ witnessCount: sql`${accidents.witnessCount} + 1`, status: "triaged" })
        .where(eq(accidents.id, target.id));
    } else {
      const [accident] = await db
        .insert(accidents)
        .values({
          datasetId: ctx.dataset.id,
          srid: ctx.crs.srid,
          isGroundTruth: false,
          isSynthetic: ctx.dataset.kind === "synthetic",
          segmentId: match.chosen.segmentId,
          lixelId: match.chosen.lixelId,
          mOffset: Math.round(match.chosen.m * 100) / 100,
          x: match.chosen.x,
          y: match.chosen.y,
          gridKey: gridKey(match.chosen.x, match.chosen.y),
          occurredAt: occurrenceTime,
          reportedAt: reportedTime,
          categoryId: categoryRow[0]?.id ?? null,
          severityId: severityRow[0].id,
          weatherCode,
          lightingCode,
          trafficState: (body.trafficState ?? "unknown") as any,
          roadSurfaceState: "unknown",
          vehicleCount,
          pedestrianCount,
          cyclistCount: 0,
          injuredCount,
          fatalityCount,
          emergencyResponse,
          witnessCount: 1,
          credibilityScore: report.credibilityScore,
          status: "unverified",
          canonicalReportId: report.id,
          narrative,
        })
        .returning();
      accidentId = accident.id;
      await db.update(vgiReports).set({ accidentId }).where(eq(vgiReports.id, report.id));
    }

    await writeAudit({
      actor,
      entity: "vgi_reports",
      entityId: report.id,
      action: "report_created",
      datasetId: ctx.dataset.id,
      severity: "info",
      after: { lon, lat, severityCode, categoryCode, snapPerpDistanceM: report.snapPerpDistanceM, snapPosterior: report.snapPosterior, accidentId, corroborated: Boolean(corroborateId) },
      request: req,
    });

    return json(
      {
        ok: true,
        reportId: report.id,
        accidentId,
        status: corroborateId ? "corroborated" : "unverified",
        rawPosition: { lon, lat, x: utm.x, y: utm.y, srid: ctx.crs.srid },
        snapped: {
          segmentId: match.chosen.segmentId,
          lixelId: match.chosen.lixelId,
          m: match.chosen.m,
          lonLat: point(ctx.crs, match.chosen.x, match.chosen.y),
          perpDistanceM: match.chosen.perpDistanceM,
          posterior: match.chosen.posterior,
          roadName: ctx.graph.segmentById.get(match.chosen.segmentId)?.name ?? null,
          roadClass: match.chosen.roadClass,
        },
        candidates: match.candidates.slice(0, 6),
        matchDiagnostics: { entropyNats: match.entropyNats, ambiguity: match.ambiguity, sigmaM: match.sigmaM },
        privacy: { mediaMetadataStripped: true, strippedFields: ["gps", "exif", "device_serial", "timestamp_original"], ipRetained: false },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

function reportAttachmentsRow(a: any, reportId: string) {
  const sha = String(a?.sha256 ?? "pending-hash");
  return {
    reportId,
    kind: (["image", "video", "audio", "document"].includes(String(a?.kind)) ? String(a.kind) : "image") as any,
    originalFilename: String(a?.filename ?? "attachment").slice(0, 200),
    storedFilename: `${reportId}-${sha.slice(0, 12)}`,
    mimeType: String(a?.mimeType ?? "application/octet-stream").slice(0, 120),
    bytes: Number.isFinite(Number(a?.bytes)) ? Math.max(0, Math.min(100_000_000, Number(a.bytes))) : 0,
    sha256: sha.slice(0, 64),
    widthPx: Number.isFinite(Number(a?.width)) ? Number(a.width) : null,
    heightPx: Number.isFinite(Number(a?.height)) ? Number(a.height) : null,
    exifStripped: true,
    strippedFields: ["GPSLatitude", "GPSLongitude", "GPSAltitude", "Make", "Model", "DateTimeOriginal", "Artist", "Software"],
  };
}

