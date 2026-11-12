/**
 * Accident data access and workflows: listing, analytical point extraction, citizen report
 * intake (with duplicate detection), administrative review and edits, and attachments.
 */
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, sql, between, type AnyColumn, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { accidentCategories, accidents, datasetSources, reportAttachments, reportVerifications, roadSegments, severityLevels, users } from "@/db/schema";
import type {
  AccidentDetail,
  AccidentListItem,
  DuplicateCandidate,
  Paginated,
  ReportResult,
  SessionUser,
  TrackResult,
  VerificationEntry,
} from "@/lib/api-types";
import { STUDY_AREA, type AccidentPoint, type AccidentStatus, type BBox, type CategoryCode, type DatasetKind, type GeoFeature } from "@/lib/domain";
import type { FilterSpec } from "@/lib/filters";
import { isWithinStudyCoverage, lonLatToUtm } from "@/lib/geo";
import { nearestSegment } from "@/lib/analysis/snapping";
import { computeQualityFlags, DUPLICATE_RADIUS_M, DUPLICATE_WINDOW_MS, findDuplicateCandidates, type DuplicateProbe } from "@/lib/quality";
import { addDaysIso, localParts, parseLocalDateTime, startOfLocalDate } from "@/lib/time";
import type { AccidentPatchInput, ReportInput } from "@/lib/validation";
import { config } from "./config";
import { reporterHashFor } from "./auth";
import { writeAudit } from "./audit";
import { ApiError } from "./http";
import { bumpDataVersion, loadNetwork } from "./geo-data";
import { logger } from "./logger";

const TZ = STUDY_AREA.timeZone;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ALLOWED_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CITIZEN_DATASET_CODE = "citizen-reports";

function secureCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

let categoryCache: Map<string, number> | null = null;
export async function categoryIdMap(): Promise<Map<string, number>> {
  if (!categoryCache) {
    const rows = await db.select({ id: accidentCategories.id, code: accidentCategories.code }).from(accidentCategories);
    categoryCache = new Map(rows.map((r) => [r.code, r.id]));
  }
  return categoryCache;
}

function buildConditions(f: FilterSpec, bbox: BBox | null): SQL[] {
  const c: SQL[] = [];
  if (f.statuses.length) c.push(inArray(accidents.status, f.statuses));
  if (f.from) c.push(gte(accidents.occurredAt, startOfLocalDate(f.from, TZ)));
  if (f.to) c.push(lt(accidents.occurredAt, startOfLocalDate(addDaysIso(f.to, 1), TZ)));
  if (f.categories.length) c.push(inArray(accidentCategories.code, f.categories));
  if (f.severities.length) c.push(inArray(accidents.severityId, f.severities));
  if (f.hours) c.push(between(accidents.hourLocal, f.hours[0], f.hours[1]));
  if (f.months.length) c.push(inArray(accidents.monthLocal, f.months));
  if (f.daysOfWeek.length) c.push(inArray(accidents.dowLocal, f.daysOfWeek));
  if (f.datasetIds) c.push(inArray(accidents.datasetSourceId, f.datasetIds));
  else c.push(eq(datasetSources.isActive, true));
  if (bbox) c.push(between(accidents.lon, bbox[0], bbox[2]), between(accidents.lat, bbox[1], bbox[3]));
  return c;
}

