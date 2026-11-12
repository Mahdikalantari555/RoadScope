/**
 * Urban Accident Intelligence — relational schema.
 *
 * Spatial note: the target deployment is PostgreSQL + PostGIS. This sandbox does not ship the
 * PostGIS extension, so geometries are stored in two explicit coordinate systems:
 *   - EPSG:4326 (lon/lat, WGS84)            → interchange / GeoJSON / web map
 *   - EPSG:32633 (UTM zone 33N, metres)     → all metric spatial operations
 * Point tables carry B-tree composite indexes on projected (x, y) for bbox pruning, line tables carry
 * envelope columns (min/max x/y). `docs/postgis-migration.sql` contains the drop-in PostGIS DDL
 * (geometry(Point,32633) + GiST) that replaces these columns 1:1.
 * All timestamps are `timestamptz` and are written in UTC.
 */
import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  doublePrecision,
  real,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["citizen", "admin"]);
export const reportStatus = pgEnum("report_status", ["reported", "verified", "rejected", "duplicate"]);
export const datasetKind = pgEnum("dataset_kind", ["synthetic", "official", "citizen"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed"]);
export const roadClass = pgEnum("road_class", ["arterial", "collector", "local"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: userRole("role").notNull().default("citizen"),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetSources = pgTable("dataset_sources", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: datasetKind("kind").notNull(),
  description: text("description").notNull().default(""),
  scenario: text("scenario"),
  seed: integer("seed"),
  crs: text("crs").notNull().default("EPSG:32633"),
  license: text("license").notNull().default("CC0 (synthetic)"),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accidentCategories = pgTable("accident_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull(),
});

export const severityLevels = pgTable(
  "severity_levels",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    label: text("label").notNull(),
    rank: integer("rank").notNull(),
    epdoWeight: real("epdo_weight").notNull(),
    color: text("color").notNull(),
  },
  (t) => [check("severity_rank_positive", sql`${t.rank} > 0`)],
);

export const roadNodes = pgTable(
  "road_nodes",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    degree: integer("degree").notNull().default(0),
    signalized: boolean("signalized").notNull().default(false),
  },
  (t) => [index("road_nodes_xy_idx").on(t.x, t.y), index("road_nodes_dataset_idx").on(t.datasetId)],
);

export const roadSegments = pgTable(
  "road_segments",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    roadClass: roadClass("road_class").notNull(),
    speedLimit: integer("speed_limit").notNull(),
    lanes: integer("lanes").notNull(),
    lit: boolean("lit").notNull(),
    surface: text("surface").notNull(),
    lengthM: doublePrecision("length_m").notNull(),
    fromNodeId: integer("from_node_id").references(() => roadNodes.id, { onDelete: "set null" }),
    toNodeId: integer("to_node_id").references(() => roadNodes.id, { onDelete: "set null" }),
    /** LineString vertices in EPSG:4326 [[lon,lat],...] */
    geom: jsonb("geom").$type<[number, number][]>().notNull(),
    /** LineString vertices in EPSG:32633 [[x,y],...] */
    geomProj: jsonb("geom_proj").$type<[number, number][]>().notNull(),
    minX: doublePrecision("min_x").notNull(),
    minY: doublePrecision("min_y").notNull(),
    maxX: doublePrecision("max_x").notNull(),
    maxY: doublePrecision("max_y").notNull(),
  },
  (t) => [
    index("road_segments_env_idx").on(t.minX, t.minY, t.maxX, t.maxY),
    index("road_segments_dataset_idx").on(t.datasetId),
    check("road_segments_length_positive", sql`${t.lengthM} > 0`),
    check("road_segments_speed_range", sql`${t.speedLimit} between 5 and 130`),
  ],
);

/** Non-analytical basemap context (synthetic land-use blocks, river). */
export const basemapFeatures = pgTable(
  "basemap_features",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    geom: jsonb("geom").$type<[number, number][][]>().notNull(),
  },
  (t) => [index("basemap_dataset_idx").on(t.datasetId)],
);

