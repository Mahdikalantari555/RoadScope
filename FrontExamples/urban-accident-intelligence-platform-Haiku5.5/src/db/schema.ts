import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { ACCIDENT_STATUSES, ANALYSIS_TYPES, DATASET_KINDS, JOB_STATUSES, ROAD_CLASSES, USER_ROLES } from "@/lib/domain";

/*
 * Relational model for the Urban Accident Intelligence platform.
 *
 * Conventions
 *  - All timestamps are stored as timestamptz (UTC). Local-time fields (hour/day/month/year)
 *    are derived at ingestion in the study-area time zone and stored for indexed analysis.
 *  - Coordinates: WGS84 (lon/lat, EPSG:4326) for interchange; EPSG:32633 metric (x_m/y_m)
 *    for distance-based analysis. Original report coordinates are immutable (reported_*),
 *    analysis coordinates (lon/lat) may be replaced by validated coordinates.
 *  - GiST indexes on ll_to_earth(...) expressions are created in drizzle/0001_spatial_indexes.sql.
 */

export const userRole = pgEnum("user_role", USER_ROLES);
export const accidentStatus = pgEnum("accident_status", ACCIDENT_STATUSES);
export const datasetKind = pgEnum("dataset_kind", DATASET_KINDS);
export const jobStatus = pgEnum("job_status", JOB_STATUSES);

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const roadClassList = ROAD_CLASSES.map((c) => `'${c}'`).join(",");
const analysisTypeList = ANALYSIS_TYPES.map((c) => `'${c}'`).join(",");

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull().default("user"),
  createdAt: tsz("created_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: tsz("expires_at").notNull(),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)],
);