function queryBase() {
  return db
    .select({
      id: accidents.id,
      publicId: accidents.publicId,
      status: accidents.status,
      occurredAt: accidents.occurredAt,
      reportedAt: accidents.reportedAt,
      reportingDelayMin: accidents.reportingDelayMin,
      vehiclesInvolved: accidents.vehiclesInvolved,
      emergencyServices: accidents.emergencyServices,
      description: accidents.description,
      reportedLon: accidents.reportedLon,
      reportedLat: accidents.reportedLat,
      reportedAccuracyM: accidents.reportedAccuracyM,
      lon: accidents.lon,
      lat: accidents.lat,
      xM: accidents.xM,
      yM: accidents.yM,
      locationSource: accidents.locationSource,
      nearestSegmentId: accidents.nearestSegmentId,
      nearestSegmentName: roadSegments.name,
      snapDistanceM: accidents.snapDistanceM,
      yearLocal: accidents.yearLocal,
      monthLocal: accidents.monthLocal,
      dowLocal: accidents.dowLocal,
      hourLocal: accidents.hourLocal,
      trackingCode: accidents.trackingCode,
      duplicateOfId: accidents.duplicateOfId,
      duplicateCandidateId: accidents.duplicateCandidateId,
      duplicateScore: accidents.duplicateScore,
      qualityFlags: accidents.qualityFlags,
      categoryCode: accidentCategories.code,
      categoryLabel: accidentCategories.label,
      severityId: accidents.severityId,
      severityLabel: severityLevels.label,
      severityWeight: severityLevels.weight,
      datasetId: datasetSources.id,
      datasetName: datasetSources.name,
      datasetKind: datasetSources.kind,
      isSynthetic: datasetSources.isSynthetic,
    })
    .from(accidents)
    .innerJoin(accidentCategories, eq(accidents.categoryId, accidentCategories.id))
    .innerJoin(severityLevels, eq(accidents.severityId, severityLevels.id))
    .innerJoin(datasetSources, eq(accidents.datasetSourceId, datasetSources.id))
    .leftJoin(roadSegments, eq(accidents.nearestSegmentId, roadSegments.id));
}

async function fetchBase(where: SQL | undefined, order: { col: AnyColumn; dir: "asc" | "desc" } | null, limit?: number, offset?: number) {
  let q = queryBase().$dynamic();
  q = q.where(where);
  if (order) q = q.orderBy(order.dir === "asc" ? asc(order.col) : desc(order.col));
  if (limit !== undefined) q = q.limit(limit);
  if (offset !== undefined) q = q.offset(offset);
  return q;
}

type BaseRow = Awaited<ReturnType<typeof fetchBase>>[number];

function toListItem(r: BaseRow): AccidentListItem {
  return {
    id: r.id,
    publicId: r.publicId,
    status: r.status,
    occurredAt: r.occurredAt.toISOString(),
    reportedAt: r.reportedAt.toISOString(),
    categoryCode: r.categoryCode as CategoryCode,
    categoryLabel: r.categoryLabel,
    severityId: r.severityId,
    severityLabel: r.severityLabel,
    severityWeight: r.severityWeight,
    vehiclesInvolved: r.vehiclesInvolved,
    emergencyServices: r.emergencyServices,
    lon: r.lon,
    lat: r.lat,
    datasetId: r.datasetId,
    datasetName: r.datasetName,
    datasetKind: r.datasetKind as DatasetKind,
    isSynthetic: r.isSynthetic,
    nearestSegmentId: r.nearestSegmentId,
    nearestSegmentName: r.nearestSegmentName,
    snapDistanceM: r.snapDistanceM,
    reportingDelayMin: r.reportingDelayMin,
    locationSource: r.locationSource,
    qualityFlags: r.qualityFlags ?? [],
    duplicateOfId: r.duplicateOfId,
    duplicateCandidateId: r.duplicateCandidateId,
    duplicateScore: r.duplicateScore,
    yearLocal: r.yearLocal,
    monthLocal: r.monthLocal,
    dowLocal: r.dowLocal,
    hourLocal: r.hourLocal,
  };
}

export async function listAccidents(
  f: FilterSpec,
  opts: { page: number; pageSize: number; sort: "occurred" | "reported" | "status" | "severity"; order: "asc" | "desc"; bbox: BBox | null },
): Promise<Paginated<AccidentListItem>> {
  const where = and(...buildConditions(f, opts.bbox));
  const col: AnyColumn =
    opts.sort === "reported" ? accidents.reportedAt : opts.sort === "status" ? accidents.status : opts.sort === "severity" ? accidents.severityId : accidents.occurredAt;
  const rows = await fetchBase(where, { col, dir: opts.order }, opts.pageSize, (opts.page - 1) * opts.pageSize);
  const [{ total }] = await db
    .select({ total: count() })
    .from(accidents)
    .innerJoin(accidentCategories, eq(accidents.categoryId, accidentCategories.id))
    .innerJoin(datasetSources, eq(accidents.datasetSourceId, datasetSources.id))
    .where(where);
  return {
    items: rows.map(toListItem),
    page: opts.page,
    pageSize: opts.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
  };
}

