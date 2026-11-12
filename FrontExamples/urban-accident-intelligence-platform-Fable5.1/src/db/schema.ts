import {
  pgTable, serial, text, integer, doublePrecision, boolean, timestamp, jsonb, index, real,
} from "drizzle-orm/pg-core";

/**
 * Dual-CRS convention: every geometry stores canonical WGS84 (lon/lat, SRID 4326)
 * plus the local metric plane (x/y metres, azimuthal-equidistant about the dataset origin).
 * All metric computations (lengths, offsets, bandwidths) run on x/y. Timestamps are UTC.
 */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(), // citizen | steward | researcher | engineer | admin
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const datasetSources = pgTable("dataset_sources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // synthetic | empirical
  scenario: text("scenario"),
  seed: integer("seed"),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  originLon: doublePrecision("origin_lon").notNull(),
  originLat: doublePrecision("origin_lat").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roadNodes = pgTable("road_nodes", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  lon: doublePrecision("lon").notNull(),
  lat: doublePrecision("lat").notNull(),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  degree: integer("degree").notNull().default(0),
}, (t) => [index("road_nodes_src_idx").on(t.sourceId), index("road_nodes_xy_idx").on(t.x, t.y)]);

export const roadSegments = pgTable("road_segments", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  fromNodeId: integer("from_node_id").notNull().references(() => roadNodes.id, { onDelete: "cascade" }),
  toNodeId: integer("to_node_id").notNull().references(() => roadNodes.id, { onDelete: "cascade" }),
  roadClass: text("road_class").notNull(), // arterial | collector | local
  speedLimit: integer("speed_limit").notNull(),
  lanes: integer("lanes").notNull(),
  oneway: boolean("oneway").notNull().default(false),
  lengthM: doublePrecision("length_m").notNull(),
  sinuosity: doublePrecision("sinuosity").notNull().default(1),
  aadt: integer("aadt"),
  coordsLonLat: jsonb("coords_lonlat").$type<[number, number][]>().notNull(),
  coordsXY: jsonb("coords_xy").$type<[number, number][]>().notNull(),
  minX: doublePrecision("min_x").notNull(), minY: doublePrecision("min_y").notNull(),
  maxX: doublePrecision("max_x").notNull(), maxY: doublePrecision("max_y").notNull(),
}, (t) => [index("road_segments_src_idx").on(t.sourceId), index("road_segments_bbox_idx").on(t.minX, t.maxX, t.minY, t.maxY)]);

export const roadLixels = pgTable("road_lixels", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  segmentId: integer("segment_id").notNull().references(() => roadSegments.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  mStart: doublePrecision("m_start").notNull(),
  mEnd: doublePrecision("m_end").notNull(),
  lengthM: doublePrecision("length_m").notNull(),
  midLon: doublePrecision("mid_lon").notNull(),
  midLat: doublePrecision("mid_lat").notNull(),
  midX: doublePrecision("mid_x").notNull(),
  midY: doublePrecision("mid_y").notNull(),
  coordsLonLat: jsonb("coords_lonlat").$type<[number, number][]>().notNull(),
  trueIntensity: doublePrecision("true_intensity"), // hidden ground truth ∫λ(e,m,t)dt per metre (synthetic only)
}, (t) => [index("road_lixels_src_idx").on(t.sourceId), index("road_lixels_seg_idx").on(t.segmentId), index("road_lixels_xy_idx").on(t.midX, t.midY)]);

export const accidentCategories = pgTable("accident_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
});

export const severityLevels = pgTable("severity_levels", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
  rank: integer("rank").notNull(),
  epdoWeight: doublePrecision("epdo_weight").notNull(),
});