export const accidents = pgTable(
  "accidents",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    trackingCode: text("tracking_code").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    categoryId: integer("category_id").notNull().references(() => accidentCategories.id),
    severityId: integer("severity_id").notNull().references(() => severityLevels.id),
    vehicles: integer("vehicles").notNull(),
    description: text("description").notNull().default(""),
    emergencyServices: boolean("emergency_services").notNull().default(false),
    status: reportStatus("status").notNull().default("reported"),
    /** Original coordinates as submitted (EPSG:4326) — never overwritten. */
    reportedLon: doublePrecision("reported_lon").notNull(),
    reportedLat: doublePrecision("reported_lat").notNull(),
    /** Validated (network-snapped) location, EPSG:4326 + EPSG:32633. */
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    segmentId: integer("segment_id").references(() => roadSegments.id, { onDelete: "set null" }),
    snapDistanceM: real("snap_distance_m"),
    duplicateOfId: integer("duplicate_of_id"),
    duplicateScore: real("duplicate_score"),
    qualityFlags: jsonb("quality_flags").$type<string[]>().notNull().default([]),
    weather: text("weather"),
    lightCondition: text("light_condition"),
    reporterId: integer("reporter_id").references(() => users.id, { onDelete: "set null" }),
    /** Salted SHA-256 of optional contact — raw contact data is never stored. */
    reporterContactHash: text("reporter_contact_hash"),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    /** Ground-truth label of the generator (synthetic only) used to evaluate QA algorithms. */
    syntheticTruth: jsonb("synthetic_truth").$type<{ kind: string; originalIndex?: number; component?: string } | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accidents_tracking_idx").on(t.trackingCode),
    index("accidents_occurred_idx").on(t.occurredAt),
    index("accidents_status_idx").on(t.status),
    index("accidents_xy_idx").on(t.x, t.y),
    index("accidents_segment_idx").on(t.segmentId),
    index("accidents_dataset_idx").on(t.datasetId, t.status),
    check("accidents_vehicles_range", sql`${t.vehicles} between 0 and 60`),
    check("accidents_lat_range", sql`${t.lat} between -90 and 90 and ${t.reportedLat} between -90 and 90`),
    check("accidents_lon_range", sql`${t.lon} between -180 and 180 and ${t.reportedLon} between -180 and 180`),
    check("accidents_report_after_event", sql`${t.reportedAt} >= ${t.occurredAt} - interval '1 hour'`),
  ],
);

export const reportAttachments = pgTable("report_attachments", {
  id: serial("id").primaryKey(),
  accidentId: integer("accident_id").notNull().references(() => accidents.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Re-encoded client-side (EXIF/GPS metadata stripped). */
  dataBase64: text("data_base64").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id").notNull().references(() => accidents.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousStatus: reportStatus("previous_status").notNull(),
    newStatus: reportStatus("new_status").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verifications_accident_idx").on(t.accidentId)],
);

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    condition: text("condition").notNull(),
    precipitationMm: real("precipitation_mm").notNull(),
    visibilityM: real("visibility_m").notNull(),
    temperatureC: real("temperature_c").notNull(),
  },
  (t) => [index("env_obs_time_idx").on(t.datasetId, t.observedAt)],
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
    segmentId: integer("segment_id").notNull().references(() => roadSegments.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    aadt: integer("aadt").notNull(),
    method: text("method").notNull(),
  },
  (t) => [index("traffic_segment_idx").on(t.segmentId, t.year), check("traffic_aadt_positive", sql`${t.aadt} >= 0`)],
);

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: serial("id").primaryKey(),
    method: text("method").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    error: text("error"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_created_idx").on(t.createdAt)],
);

export const spatialAnalysisResults = pgTable("spatial_analysis_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().unique().references(() => spatialAnalysisJobs.id, { onDelete: "cascade" }),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  geojson: jsonb("geojson").$type<Record<string, unknown>>(),
  table: jsonb("table").$type<Record<string, unknown>[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);
