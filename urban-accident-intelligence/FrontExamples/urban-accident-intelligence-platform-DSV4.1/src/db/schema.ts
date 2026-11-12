/**
 * Urban Accident Intelligence — relational schema (PostgreSQL / Drizzle ORM).
 *
 * Geometry conventions
 * --------------------
 * - Point geometries are stored as GeoJSON (`[lng, lat]`, EPSG:4326) in jsonb
 *   alongside plain `lat`/`lng` doubles for fast B-tree window queries.
 * - Line geometries are stored as GeoJSON LineStrings in jsonb.
 * - Metric operations (KDE, Gi*, DBSCAN, point-to-segment distance) are executed
 *   in a local equidistant projection implemented in `src/lib/geo.ts`. The
 *   production migration path swaps this for PostGIS `geometry(...,27700)` +
 *   GiST indexes; see `docs/ARCHITECTURE.md`.
 * - All timestamps are stored in UTC (`timestamptz`).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const datasetSources = pgTable("dataset_sources", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("synthetic"),
  scenario: text("scenario"),
  seed: integer("seed"),
  description: text("description"),
  citation: text("citation"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("citizen"),
  passwordHash: text("password_hash").notNull(),
  organization: text("organization"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accidentCategories = pgTable("accident_categories", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  color: text("color"),
});

export const severityLevels = pgTable("severity_levels", {
  code: integer("code").primaryKey(),
  label: text("label").notNull(),
  weight: real("weight").notNull(),
  color: text("color").notNull(),
  description: text("description"),
});

export const roadSegments = pgTable(
  "road_segments",
  {
    id: text("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    name: text("name"),
    roadClass: text("road_class").notNull(),
    lanes: integer("lanes").notNull().default(2),
    speedLimitKmh: integer("speed_limit_kmh").notNull().default(50),
    surface: text("surface").notNull().default("asphalt"),
    isLit: boolean("is_lit").notNull().default(true),
    district: text("district"),
    lengthM: doublePrecision("length_m").notNull(),
    startLat: doublePrecision("start_lat").notNull(),
    startLng: doublePrecision("start_lng").notNull(),
    endLat: doublePrecision("end_lat").notNull(),
    endLng: doublePrecision("end_lng").notNull(),
    minLat: doublePrecision("min_lat").notNull(),
    minLng: doublePrecision("min_lng").notNull(),
    maxLat: doublePrecision("max_lat").notNull(),
    maxLng: doublePrecision("max_lng").notNull(),
    aadt: integer("aadt"),
    heavyVehiclePct: real("heavy_vehicle_pct"),
    geometry: jsonb("geometry").notNull(),
  },
  (t) => [
    index("road_segments_district_idx").on(t.district),
    index("road_segments_class_idx").on(t.roadClass),
  ],
);

export const intersections = pgTable(
  "intersections",
  {
    id: text("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    name: text("name").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    roadNames: text("road_names").array().notNull(),
    isSignalised: boolean("is_signalised").notNull().default(false),
    district: text("district"),
  },
  (t) => [index("intersections_district_idx").on(t.district)],
);

export const accidents = pgTable(
  "accidents",
  {
    id: serial("id").primaryKey(),
    publicId: text("public_id").notNull().unique(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    reporterId: integer("reporter_id").references(() => users.id),
    status: text("status").notNull().default("reported"),
    categoryCode: text("category_code")
      .notNull()
      .references(() => accidentCategories.code),
    severityCode: integer("severity_code")
      .notNull()
      .references(() => severityLevels.code),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    originalLat: doublePrecision("original_lat"),
    originalLng: doublePrecision("original_lng"),
    positionalUncertaintyM: real("positional_uncertainty_m").notNull().default(15),
    locationMethod: text("location_method").notNull().default("map_pick"),
    geom: jsonb("geom").notNull(),
    district: text("district"),
    roadSegmentId: text("road_segment_id"),
    vehicles: integer("vehicles").notNull().default(1),
    casualties: integer("casualties").notNull().default(0),
    fatalities: integer("fatalities").notNull().default(0),
    emergencyServices: boolean("emergency_services").notNull().default(false),
    description: text("description"),
    weather: text("weather"),
    roadSurface: text("road_surface"),
    lighting: text("lighting"),
    hour: integer("hour").notNull(),
    dow: integer("dow").notNull(),
    month: integer("month").notNull(),
    duplicateOfId: integer("duplicate_of_id"),
    duplicateScore: real("duplicate_score"),
    qualityFlags: jsonb("quality_flags").default([]),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: integer("verified_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("accidents_occurred_at_idx").on(t.occurredAt),
    index("accidents_status_idx").on(t.status),
    index("accidents_category_idx").on(t.categoryCode),
    index("accidents_severity_idx").on(t.severityCode),
    index("accidents_lat_idx").on(t.lat),
    index("accidents_lng_idx").on(t.lng),
    index("accidents_segment_idx").on(t.roadSegmentId),
    index("accidents_dataset_idx").on(t.datasetId),
    index("accidents_district_idx").on(t.district),
  ],
);

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id")
      .notNull()
      .references(() => accidents.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: text("content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_attachments_accident_idx").on(t.accidentId)],
);

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id")
      .notNull()
      .references(() => accidents.id, { onDelete: "cascade" }),
    verifierId: integer("verifier_id").references(() => users.id),
    action: text("action").notNull(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_verifications_accident_idx").on(t.accidentId)],
);

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    district: text("district").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    daypart: text("daypart").notNull(),
    condition: text("condition").notNull(),
    precipitationMm: real("precipitation_mm").notNull().default(0),
    temperatureC: real("temperature_c"),
    visibilityM: integer("visibility_m"),
    roadSurface: text("road_surface").notNull(),
    lighting: text("lighting").notNull(),
  },
  (t) => [index("env_obs_district_idx").on(t.district), index("env_obs_time_idx").on(t.observedAt)],
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    segmentId: text("segment_id").notNull(),
    daypart: text("daypart").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    aadt: integer("aadt").notNull(),
    heavyVehiclePct: real("heavy_vehicle_pct").notNull().default(0),
  },
  (t) => [index("traffic_obs_segment_idx").on(t.segmentId)],
);

export const cityFeatures = pgTable(
  "city_features",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id").references(() => datasetSources.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    geometry: jsonb("geometry").notNull(),
    properties: jsonb("properties").default({}),
  },
  (t) => [index("city_features_kind_idx").on(t.kind)],
);

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    params: jsonb("params").notNull(),
    status: text("status").notNull().default("completed"),
    createdBy: text("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    featureCount: integer("feature_count").notNull().default(0),
    summary: jsonb("summary"),
    error: text("error"),
  },
  (t) => [index("analysis_jobs_kind_idx").on(t.kind)],
);

export const spatialAnalysisResults = pgTable(
  "spatial_analysis_results",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => spatialAnalysisJobs.id, { onDelete: "cascade" }),
    geometry: jsonb("geometry").notNull(),
    value: real("value"),
    classification: text("classification"),
    rank: integer("rank"),
    properties: jsonb("properties").default({}),
  },
  (t) => [index("analysis_results_job_idx").on(t.jobId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    detail: jsonb("detail").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)],
);