function pointQuery(f: FilterSpec, bbox: BBox | null, limit?: number) {
  const base = db
    .select({
      id: accidents.id,
      status: accidents.status,
      categoryCode: accidentCategories.code,
      categoryLabel: accidentCategories.label,
      severityId: accidents.severityId,
      severityWeight: severityLevels.weight,
      lon: accidents.lon,
      lat: accidents.lat,
      xM: accidents.xM,
      yM: accidents.yM,
      occurredAt: accidents.occurredAt,
      yearLocal: accidents.yearLocal,
      monthLocal: accidents.monthLocal,
      dowLocal: accidents.dowLocal,
      hourLocal: accidents.hourLocal,
      segmentId: accidents.nearestSegmentId,
      snapDistanceM: accidents.snapDistanceM,
      reportingDelayMin: accidents.reportingDelayMin,
      qualityFlags: accidents.qualityFlags,
      duplicateCandidateId: accidents.duplicateCandidateId,
      datasetId: datasetSources.id,
      datasetKind: datasetSources.kind,
      isSynthetic: datasetSources.isSynthetic,
      locationSource: accidents.locationSource,
    })
    .from(accidents)
    .innerJoin(accidentCategories, eq(accidents.categoryId, accidentCategories.id))
    .innerJoin(severityLevels, eq(accidents.severityId, severityLevels.id))
    .innerJoin(datasetSources, eq(accidents.datasetSourceId, datasetSources.id))
    .$dynamic()
    .where(and(...buildConditions(f, bbox)));
  return limit === undefined ? base : base.limit(limit);
}

/** Normalised accident records for analytics (all matching records, no pagination). */
export async function loadAccidentPoints(f: FilterSpec): Promise<AccidentPoint[]> {
  const rows = await pointQuery(f, null);
  return rows.map((r) => ({
    id: r.id,
    status: r.status as AccidentStatus,
    categoryCode: r.categoryCode as CategoryCode,
    severityId: r.severityId as AccidentPoint["severityId"],
    severityWeight: r.severityWeight,
    lon: r.lon,
    lat: r.lat,
    x: r.xM,
    y: r.yM,
    tMs: r.occurredAt.getTime(),
    yearLocal: r.yearLocal,
    monthLocal: r.monthLocal,
    dowLocal: r.dowLocal,
    hourLocal: r.hourLocal,
    segmentId: r.segmentId,
    snapDistanceM: r.snapDistanceM,
    reportingDelayMin: r.reportingDelayMin,
    qualityFlags: r.qualityFlags ?? [],
    duplicateCandidateId: r.duplicateCandidateId,
    datasetId: r.datasetId,
    datasetKind: r.datasetKind as DatasetKind,
    isSynthetic: r.isSynthetic,
    locationSource: r.locationSource,
  }));
}

export async function accidentGeoJson(f: FilterSpec, bbox: BBox | null, limit: number) {
  const rows = await pointQuery(f, bbox, limit + 1);
  const truncated = rows.length > limit;
  const features: GeoFeature[] = rows.slice(0, limit).map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      id: r.id,
      status: r.status,
      category: r.categoryCode,
      categoryLabel: r.categoryLabel,
      severityId: r.severityId,
      severityWeight: r.severityWeight,
      occurredAt: r.occurredAt.toISOString(),
      datasetKind: r.datasetKind,
      isSynthetic: r.isSynthetic,
      yearLocal: r.yearLocal,
      monthLocal: r.monthLocal,
      dowLocal: r.dowLocal,
      hourLocal: r.hourLocal,
      flagged: (r.qualityFlags ?? []).length > 0,
    },
  }));
  return { type: "FeatureCollection" as const, features, meta: { count: features.length, truncated, limit } };
}

