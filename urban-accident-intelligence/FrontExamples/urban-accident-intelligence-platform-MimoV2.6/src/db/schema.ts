/**
 * Urban Accident Intelligence — relational schema (Drizzle ORM / PostgreSQL).
 *
 * NOTE ON SPATIAL TYPES
 * ---------------------
 * The production target for this schema is PostgreSQL + PostGIS, with geometry
 * columns declared as `geometry(Point, 4326)` / `geometry(LineString, 4326)`,
 * GiST spatial indexes and analysis in EPSG:25832 (or a local UTM zone).
 * See `drizzle/0001_postgis_reference.sql` for the exact DDL.
 *
 * This sandbox runtime has no PostGIS extension available, so coordinates are
 * stored as typed `doublePrecision` columns (WGS84 lon/lat) plus an optional
 * `geometryWkt` text column that mirrors the geometry 1:1. All metric spatial
 * operations are performed in `src/lib/geo.ts` using a local equirectangular
 * projection, which is numerically equivalent to a local planar CRS at city
 * scale (< 20 km extent).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity & governance
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("contributor"), // 'administrator' | 'contributor'
    organisation: text("organisation"),
    passwordHash: text("password_hash"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const datasetSources = pgTable(
  "dataset_sources",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'synthetic' | 'crowdsourced' | 'official'
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    description: text("description").notNull(),
    licence: text("licence").notNull(),
    generatorVersion: text("generator_version"),
    randomSeed: integer("random_seed"),
    recordCount: integer("record_count").notNull().default(0),
    coverageStart: timestamp("coverage_start", { withTimezone: true }),
    coverageEnd: timestamp("coverage_end", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("dataset_sources_slug_uq").on(t.slug)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorUserId: integer("actor_user_id"),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Classification vocabularies
// ---------------------------------------------------------------------------

export const severityLevels = pgTable("severity_levels", {
  code: text("code").primaryKey(), // 'fatal' | 'serious' | 'slight' | 'damage_only'
  label: text("label").notNull(),
  rank: integer("rank").notNull(), // 1 = most severe
  weight: doublePrecision("weight").notNull(), // severity weighting for risk indices
  colour: text("colour").notNull(),
  definition: text("definition").notNull(),
});

export const accidentCategories = pgTable("accident_categories", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  group: text("group").notNull(),
  description: text("description").notNull(),
});

// ---------------------------------------------------------------------------
// Road network
// ---------------------------------------------------------------------------

export const roadSegments = pgTable(
  "road_segments",
  {
    id: serial("id").primaryKey(),
    segmentCode: text("segment_code").notNull(),
    streetName: text("street_name").notNull(),
    roadClass: text("road_class").notNull(), // 'arterial' | 'collector' | 'local'
    district: text("district").notNull(),
    fromNodeId: integer("from_node_id").notNull(),
    toNodeId: integer("to_node_id").notNull(),
    lengthM: doublePrecision("length_m").notNull(),
    bearingDeg: doublePrecision("bearing_deg").notNull(),
    speedLimitKph: integer("speed_limit_kph").notNull(),
    lanes: integer("lanes").notNull(),
    lighting: text("lighting").notNull(), // 'full' | 'partial' | 'unlit'
    surface: text("surface").notNull(), // 'asphalt' | 'concrete' | 'paved'
    hasJunctionControl: boolean("has_junction_control").notNull().default(false),
    hasCycleLane: boolean("has_cycle_lane").notNull().default(false),
    centroidLon: doublePrecision("centroid_lon").notNull(),
    centroidLat: doublePrecision("centroid_lat").notNull(),
    geometryWkt: text("geometry_wkt").notNull(),
    geometryJson: jsonb("geometry_json").notNull(),
  },
  (t) => [
    index("road_segments_class_idx").on(t.roadClass),
    index("road_segments_centroid_idx").on(t.centroidLon, t.centroidLat),
  ],
);

// ---------------------------------------------------------------------------
// Accident reports
// ---------------------------------------------------------------------------

export const accidents = pgTable(
  "accidents",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull(),
    categoryCode: text("category_code").notNull(),
    severityCode: text("severity_code").notNull(),
    roadSegmentId: integer("road_segment_id"),
    /** Validated / snapped geometry (WGS84). */
    lon: doublePrecision("lon").notNull(),
    lat: doublePrecision("lat").notNull(),
    /** Original reporter-supplied coordinates, preserved verbatim. */
    reportedLon: doublePrecision("reported_lon").notNull(),
    reportedLat: doublePrecision("reported_lat").notNull(),
    positionalAccuracyM: doublePrecision("positional_accuracy_m").notNull().default(0),
    geocodePrecision: text("geocode_precision").notNull().default("pin"), // 'pin' | 'address' | 'street' | 'approximate'
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    reportDelayH: doublePrecision("report_delay_h").notNull().default(0),
    vehicles: integer("vehicles").notNull().default(1),
    casualties: integer("casualties").notNull().default(0),
    description: text("description"),
    emergencyServices: boolean("emergency_services").notNull().default(false),
    status: text("status").notNull().default("pending"), // 'pending' | 'verified' | 'rejected' | 'duplicate'
    duplicateOfId: integer("duplicate_of_id"),
    rejectReason: text("reject_reason"),
    reporterUserId: integer("reporter_user_id"),
    reporterHandle: text("reporter_handle"),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    datasetSourceId: integer("dataset_source_id"),
    lighting: text("lighting").notNull().default("daylight"),
    weather: text("weather").notNull().default("clear"),
    roadSurface: text("road_surface").notNull().default("dry"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accidents_occurred_idx").on(t.occurredAt),
    index("accidents_status_idx").on(t.status),
    index("accidents_severity_idx").on(t.severityCode),
    index("accidents_category_idx").on(t.categoryCode),
    index("accidents_spatial_idx").on(t.lon, t.lat),
    index("accidents_segment_idx").on(t.roadSegmentId),
    uniqueIndex("accidents_public_id_uq").on(t.publicId),
  ],
);

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageUrl: text("storage_url").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("report_attachments_accident_idx").on(t.accidentId)],
);

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id").notNull(),
    reviewerUserId: integer("reviewer_user_id"),
    reviewerName: text("reviewer_name").notNull(),
    decision: text("decision").notNull(), // 'verified' | 'rejected' | 'duplicate' | 'reopened'
    confidence: doublePrecision("confidence").notNull().default(0.5),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("report_verifications_accident_idx").on(t.accidentId),
    index("report_verifications_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id"),
    roadSegmentId: integer("road_segment_id"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    weather: text("weather").notNull(),
    temperatureC: doublePrecision("temperature_c"),
    visibilityM: doublePrecision("visibility_m"),
    precipitationMm: doublePrecision("precipitation_mm"),
    windKph: doublePrecision("wind_kph"),
    roadSurfaceCondition: text("road_surface_condition").notNull(),
    source: text("source").notNull().default("synthetic"),
  },
  (t) => [
    index("env_obs_accident_idx").on(t.accidentId),
    index("env_obs_segment_idx").on(t.roadSegmentId),
    index("env_obs_time_idx").on(t.observedAt),
  ],
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: serial("id").primaryKey(),
    roadSegmentId: integer("road_segment_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    hourOfDay: integer("hour_of_day").notNull(),
    dayType: text("day_type").notNull().default("weekday"), // 'weekday' | 'weekend'
    volumeVehPerHour: integer("volume_veh_per_hour").notNull(),
    avgSpeedKph: doublePrecision("avg_speed_kph").notNull(),
    aadt: integer("aadt"),
    congestionIndex: doublePrecision("congestion_index").notNull(),
    coverageRatio: doublePrecision("coverage_ratio").notNull().default(1),
  },
  (t) => [
    index("traffic_obs_segment_idx").on(t.roadSegmentId),
    index("traffic_obs_time_idx").on(t.observedAt),
  ],
);