export const accidentCategories = pgTable("accident_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  colorHex: text("color_hex").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const severityLevels = pgTable(
  "severity_levels",
  {
    id: smallint("id").primaryKey(),
    code: text("code").notNull().unique(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    /** Illustrative equivalent-weight used for severity-weighted indices. Configurable. */
    weight: real("weight").notNull(),
    colorHex: text("color_hex").notNull(),
  },
  (t) => [check("severity_weight_positive", sql`${t.weight} > 0`)],
);

export const datasetSources = pgTable(
  "dataset_sources",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    kind: datasetKind("kind").notNull(),
    isSynthetic: boolean("is_synthetic").notNull(),
    scenario: text("scenario"),
    seed: integer("seed"),
    description: text("description").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    recordCount: integer("record_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("dataset_sources_kind_idx").on(t.kind)],
);

export const roadSegments = pgTable(
  "road_segments",
  {
    id: serial("id").primaryKey(),
    segmentCode: text("segment_code").notNull().unique(),
    name: text("name").notNull(),
    roadClass: text("road_class").notNull(),
    speedLimitKmh: smallint("speed_limit_kmh").notNull(),
    lanes: smallint("lanes").notNull(),
    lightingScore: real("lighting_score").notNull(),
    lengthM: real("length_m").notNull(),
    startNodeId: integer("start_node_id").notNull(),
    endNodeId: integer("end_node_id").notNull(),
    midLon: doublePrecision("mid_lon").notNull(),
    midLat: doublePrecision("mid_lat").notNull(),
    /** Polyline in WGS84, [lon, lat][] */
    coordinates: jsonb("coordinates").$type<[number, number][]>().notNull(),
    /** Polyline in EPSG:32633, [x, y][] */
    utmCoordinates: jsonb("utm_coordinates").$type<[number, number][]>().notNull(),
    datasetSourceId: integer("dataset_source_id")
      .notNull()
      .references(() => datasetSources.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("segment_class_valid", sql.raw(`${t.roadClass.name} in (${roadClassList})`)),
    check("segment_lighting_range", sql`${t.lightingScore} between 0 and 1`),
    check("segment_length_positive", sql`${t.lengthM} > 0`),
    index("road_segments_mid_idx").on(t.midLon, t.midLat),
  ],
);

export const roadIntersections = pgTable(
  "road_intersections",
  {
    id: serial("id").primaryKey(),
    nodeCode: text("node_code").notNull().unique(),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    xM: doublePrecision("x_m").notNull(),
    yM: doublePrecision("y_m").notNull(),
    degree: smallint("degree").notNull(),
    datasetSourceId: integer("dataset_source_id")
      .notNull()
      .references(() => datasetSources.id, { onDelete: "cascade" }),
  },
  (t) => [check("intersection_degree_nonneg", sql`${t.degree} >= 0`), index("road_intersections_lonlat_idx").on(t.lon, t.lat)],
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: serial("id").primaryKey(),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => roadSegments.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    periodStart: tsz("period_start").notNull(),
    avgDailyVehicles: integer("avg_daily_vehicles").notNull(),
    peakHourShare: real("peak_hour_share").notNull(),
    heavyVehicleShare: real("heavy_vehicle_share").notNull(),
    datasetSourceId: integer("dataset_source_id")
      .notNull()
      .references(() => datasetSources.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("traffic_segment_year_uq").on(t.segmentId, t.year),
    check("traffic_nonneg", sql`${t.avgDailyVehicles} >= 0`),
  ],
);

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    stationCode: text("station_code").notNull(),
    stationName: text("station_name").notNull(),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    observedAt: tsz("observed_at").notNull(),
    precipitationMm: real("precipitation_mm").notNull(),
    temperatureC: real("temperature_c").notNull(),
    visibilityM: real("visibility_m").notNull(),
    windSpeedMs: real("wind_speed_ms").notNull(),
    datasetSourceId: integer("dataset_source_id")
      .notNull()
      .references(() => datasetSources.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("env_station_time_uq").on(t.stationCode, t.observedAt),
    index("env_observed_idx").on(t.observedAt),
    check("env_precip_nonneg", sql`${t.precipitationMm} >= 0`),
  ],
);

export const accidents = pgTable(
  "accidents",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: uuid("public_id").notNull().defaultRandom().unique(),
    datasetSourceId: integer("dataset_source_id")
      .notNull()
      .references(() => datasetSources.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => accidentCategories.id),
    severityId: smallint("severity_id")
      .notNull()
      .references(() => severityLevels.id),
    status: accidentStatus("status").notNull().default("reported"),
    occurredAt: tsz("occurred_at").notNull(),
    reportedAt: tsz("reported_at").notNull(),
    reportingDelayMin: integer("reporting_delay_min").notNull(),
    vehiclesInvolved: smallint("vehicles_involved").notNull(),
    emergencyServices: boolean("emergency_services").notNull().default(false),
    description: text("description").notNull().default(""),
    /** Immutable coordinates as originally reported / generated. */
    reportedLon: doublePrecision("reported_lon").notNull(),
    reportedLat: doublePrecision("reported_lat").notNull(),
    reportedAccuracyM: real("reported_accuracy_m"),
    /** Analysis coordinates: equal to reported unless validated by an administrator. */
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    xM: doublePrecision("x_m").notNull(),
    yM: doublePrecision("y_m").notNull(),
    locationSource: text("location_source").notNull().default("reported"),
    nearestSegmentId: integer("nearest_segment_id").references(() => roadSegments.id, { onDelete: "set null" }),
    snapDistanceM: real("snap_distance_m"),
    yearLocal: smallint("year_local").notNull(),
    monthLocal: smallint("month_local").notNull(),
    dowLocal: smallint("dow_local").notNull(),
    hourLocal: smallint("hour_local").notNull(),
    reporterHash: text("reporter_hash"),
    trackingCode: text("tracking_code").unique(),
    duplicateOfId: bigint("duplicate_of_id", { mode: "number" }).references((): AnyPgColumn => accidents.id, {
      onDelete: "set null",
    }),
    duplicateCandidateId: bigint("duplicate_candidate_id", { mode: "number" }),
    duplicateScore: real("duplicate_score"),
    qualityFlags: jsonb("quality_flags").$type<string[]>().notNull().default([]),
    createdAt: tsz("created_at").notNull().defaultNow(),
    updatedAt: tsz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("accident_reported_lon_range", sql`${t.reportedLon} between -180 and 180`),
    check("accident_reported_lat_range", sql`${t.reportedLat} between -90 and 90`),
    check("accident_lon_range", sql`${t.lon} between -180 and 180`),
    check("accident_lat_range", sql`${t.lat} between -90 and 90`),
    check("accident_vehicles_range", sql`${t.vehiclesInvolved} between 0 and 50`),
    check("accident_hour_range", sql`${t.hourLocal} between 0 and 23`),
    check("accident_dow_range", sql`${t.dowLocal} between 0 and 6`),
    check("accident_month_range", sql`${t.monthLocal} between 1 and 12`),
    check("accident_delay_nonneg", sql`${t.reportingDelayMin} >= 0`),
    check("accident_location_source", sql`${t.locationSource} in ('reported','validated','synthetic')`),
    index("accidents_occurred_idx").on(t.occurredAt),
    index("accidents_status_idx").on(t.status),
    index("accidents_dataset_idx").on(t.datasetSourceId),
    index("accidents_category_idx").on(t.categoryId),
    index("accidents_severity_idx").on(t.severityId),
    index("accidents_segment_idx").on(t.nearestSegmentId),
    index("accidents_local_time_idx").on(t.yearLocal, t.monthLocal, t.hourLocal),
    index("accidents_lonlat_idx").on(t.lon, t.lat),
    index("accidents_reporter_idx").on(t.reporterHash, t.reportedAt),
  ],
);

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: serial("id").primaryKey(),
    accidentId: bigint("accident_id", { mode: "number" })
      .notNull()
      .references(() => accidents.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("report_attachments_accident_idx").on(t.accidentId), check("attachment_size_positive", sql`${t.byteSize} > 0`)],
);

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    accidentId: bigint("accident_id", { mode: "number" })
      .notNull()
      .references(() => accidents.id, { onDelete: "cascade" }),
    reviewerUserId: integer("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousStatus: accidentStatus("previous_status"),
    newStatus: accidentStatus("new_status"),
    note: text("note").notNull().default(""),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("report_verifications_accident_idx").on(t.accidentId),
    check("verification_action_valid", sql`${t.action} in ('verify','reject','mark_duplicate','reopen','edit')`),
  ],
);

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisType: text("analysis_type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    cacheKey: text("cache_key").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    progress: real("progress").notNull().default(0),
    progressMessage: text("progress_message").notNull().default("Queued"),
    errorMessage: text("error_message"),
    requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: tsz("created_at").notNull().defaultNow(),
    startedAt: tsz("started_at"),
    finishedAt: tsz("finished_at"),
  },
  (t) => [
    index("jobs_cache_idx").on(t.cacheKey, t.createdAt),
    index("jobs_created_idx").on(t.createdAt),
    check("job_type_valid", sql.raw(`${t.analysisType.name} in (${analysisTypeList})`)),
    check("job_progress_range", sql`${t.progress} between 0 and 1`),
  ],
);

export const spatialAnalysisResults = pgTable("spatial_analysis_results", {
  id: serial("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => spatialAnalysisJobs.id, { onDelete: "cascade" }),
  resultKind: text("result_kind").notNull(),
  featureCollection: jsonb("feature_collection").$type<Record<string, unknown> | null>(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: tsz("created_at").notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text("ip_hash"),
    createdAt: tsz("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export type UserRow = typeof users.$inferSelect;
export type AccidentRow = typeof accidents.$inferSelect;
export type DatasetSourceRow = typeof datasetSources.$inferSelect;
export type RoadSegmentRow = typeof roadSegments.$inferSelect;
export type SpatialAnalysisJobRow = typeof spatialAnalysisJobs.$inferSelect;