export async function getAccidentDetail(id: number, viewer: SessionUser | null, trackingCode: string | null): Promise<AccidentDetail> {
  const [row] = await fetchBase(eq(accidents.id, id), null, 1);
  if (!row) throw new ApiError(404, "not_found", "Accident not found");
  const isAdmin = viewer?.role === "admin";
  const ownsCode = !!trackingCode && row.trackingCode === trackingCode.toUpperCase();
  if (!isAdmin && !ownsCode && row.status !== "verified") throw new ApiError(404, "not_found", "Accident not found");

  const attachments = await db
    .select({
      id: reportAttachments.id,
      filename: reportAttachments.originalFilename,
      mimeType: reportAttachments.mimeType,
      byteSize: reportAttachments.byteSize,
      createdAt: reportAttachments.createdAt,
    })
    .from(reportAttachments)
    .where(eq(reportAttachments.accidentId, id))
    .orderBy(asc(reportAttachments.id));

  let verifications: VerificationEntry[] | null = null;
  if (isAdmin) {
    const rows = await db
      .select({
        id: reportVerifications.id,
        action: reportVerifications.action,
        previousStatus: reportVerifications.previousStatus,
        newStatus: reportVerifications.newStatus,
        note: reportVerifications.note,
        changes: reportVerifications.changes,
        createdAt: reportVerifications.createdAt,
        reviewerEmail: users.email,
      })
      .from(reportVerifications)
      .leftJoin(users, eq(reportVerifications.reviewerUserId, users.id))
      .where(eq(reportVerifications.accidentId, id))
      .orderBy(asc(reportVerifications.createdAt));
    verifications = rows.map((v) => ({
      id: v.id,
      action: v.action,
      previousStatus: v.previousStatus,
      newStatus: v.newStatus,
      note: v.note,
      changes: v.changes,
      reviewerEmail: v.reviewerEmail,
      createdAt: v.createdAt.toISOString(),
    }));
  }

  let duplicateCandidate: AccidentListItem | null = null;
  const candidateId = row.duplicateOfId ?? row.duplicateCandidateId;
  if (candidateId) {
    const [candidate] = await fetchBase(eq(accidents.id, candidateId), null, 1);
    if (candidate && (isAdmin || candidate.status === "verified")) duplicateCandidate = toListItem(candidate);
  }

  const showNarrative = isAdmin || ownsCode;
  return {
    ...toListItem(row),
    reportedLon: row.reportedLon,
    reportedLat: row.reportedLat,
    reportedAccuracyM: row.reportedAccuracyM,
    xM: row.xM,
    yM: row.yM,
    description: showNarrative ? row.description : null,
    trackingCode: showNarrative ? row.trackingCode : null,
    attachments: attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    verifications,
    duplicateCandidate,
  };
}

async function ensureCitizenDataset(): Promise<number> {
  const [existing] = await db.select({ id: datasetSources.id }).from(datasetSources).where(eq(datasetSources.code, CITIZEN_DATASET_CODE)).limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(datasetSources)
    .values({
      code: CITIZEN_DATASET_CODE,
      name: "Citizen reports (live submissions)",
      kind: "citizen",
      isSynthetic: false,
      description: "Crowdsourced submissions. Pending until reviewed; only verified records enter analytics.",
      isActive: true,
      metadata: { source: "citizen-form" },
    })
    .returning({ id: datasetSources.id });
  return created!.id;
}