export const accidents = pgTable("accidents", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  reporterId: integer("reporter_id").references(() => users.id),
  categoryId: integer("category_id").notNull().references(() => accidentCategories.id),
  severityId: integer("severity_id").notNull().references(() => severityLevels.id),
  status: text("status").notNull().default("raw"), // raw | verified | rejected | merged | flagged
  isSynthetic: boolean("is_synthetic").notNull().default(true),
  // raw observational geometry (never mutated)
  rawLon: doublePrecision("raw_lon").notNull(), rawLat: doublePrecision("raw_lat").notNull(),
  rawX: doublePrecision("raw_x").notNull(), rawY: doublePrecision("raw_y").notNull(),
  uncertaintyRadiusM: doublePrecision("uncertainty_radius_m").notNull().default(15),
  // validated network-snapped geometry + LRS offset
  snapLon: doublePrecision("snap_lon"), snapLat: doublePrecision("snap_lat"),
  snapX: doublePrecision("snap_x"), snapY: doublePrecision("snap_y"),
  segmentId: integer("segment_id").references(() => roadSegments.id, { onDelete: "set null" }),
  lixelId: integer("lixel_id").references(() => roadLixels.id, { onDelete: "set null" }),
  offsetM: doublePrecision("offset_m"),
  snapDistanceM: doublePrecision("snap_distance_m"),
  snapPosterior: doublePrecision("snap_posterior"),
  snapCandidates: jsonb("snap_candidates").$type<unknown[]>().notNull().default([]),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
  vehicles: integer("vehicles").notNull().default(1),
  pedestrians: integer("pedestrians").notNull().default(0),
  emergencyPresent: boolean("emergency_present").notNull().default(false),
  weather: text("weather").notNull().default("clear"),
  lighting: text("lighting").notNull().default("daylight"),
  description: text("description"),
  witnessCount: integer("witness_count").notNull().default(1),
  credibility: doublePrecision("credibility").notNull().default(0.3),
  canonicalId: integer("canonical_id"), // set when merged into another accident
  // simulator-only hidden truth (used for benchmarking; never shown as data)
  trueEventKey: text("true_event_key"),
  isFalseAlarm: boolean("is_false_alarm").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("accidents_src_idx").on(t.sourceId),
  index("accidents_occurred_idx").on(t.occurredAt),
  index("accidents_status_idx").on(t.status),
  index("accidents_seg_idx").on(t.segmentId),
  index("accidents_xy_idx").on(t.snapX, t.snapY),
]);

export const reportVerifications = pgTable("report_verifications", {
  id: serial("id").primaryKey(),
  accidentId: integer("accident_id").notNull().references(() => accidents.id, { onDelete: "cascade" }),
  reviewerId: integer("reviewer_id").references(() => users.id),
  action: text("action").notNull(), // verify | reject | flag | merge | edit | corroborate
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("verif_acc_idx").on(t.accidentId)]);

export const reportAttachments = pgTable("report_attachments", {
  id: serial("id").primaryKey(),
  accidentId: integer("accident_id").notNull().references(() => accidents.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  metadataStripped: boolean("metadata_stripped").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const environmentalObservations = pgTable("environmental_observations", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  weather: text("weather").notNull(),
  temperatureC: real("temperature_c").notNull(),
  precipitationMm: real("precipitation_mm").notNull(),
  lighting: text("lighting").notNull(),
}, (t) => [index("env_obs_time_idx").on(t.observedAt)]);

export const trafficObservations = pgTable("traffic_observations", {
  id: serial("id").primaryKey(),
  segmentId: integer("segment_id").notNull().references(() => roadSegments.id, { onDelete: "cascade" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  aadt: integer("aadt").notNull(),
  meanSpeedKmh: real("mean_speed_kmh").notNull(),
}, (t) => [index("traffic_seg_idx").on(t.segmentId)]);

export const spatialAnalysisJobs = pgTable("spatial_analysis_jobs", {
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull().references(() => datasetSources.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // nkde | gistar | ndbscan | benchmark | eb
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  progress: real("progress").notNull().default(0),
  error: text("error"),
  runtimeMs: integer("runtime_ms"),
  sampleSize: integer("sample_size"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const spatialAnalysisResults = pgTable("spatial_analysis_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => spatialAnalysisJobs.id, { onDelete: "cascade" }),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  lixelValues: jsonb("lixel_values").$type<Record<string, unknown>>().notNull(),
  geojson: jsonb("geojson").$type<Record<string, unknown>>(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => users.id),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);
