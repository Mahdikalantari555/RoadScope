import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  uuid,
  primaryKey,
} from "drizzle-orm/pg-core";

// ─── Core Reference Tables ──────────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  role: varchar("role", { length: 32 }).notNull().default("citizen"), // citizen | steward | researcher | engineer
  displayName: varchar("display_name", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const datasetSources = pgTable("dataset_sources", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(), // synthetic_simulation | vgi_citizen | official_police
  scenario: varchar("scenario", { length: 64 }), // uniform | intersection_clustered | rush_hour | complex_urban
  seed: integer("seed"),
  params: jsonb("params"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const severityLevels = pgTable("severity_levels", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(), // PDO | injury | severe | fatal
  label: varchar("label", { length: 64 }).notNull(),
  epdoWeight: doublePrecision("epdo_weight").notNull(), // Property Damage Equivalent weight
  color: varchar("color", { length: 8 }).notNull(),
});

export const accidentCategories = pgTable("accident_categories", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  label: varchar("label", { length: 128 }).notNull(),
  isVehicle: boolean("is_vehicle").default(true),
  isPedestrian: boolean("is_pedestrian").default(false),
  isCyclist: boolean("is_cyclist").default(false),
});

// ─── Road Network Topology ──────────────────────────────────────────────────

// Intersection nodes (planar metric coordinates in local city CRS, in meters)
export const roadNodes = pgTable("road_nodes", {
  id: serial("id").primaryKey(),
  datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  nodeId: varchar("node_id", { length: 64 }).notNull(), // external ID like "n_0001"
  x: doublePrecision("x").notNull(), // meters in local projected CRS
  y: doublePrecision("y").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  degree: integer("degree").default(0),
  isIntersection: boolean("is_intersection").default(true),
  signalized: boolean("signalized").default(false),
});

// Directed/undirected road edges
export const roadSegments = pgTable("road_segments", {
  id: serial("id").primaryKey(),
  datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  segmentId: varchar("segment_id", { length: 64 }).notNull(),
  fromNodeId: integer("from_node_id").references(() => roadNodes.id),
  toNodeId: integer("to_node_id").references(() => roadNodes.id),
  // Geometry stored as GeoJSON LineString in projected metric CRS
  geom: jsonb("geom").notNull(),
  geographicGeom: jsonb("geographic_geom").notNull(), // WGS84 LonLat for mapping
  lengthMeters: doublePrecision("length_meters").notNull(),
  roadClass: varchar("road_class", { length: 32 }).notNull(), // motorway | primary | secondary | tertiary | residential
  hierarchyLevel: integer("hierarchy_level").notNull(), // 1..5
  speedLimit: integer("speed_limit").default(50),
  laneCount: integer("lane_count").default(2),
  aadt: doublePrecision("aadt"), // Annual Average Daily Traffic (vehicles/day)
  sinuosity: doublePrecision("sinuosity").default(1.0),
  lighting: boolean("lighting").default(true),
  pedestrianFacility: boolean("pedestrian_facility").default(false),
  oneway: boolean("oneway").default(false),
});

// Uniform linear pixels (lixels) for MAUP-free analysis
export const roadLixels = pgTable("road_lixels", {
  id: serial("id").primaryKey(),
  datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  lixelId: varchar("lixel_id", { length: 64 }).notNull(),
  parentSegmentId: integer("parent_segment_id").references(() => roadSegments.id),
  // Offset along parent edge (linear referencing m-values)
  mStart: doublePrecision("m_start").notNull(),
  mEnd: doublePrecision("m_end").notNull(),
  lengthMeters: doublePrecision("length_meters").notNull(),
  resolution: doublePrecision("resolution").notNull(), // e.g., 50m
  geom: jsonb("geom").notNull(),
  geographicGeom: jsonb("geographic_geom").notNull(),
  // Precomputed for analysis
  midpointX: doublePrecision("midpoint_x").notNull(),
  midpointY: doublePrecision("midpoint_y").notNull(),
  midpointLon: doublePrecision("midpoint_lon").notNull(),
  midpointLat: doublePrecision("midpoint_lat").notNull(),
  roadClass: varchar("road_class", { length: 32 }),
  aadt: doublePrecision("aadt"),
  // ground-truth intensity lambda (for synthetic benchmarking)
  groundTruthLambda: doublePrecision("ground_truth_lambda"),
});

// ─── Accidents / Incidents ──────────────────────────────────────────────────

export const accidents = pgTable("accidents", {
  id: serial("id").primaryKey(),
  uuid: uuid("uuid").defaultRandom().notNull(),
  datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  parentAccidentId: integer("parent_accident_id"), // for duplicates merged into canonical
  status: varchar("status", { length: 32 }).notNull().default("raw_vgi"),
  // raw_vgi | map_matched | verified | rejected | merged | synthetic_ground_truth
  reporterId: integer("reporter_id").references(() => users.id),
  // Reported vs actual time
  incidentTime: timestamp("incident_time", { withTimezone: true }).notNull(),
  reportTime: timestamp("report_time", { withTimezone: true }).notNull(),
  reportingLagMinutes: doublePrecision("reporting_lag_minutes"),
  // Raw citizen-reported point (may be off-network)
  rawGeom: jsonb("raw_geom").notNull(), // GeoJSON Point metric CRS
  rawLon: doublePrecision("raw_lon").notNull(),
  rawLat: doublePrecision("raw_lat").notNull(),
  rawPositionalUncertaintyM: doublePrecision("raw_positional_uncertainty_m").default(25),
  // Map-matched on-network location
  snappedGeom: jsonb("snapped_geom"),
  snappedLon: doublePrecision("snapped_lon"),
  snappedLat: doublePrecision("snapped_lat"),
  snappedSegmentId: integer("snapped_segment_id").references(() => roadSegments.id),
  snappedLixelId: integer("snapped_lixel_id").references(() => roadLixels.id),
  snappedOffsetM: doublePrecision("snapped_offset_m"),
  snapDistanceM: doublePrecision("snap_distance_m"),
  snapConfidence: doublePrecision("snap_confidence"),
  // Temporal & attributes
  severityId: integer("severity_id").references(() => severityLevels.id),
  categoryId: integer("category_id").references(() => accidentCategories.id),
  vehicleCount: integer("vehicle_count").default(1),
  pedestrianCount: integer("pedestrian_count").default(0),
  cyclistCount: integer("cyclist_count").default(0),
  fatalities: integer("fatalities").default(0),
  injuries: integer("injuries").default(0),
  emergencyResponse: boolean("emergency_response").default(false),
  weather: varchar("weather", { length: 32 }), // clear | rain | fog | snow
  lightingCondition: varchar("lighting_condition", { length: 32 }), // daylight | dusk | dark_lit | dark_unlit
  roadSurface: varchar("road_surface", { length: 32 }), // dry | wet | ice | snow
  narrative: text("narrative"),
  // VGI credibility
  witnessCount: integer("witness_count").default(1),
  credibilityScore: doublePrecision("credibility_score").default(0.5),
  isFalseAlarm: boolean("is_false_alarm").default(false),
  // Ground truth (for synthetic data only)
  groundTruthIntensity: doublePrecision("ground_truth_intensity"),
  trueSegmentId: integer("true_segment_id"),
  trueOffsetM: doublePrecision("true_offset_m"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const reportVerifications = pgTable("report_verifications", {
  id: serial("id").primaryKey(),
  accidentId: integer("accident_id").references(() => accidents.id).notNull(),
  stewardId: integer("steward_id").references(() => users.id).notNull(),
  action: varchar("action", { length: 32 }).notNull(), // verify | reject | merge | edit | flag
  notes: text("notes"),
  previousValues: jsonb("previous_values"),
  newValue: jsonb("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── Analysis Results ───────────────────────────────────────────────────────

export const spatialAnalysisJobs = pgTable("spatial_analysis_jobs", {
  id: serial("id").primaryKey(),
  jobType: varchar("job_type", { length: 64 }).notNull(),
  // nkde | planar_kde | network_getis_ord | ndbscan | eb_smoothing | simulation
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  params: jsonb("params").notNull(),
  datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  createdBy: integer("created_by").references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  runtimeMs: integer("runtime_ms"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const spatialAnalysisResults = pgTable("spatial_analysis_results", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").references(() => spatialAnalysisJobs.id).notNull(),
  lixelId: integer("lixel_id").references(() => roadLixels.id),
  segmentId: integer("segment_id").references(() => roadSegments.id),
  resultType: varchar("result_type", { length: 64 }).notNull(),
  value: doublePrecision("value"),
  valueLower: doublePrecision("value_lower"),
  valueUpper: doublePrecision("value_upper"),
  pValue: doublePrecision("p_value"),
  zScore: doublePrecision("z_score"),
  clusterType: varchar("cluster_type", { length: 32 }), // hot | cold | nonsig
  extra: jsonb("extra"),
  geom: jsonb("geom"),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }),
  entityId: integer("entity_id"),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