async function findCandidates(probe: { lon: number; lat: number; x: number; y: number; tMs: number; categoryId: number; categoryCode: string }) {
  const radius = DUPLICATE_RADIUS_M * 1.5;
  const rows = await db
    .select({
      id: accidents.id,
      x: accidents.xM,
      y: accidents.yM,
      occurredAt: accidents.occurredAt,
      status: accidents.status,
      categoryCode: accidentCategories.code,
    })
    .from(accidents)
    .innerJoin(accidentCategories, eq(accidents.categoryId, accidentCategories.id))
    .where(
      and(
        between(accidents.occurredAt, new Date(probe.tMs - DUPLICATE_WINDOW_MS), new Date(probe.tMs + DUPLICATE_WINDOW_MS)),
        eq(accidents.categoryId, probe.categoryId),
        ne(accidents.status, "rejected"),
        sql`earth_box(ll_to_earth(${probe.lat}::float8, ${probe.lon}::float8), ${radius}::float8) @> ll_to_earth(${accidents.lat}, ${accidents.lon})`,
      ),
    );
  const pool = rows.map((r) => ({ id: r.id, x: r.x, y: r.y, tMs: r.occurredAt.getTime(), categoryCode: r.categoryCode, status: r.status }));
  const hits = findDuplicateCandidates({ x: probe.x, y: probe.y, tMs: probe.tMs, categoryCode: probe.categoryCode }, pool);
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  return hits.map<DuplicateCandidate>((h) => {
    const r = byId.get(h.id)!;
    return {
      id: h.id,
      status: r.status,
      occurredAt: r.occurredAt.toISOString(),
      categoryCode: r.categoryCode as CategoryCode,
      distanceM: h.distanceM,
      deltaMinutes: h.deltaMinutes,
      score: h.score,
    };
  });
}

interface ProbeInput {
  lon: number;
  lat: number;
  occurredLocal: string;
  categoryCode: CategoryCode;
}

async function probeFrom(input: ProbeInput) {
  const occurred = parseLocalDateTime(input.occurredLocal, TZ);
  if (!occurred) throw new ApiError(422, "validation_error", "Invalid occurrence time");
  const [x, y] = lonLatToUtm(input.lon, input.lat);
  const categoryId = (await categoryIdMap()).get(input.categoryCode);
  if (!categoryId) throw new ApiError(422, "validation_error", "Unknown category");
  return { occurred, x, y, categoryId, probe: { lon: input.lon, lat: input.lat, x, y, tMs: occurred.getTime(), categoryId, categoryCode: input.categoryCode } };
}

export async function checkDuplicates(input: ProbeInput): Promise<DuplicateCandidate[]> {
  const p = await probeFrom(input);
  return findCandidates(p.probe);
}

export async function createCitizenReport(input: ReportInput, ip: string): Promise<ReportResult> {
  const reporter = reporterHashFor(ip);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [{ recent }] = await db
    .select({ recent: count() })
    .from(accidents)
    .where(and(eq(accidents.reporterHash, reporter), gte(accidents.reportedAt, since)));
  if (recent >= config.dailyReportLimit) {
    throw new ApiError(429, "rate_limited", `Daily limit of ${config.dailyReportLimit} reports reached for this connection`);
  }

  const p = await probeFrom({ lon: input.lon, lat: input.lat, occurredLocal: input.occurredLocal, categoryCode: input.categoryCode });
  const net = await loadNetwork();
  const hit = nearestSegment(p.x, p.y, net.geoms);
  const local = localParts(p.occurred, TZ);
  const duplicates = await findCandidates(p.probe);
  const best = duplicates[0];
  const now = Date.now();
  const delay = Math.max(0, Math.round((now - p.occurred.getTime()) / 60000));
  const flags = computeQualityFlags({
    snapDistanceM: hit?.distanceM ?? null,
    reportingDelayMin: delay,
    hasDuplicateCandidate: !!best,
    coordinateMoved: false,
  });
  const datasetId = await ensureCitizenDataset();
  const trackingCode = `UAI-${secureCode(4)}-${secureCode(4)}`;

  const [row] = await db
    .insert(accidents)
    .values({
      datasetSourceId: datasetId,
      categoryId: p.categoryId,
      severityId: input.severityId,
      status: "reported",
      occurredAt: p.occurred,
      reportedAt: new Date(now),
      reportingDelayMin: delay,
      vehiclesInvolved: input.vehiclesInvolved,
      emergencyServices: input.emergencyServices,
      description: input.description,
      reportedLon: input.lon,
      reportedLat: input.lat,
      reportedAccuracyM: input.accuracyM ?? null,
      lon: input.lon,
      lat: input.lat,
      xM: p.x,
      yM: p.y,
      locationSource: "reported",
      nearestSegmentId: hit?.segmentId ?? null,
      snapDistanceM: hit?.distanceM ?? null,
      yearLocal: local.year,
      monthLocal: local.month,
      dowLocal: local.dow,
      hourLocal: local.hour,
      reporterHash: reporter,
      trackingCode,
      duplicateCandidateId: best?.id ?? null,
      duplicateScore: best?.score ?? null,
      qualityFlags: flags,
    })
    .returning({ id: accidents.id, publicId: accidents.publicId, status: accidents.status });

  await writeAudit({
    actor: null,
    action: "report.submit",
    entityType: "accident",
    entityId: row!.id,
    changes: { category: input.categoryCode, severityId: input.severityId, possibleDuplicateOf: best?.id ?? null },
    ip,
  });
  bumpDataVersion();

  const seg = hit ? net.segmentById.get(hit.segmentId) : undefined;
  return {
    id: row!.id,
    publicId: row!.publicId,
    trackingCode,
    status: row!.status,
    nearestSegment: seg && hit ? { id: seg.id, name: seg.name, distanceM: Math.round(hit.distanceM) } : null,
    duplicateCandidates: duplicates,
    locationSource: "reported",
  };
}