// ---------------------------------------------------------------------------
// Analysis job bookkeeping (async geoprocessing in production)
// ---------------------------------------------------------------------------

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: serial("id").primaryKey(),
    method: text("method").notNull(), // 'kde' | 'gistar' | 'dbscan' | 'segment_agg' | 'risk'
    title: text("title").notNull(),
    parameters: jsonb("parameters").notNull(),
    inputFilter: jsonb("input_filter"),
    status: text("status").notNull().default("queued"), // 'queued' | 'running' | 'succeeded' | 'failed'
    progress: doublePrecision("progress").notNull().default(0),
    errorMessage: text("error_message"),
    createdBy: text("created_by").notNull().default("console"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("spatial_analysis_jobs_status_idx").on(t.status)],
);

export const spatialAnalysisResults = pgTable(
  "spatial_analysis_results",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull(),
    layerName: text("layer_name").notNull(),
    geometryType: text("geometry_type").notNull(),
    featureCount: integer("feature_count").notNull().default(0),
    legend: jsonb("legend"),
    statistics: jsonb("statistics"),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("spatial_analysis_results_job_idx").on(t.jobId)],
);

export type User = typeof users.$inferSelect;
export type AccidentRow = typeof accidents.$inferSelect;
export type RoadSegmentRow = typeof roadSegments.$inferSelect;
export type DatasetSourceRow = typeof datasetSources.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type SpatialAnalysisJobRow = typeof spatialAnalysisJobs.$inferSelect;