export async function trackReport(code: string): Promise<TrackResult> {
  const normalised = code.trim().toUpperCase();
  const [row] = await fetchBase(eq(accidents.trackingCode, normalised), null, 1);
  if (!row) throw new ApiError(404, "not_found", "No report matches this tracking code");
  const history = await db
    .select({ action: reportVerifications.action, newStatus: reportVerifications.newStatus, createdAt: reportVerifications.createdAt })
    .from(reportVerifications)
    .where(eq(reportVerifications.accidentId, row.id))
    .orderBy(asc(reportVerifications.createdAt));
  return {
    trackingCode: normalised,
    status: row.status,
    occurredAt: row.occurredAt.toISOString(),
    reportedAt: row.reportedAt.toISOString(),
    categoryLabel: row.categoryLabel,
    severityLabel: row.severityLabel,
    history: history.map((h) => ({ action: h.action, newStatus: h.newStatus, createdAt: h.createdAt.toISOString() })),
  };
}

const TRANSITIONS: Record<"verify" | "reject" | "mark_duplicate" | "reopen", { from: AccidentStatus[]; to: AccidentStatus }> = {
  verify: { from: ["reported", "duplicate", "rejected"], to: "verified" },
  reject: { from: ["reported", "verified", "duplicate"], to: "rejected" },
  mark_duplicate: { from: ["reported", "verified", "rejected"], to: "duplicate" },
  reopen: { from: ["verified", "rejected", "duplicate"], to: "reported" },
};

export async function reviewAccident(
  id: number,
  input: { action: "verify" | "reject" | "mark_duplicate" | "reopen"; duplicateOfId?: number; note?: string },
  admin: SessionUser,
  ip: string | null,
): Promise<AccidentDetail> {
  const [row] = await db.select({ id: accidents.id, status: accidents.status }).from(accidents).where(eq(accidents.id, id)).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Accident not found");
  const rule = TRANSITIONS[input.action];
  if (!rule.from.includes(row.status)) {
    throw new ApiError(409, "invalid_transition", `Cannot ${input.action.replace("_", " ")} a record that is ${row.status}`);
  }
  if (input.action === "mark_duplicate") {
    if (input.duplicateOfId === id) throw new ApiError(422, "validation_error", "A record cannot be a duplicate of itself");
    const [target] = await db.select({ id: accidents.id, status: accidents.status }).from(accidents).where(eq(accidents.id, input.duplicateOfId!)).limit(1);
    if (!target) throw new ApiError(422, "validation_error", "The original record does not exist");
    if (target.status === "duplicate") throw new ApiError(422, "validation_error", "The original record is itself a duplicate");
  }

  await db
    .update(accidents)
    .set({
      status: rule.to,
      duplicateOfId: input.action === "mark_duplicate" ? input.duplicateOfId! : null,
      updatedAt: new Date(),
    })
    .where(eq(accidents.id, id));
  await db.insert(reportVerifications).values({
    accidentId: id,
    reviewerUserId: admin.id,
    action: input.action,
    previousStatus: row.status,
    newStatus: rule.to,
    note: input.note ?? "",
    changes: input.action === "mark_duplicate" ? { duplicateOfId: input.duplicateOfId } : {},
  });
  await writeAudit({
    actor: admin,
    action: `accident.${input.action}`,
    entityType: "accident",
    entityId: id,
    changes: { from: row.status, to: rule.to, duplicateOfId: input.duplicateOfId ?? null },
    ip,
  });
  bumpDataVersion();
  return getAccidentDetail(id, admin, null);
}

export async function patchAccident(id: number, input: AccidentPatchInput, admin: SessionUser, ip: string | null): Promise<AccidentDetail> {
  const [row] = await db.select().from(accidents).where(eq(accidents.id, id)).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Accident not found");

  const set: Partial<typeof accidents.$inferInsert> = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  let coordinateMoved = row.locationSource === "validated";

  if (input.categoryCode) {
    const categoryId = (await categoryIdMap()).get(input.categoryCode);
    if (!categoryId) throw new ApiError(422, "validation_error", "Unknown category");
    set.categoryId = categoryId;
    changes.category = { from: row.categoryId, to: input.categoryCode };
  }
  if (input.severityId !== undefined) {
    set.severityId = input.severityId;
    changes.severityId = { from: row.severityId, to: input.severityId };
  }
  if (input.occurredLocal) {
    const occurred = parseLocalDateTime(input.occurredLocal, TZ);
    if (!occurred) throw new ApiError(422, "validation_error", "Invalid occurrence time");
    const local = localParts(occurred, TZ);
    set.occurredAt = occurred;
    set.yearLocal = local.year;
    set.monthLocal = local.month;
    set.dowLocal = local.dow;
    set.hourLocal = local.hour;
    changes.occurredAt = { from: row.occurredAt.toISOString(), to: occurred.toISOString() };
  }
  if (input.vehiclesInvolved !== undefined) {
    set.vehiclesInvolved = input.vehiclesInvolved;
    changes.vehiclesInvolved = { from: row.vehiclesInvolved, to: input.vehiclesInvolved };
  }
  if (input.emergencyServices !== undefined) {
    set.emergencyServices = input.emergencyServices;
    changes.emergencyServices = { from: row.emergencyServices, to: input.emergencyServices };
  }
  if (input.description !== undefined) {
    set.description = input.description;
    changes.description = { from: "(text)", to: "(text updated)" };
  }
  let snapDistance = row.snapDistanceM;
  let segmentId = row.nearestSegmentId;
  if (input.lon !== undefined && input.lat !== undefined) {
    if (!isWithinStudyCoverage(input.lon, input.lat)) throw new ApiError(422, "validation_error", "Validated location lies outside the study area");
    const [x, y] = lonLatToUtm(input.lon, input.lat);
    const net = await loadNetwork();
    const hit = nearestSegment(x, y, net.geoms);
    set.lon = input.lon;
    set.lat = input.lat;
    set.xM = x;
    set.yM = y;
    set.locationSource = "validated";
    set.nearestSegmentId = hit?.segmentId ?? null;
    set.snapDistanceM = hit?.distanceM ?? null;
    snapDistance = hit?.distanceM ?? null;
    segmentId = hit?.segmentId ?? null;
    coordinateMoved = true;
    changes.location = { from: [row.lon, row.lat], to: [input.lon, input.lat] };
  }

  set.qualityFlags = computeQualityFlags({
    snapDistanceM: snapDistance,
    reportingDelayMin: row.reportingDelayMin,
    hasDuplicateCandidate: row.duplicateCandidateId !== null,
    coordinateMoved,
  });
  void segmentId;

  await db.update(accidents).set(set).where(eq(accidents.id, id));
  await db.insert(reportVerifications).values({
    accidentId: id,
    reviewerUserId: admin.id,
    action: "edit",
    previousStatus: row.status,
    newStatus: row.status,
    note: input.note ?? "",
    changes,
  });
  await writeAudit({ actor: admin, action: "accident.edit", entityType: "accident", entityId: id, changes, ip });
  bumpDataVersion();
  return getAccidentDetail(id, admin, null);
}

function sniffMime(bytes: Buffer): string | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function addAttachment(
  accidentId: number,
  file: File,
  auth: { admin: SessionUser | null; trackingCode: string | null; ip: string },
) {
  const [row] = await db
    .select({ id: accidents.id, trackingCode: accidents.trackingCode })
    .from(accidents)
    .where(eq(accidents.id, accidentId))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Accident not found");
  const allowed = auth.admin?.role === "admin" || (!!auth.trackingCode && row.trackingCode === auth.trackingCode.trim().toUpperCase());
  if (!allowed) throw new ApiError(403, "forbidden", "A valid tracking code is required to attach photographs");

  if (file.size === 0) throw new ApiError(422, "validation_error", "The uploaded file is empty");
  if (file.size > config.maxUploadBytes) throw new ApiError(413, "file_too_large", "Photographs must be 8 MB or smaller");
  const ext = ALLOWED_MIME[file.type];
  if (!ext) throw new ApiError(415, "unsupported_media_type", "Only JPEG, PNG and WebP images are accepted");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (sniffMime(bytes) !== file.type) throw new ApiError(415, "content_mismatch", "File content does not match its declared type");

  const [{ existing }] = await db.select({ existing: count() }).from(reportAttachments).where(eq(reportAttachments.accidentId, accidentId));
  if (existing >= config.maxAttachmentsPerReport) throw new ApiError(409, "attachment_limit", `At most ${config.maxAttachmentsPerReport} photographs per report`);

  const key = `${randomUUID()}.${ext}`;
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(path.join(/*turbopackIgnore: true*/ config.uploadDir, key), bytes);
  const [created] = await db
    .insert(reportAttachments)
    .values({
      accidentId,
      storageKey: key,
      originalFilename: file.name.replace(/[^\w.\-]/g, "_").slice(0, 120) || "photo",
      mimeType: file.type,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })
    .returning({ id: reportAttachments.id, filename: reportAttachments.originalFilename, mimeType: reportAttachments.mimeType, byteSize: reportAttachments.byteSize });
  await writeAudit({ actor: auth.admin, action: "attachment.add", entityType: "accident", entityId: accidentId, changes: { attachmentId: created!.id, bytes: bytes.length }, ip: auth.ip });
  return created!;
}

export async function readAttachment(id: number, auth: { admin: SessionUser | null; trackingCode: string | null }) {
  const [row] = await db
    .select({
      id: reportAttachments.id,
      key: reportAttachments.storageKey,
      mimeType: reportAttachments.mimeType,
      filename: reportAttachments.originalFilename,
      trackingCode: accidents.trackingCode,
      status: accidents.status,
    })
    .from(reportAttachments)
    .innerJoin(accidents, eq(reportAttachments.accidentId, accidents.id))
    .where(eq(reportAttachments.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "Attachment not found");
  const isAdmin = auth.admin?.role === "admin";
  const owns = !!auth.trackingCode && row.trackingCode === auth.trackingCode.trim().toUpperCase();
  if (!isAdmin && !owns) throw new ApiError(403, "forbidden", "Attachment access requires administrator rights or the report's tracking code");
  const bytes = await readFile(path.join(/*turbopackIgnore: true*/ config.uploadDir, row.key));
  logger.debug("attachment.read", { id });
  return { bytes, mimeType: row.mimeType, filename: row.filename };
}

/** Most recent verified-or-permitted incidents assigned to a road segment. */
export async function recentForSegment(segmentId: number, statuses: AccidentStatus[], limit: number): Promise<AccidentListItem[]> {
  const rows = await fetchBase(
    and(eq(accidents.nearestSegmentId, segmentId), inArray(accidents.status, statuses), eq(datasetSources.isActive, true)),
    { col: accidents.occurredAt, dir: "desc" },
    limit,
  );
  return rows.map(toListItem);
}
