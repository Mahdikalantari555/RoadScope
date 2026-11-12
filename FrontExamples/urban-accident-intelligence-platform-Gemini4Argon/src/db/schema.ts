import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    handle: text("handle").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(), // 'simulation_scientist' | 'citizen_reporter' | 'data_steward' | 'gis_researcher' | 'safety_engineer' | 'mobility_analyst'
    trustScore: doublePrecision("trust_score").notNull().default(0.85),
    affiliation: text("affiliation").notNull().default("Urban Geomatics Lab"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("users_role_idx").on(table.role)]
);

export const datasetSources = pgTable(
  "dataset_sources",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    scenarioType: text("scenario_type").notNull(), // 'uniform_baseline' | 'intersection_clustered' | 'diurnal_rush_hour_shock' | 'multi_covariate_complex_urban' | 'empirical_vgi'
    seed: integer("seed").notNull().default(42),
    sridProjected: integer("srid_projected").notNull().default(32618), // WGS 84 / UTM zone 18N (Metric)
    sridGeographic: integer("srid_geographic").notNull().default(4326), // WGS 84 (Geographic)
    lixelSizeM: doublePrecision("lixel_size_m").notNull().default(50),
    description: text("description").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("dataset_sources_scenario_idx").on(table.scenarioType)]
);

export const roadNodes = pgTable(
  "road_nodes",
  {
    id: serial("id").primaryKey(),
    nodeCode: text("node_code").notNull().unique(),
    name: text("name").notNull(),
    xM: doublePrecision("x_m").notNull(), // Metric Easting (EPSG:32618)
    yM: doublePrecision("y_m").notNull(), // Metric Northing (EPSG:32618)
    lon: doublePrecision("lon").notNull(), // Geographic Longitude (EPSG:4326)
    lat: doublePrecision("lat").notNull(), // Geographic Latitude (EPSG:4326)
    sridProjected: integer("srid_projected").notNull().default(32618),
    degree: integer("degree").notNull().default(2),
    isSignalized: boolean("is_signalized").notNull().default(false),
    elevationM: doublePrecision("elevation_m").notNull().default(12.0),
    datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  },
  (table) => [
    index("road_nodes_spatial_metric_idx").on(table.xM, table.yM),
    index("road_nodes_spatial_geo_idx").on(table.lon, table.lat),
  ]
);

export const roadSegments = pgTable(
  "road_segments",
  {
    id: serial("id").primaryKey(),
    segmentCode: text("segment_code").notNull().unique(),
    name: text("name").notNull(),
    roadClass: text("road_class").notNull(), // 'motorway' | 'arterial' | 'collector' | 'local'
    fromNodeId: integer("from_node_id")
      .notNull()
      .references(() => roadNodes.id),
    toNodeId: integer("to_node_id")
      .notNull()
      .references(() => roadNodes.id),
    isDirected: boolean("is_directed").notNull().default(false),
    isOverpass: boolean("is_overpass").notNull().default(false),
    lengthM: doublePrecision("length_m").notNull(),
    speedLimitKmh: integer("speed_limit_kmh").notNull().default(50),
    laneCount: integer("lane_count").notNull().default(2),
    sinuosity: doublePrecision("sinuosity").notNull().default(1.02),
    aadt: integer("aadt").notNull().default(12000), // Annual Average Daily Traffic
    spfAlpha: doublePrecision("spf_alpha").notNull().default(-8.2),
    spfBeta: doublePrecision("spf_beta").notNull().default(0.95),
    spfOverdispersionPhi: doublePrecision("spf_overdispersion_phi").notNull().default(0.35),
    coordsMetricJson: jsonb("coords_metric_json").$type<[number, number][]>().notNull(),
    coordsGeoJson: jsonb("coords_geo_json").$type<[number, number][]>().notNull(),
    bboxMinX: doublePrecision("bbox_min_x").notNull(),
    bboxMinY: doublePrecision("bbox_min_y").notNull(),
    bboxMaxX: doublePrecision("bbox_max_x").notNull(),
    bboxMaxY: doublePrecision("bbox_max_y").notNull(),
    datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  },
  (table) => [
    index("road_segments_bbox_idx").on(
      table.bboxMinX,
      table.bboxMinY,
      table.bboxMaxX,
      table.bboxMaxY
    ),
    index("road_segments_class_idx").on(table.roadClass),
    index("road_segments_topology_idx").on(table.fromNodeId, table.toNodeId),
  ]
);

export const roadLixels = pgTable(
  "road_lixels",
  {
    id: serial("id").primaryKey(),
    lixelCode: text("lixel_code").notNull().unique(),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => roadSegments.id),
    lixelIndex: integer("lixel_index").notNull(),
    mStartM: doublePrecision("m_start_m").notNull(), // LRS start offset (m)
    mEndM: doublePrecision("m_end_m").notNull(), // LRS end offset (m)
    lengthM: doublePrecision("length_m").notNull(),
    centerXM: doublePrecision("center_x_m").notNull(),
    centerYM: doublePrecision("center_y_m").notNull(),
    centerLon: doublePrecision("center_lon").notNull(),
    centerLat: doublePrecision("center_lat").notNull(),
    distToNearestJunctionM: doublePrecision("dist_to_nearest_junction_m").notNull(),
    coordsMetricJson: jsonb("coords_metric_json").$type<[number, number][]>().notNull(),
    coordsGeoJson: jsonb("coords_geo_json").$type<[number, number][]>().notNull(),
    trueIntensityLambda: doublePrecision("true_intensity_lambda").notNull().default(0.1),
    baselineRiskPrior: doublePrecision("baseline_risk_prior").notNull().default(0.1),
    datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
  },
  (table) => [
    index("road_lixels_segment_idx").on(table.segmentId, table.lixelIndex),
    index("road_lixels_spatial_metric_idx").on(table.centerXM, table.centerYM),
  ]
);

export const accidentCategories = pgTable("accident_categories", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  defaultRiskWeight: doublePrecision("default_risk_weight").notNull().default(1.0),
});

export const severityLevels = pgTable("severity_levels", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // 'fatal' | 'severe_injury' | 'minor_injury' | 'pdo'
  label: text("label").notNull(),
  rank: integer("rank").notNull(),
  epdoWeight: doublePrecision("epdo_weight").notNull(), // e.g., 9.5, 5.5, 2.5, 1.0
  colorHex: text("color_hex").notNull(),
});

export interface SnapCandidate {
  segmentId: number;
  segmentCode: string;
  segmentName: string;
  roadClass: string;
  lixelId: number;
  lixelCode: string;
  linearOffsetM: number;
  orthogonalDistM: number;
  snappedXM: number;
  snappedYM: number;
  snappedLon: number;
  snappedLat: number;
  probabilityScore: number;
  junctionDistanceM: number;
}

export const accidents = pgTable(
  "accidents",
  {
    id: serial("id").primaryKey(),
    incidentCode: text("incident_code").notNull().unique(),
    datasetSourceId: integer("dataset_source_id").references(() => datasetSources.id),
    parentCanonicalId: integer("parent_canonical_id"), // Self-reference when conflated into a canonical incident
    // Raw reported VGI geometry (never destroyed)
    rawXM: doublePrecision("raw_x_m").notNull(),
    rawYM: doublePrecision("raw_y_m").notNull(),
    rawLon: doublePrecision("raw_lon").notNull(),
    rawLat: doublePrecision("raw_lat").notNull(),
    observationalRadiusM: doublePrecision("observational_radius_m").notNull().default(15.0),
    // Network-snapped geometry & LRS reference
    snappedSegmentId: integer("snapped_segment_id")
      .notNull()
      .references(() => roadSegments.id),
    snappedLixelId: integer("snapped_lixel_id")
      .notNull()
      .references(() => roadLixels.id),
    snappedXM: doublePrecision("snapped_x_m").notNull(),
    snappedYM: doublePrecision("snapped_y_m").notNull(),
    snappedLon: doublePrecision("snapped_lon").notNull(),
    snappedLat: doublePrecision("snapped_lat").notNull(),
    linearOffsetM: doublePrecision("linear_offset_m").notNull(),
    snapDistanceM: doublePrecision("snap_distance_m").notNull(),
    snapProbabilityScore: doublePrecision("snap_probability_score").notNull().default(0.92),
    snapCandidatesJson: jsonb("snap_candidates_json").$type<SnapCandidate[]>().notNull(),
    // Temporal attributes (strictly UTC)
    incidentTimestampUtc: timestamp("incident_timestamp_utc", { withTimezone: true }).notNull(),
    reportedTimestampUtc: timestamp("reported_timestamp_utc", { withTimezone: true }).notNull(),
    reportingLagMinutes: doublePrecision("reporting_lag_minutes").notNull().default(4.0),
    // Structured incident taxonomy & covariates
    categoryCode: text("category_code").notNull(),
    severityCode: text("severity_code").notNull(),
    vehicleCount: integer("vehicle_count").notNull().default(2),
    pedestrianCount: integer("pedestrian_count").notNull().default(0),
    emergencyResponsePresent: boolean("emergency_response_present").notNull().default(true),
    weatherCondition: text("weather_condition").notNull().default("Clear"),
    lightingCondition: text("lighting_condition").notNull().default("Daylight"),
    roadSurface: text("road_surface").notNull().default("Dry"),
    narrative: text("narrative").notNull(),
    // VGI Stewardship & Conflation Lifecycle
    verificationStatus: text("verification_status").notNull().default("unverified_raw_vgi"),
    // 'unverified_raw_vgi' | 'verified_canonical' | 'conflated_witness_child' | 'rejected' | 'flagged'
    credibilityScore: doublePrecision("credibility_score").notNull().default(0.65),
    witnessCount: integer("witness_count").notNull().default(1),
    reporterUserId: integer("reporter_user_id").references(() => users.id),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    isFalseAlarm: boolean("is_false_alarm").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("accidents_snapped_lixel_idx").on(table.snappedLixelId),
    index("accidents_snapped_segment_idx").on(table.snappedSegmentId),
    index("accidents_temporal_utc_idx").on(table.incidentTimestampUtc),
    index("accidents_verification_status_idx").on(table.verificationStatus),
    index("accidents_raw_spatial_idx").on(table.rawXM, table.rawYM),
  ]
);

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id")
      .notNull()
      .references(() => accidents.id),
    stewardUserId: integer("steward_user_id").references(() => users.id),
    previousStatus: text("previous_status").notNull(),
    newStatus: text("new_status").notNull(),
    verificationNotes: text("verification_notes").notNull(),
    overriddenSegmentId: integer("overridden_segment_id"),
    overriddenOffsetM: doublePrecision("overridden_offset_m"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("report_verifications_accident_idx").on(table.accidentId)]
);

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: serial("id").primaryKey(),
    accidentId: integer("accident_id")
      .notNull()
      .references(() => accidents.id),
    mediaType: text("media_type").notNull().default("image/jpeg"),
    fileName: text("file_name").notNull(),
    exifStripped: boolean("exif_stripped").notNull().default(true),
    privacyVerified: boolean("privacy_verified").notNull().default(true),
    fileSizeKb: integer("file_size_kb").notNull().default(420),
    metadataSummary: text("metadata_summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("report_attachments_accident_idx").on(table.accidentId)]
);

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: serial("id").primaryKey(),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => roadSegments.id),
    observedAtUtc: timestamp("observed_at_utc", { withTimezone: true }).notNull(),
    weatherState: text("weather_state").notNull(),
    precipitationMmHr: doublePrecision("precipitation_mm_hr").notNull().default(0.0),
    visibilityKm: doublePrecision("visibility_km").notNull().default(10.0),
    ambientLightLux: doublePrecision("ambient_light_lux").notNull().default(15000.0),
    surfaceFrictionIndex: doublePrecision("surface_friction_index").notNull().default(0.78),
  },
  (table) => [
    index("env_obs_segment_time_idx").on(table.segmentId, table.observedAtUtc),
  ]
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: serial("id").primaryKey(),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => roadSegments.id),
    hourOfDay: integer("hour_of_day").notNull(),
    aadtObserved: integer("aadt_observed").notNull(),
    meanSpeedKmh: doublePrecision("mean_speed_kmh").notNull(),
    heavyVehiclePct: doublePrecision("heavy_vehicle_pct").notNull().default(6.5),
    vktDailyMillion: doublePrecision("vkt_daily_million").notNull(),
  },
  (table) => [index("traffic_obs_segment_idx").on(table.segmentId)]
);

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: serial("id").primaryKey(),
    jobCode: text("job_code").notNull().unique(),
    jobType: text("job_type").notNull(), // 'nkde_vs_planar' | 'network_gi_star' | 'network_dbscan' | 'eb_smoothing' | 'simulation_run'
    status: text("status").notNull().default("completed"), // 'queued' | 'running' | 'completed' | 'failed'
    parametersJson: jsonb("parameters_json").notNull(),
    sridUsed: integer("srid_used").notNull().default(32618),
    sampleSize: integer("sample_size").notNull(),
    executionTimeMs: doublePrecision("execution_time_ms").notNull(),
    summaryMetricsJson: jsonb("summary_metrics_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("spatial_jobs_type_idx").on(table.jobType, table.createdAt)]
);

export const spatialAnalysisResults = pgTable(
  "spatial_analysis_results",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => spatialAnalysisJobs.id),
    lixelId: integer("lixel_id")
      .notNull()
      .references(() => roadLixels.id),
    segmentId: integer("segment_id")
      .notNull()
      .references(() => roadSegments.id),
    nkdeValue: doublePrecision("nkde_value").notNull().default(0),
    planarKdeValue: doublePrecision("planar_kde_value").notNull().default(0),
    kdeDiffValue: doublePrecision("kde_diff_value").notNull().default(0),
    giStarZ: doublePrecision("gi_star_z").notNull().default(0),
    giStarPValue: doublePrecision("gi_star_p_value").notNull().default(1),
    giStarFdrPValue: doublePrecision("gi_star_fdr_p_value").notNull().default(1),
    giStarClusterType: text("gi_star_cluster_type").notNull().default("Not Significant"),
    dbscanClusterId: integer("dbscan_cluster_id").notNull().default(-1),
    ebExpectedRate: doublePrecision("eb_expected_rate").notNull().default(0),
    psiExcessRate: doublePrecision("psi_excess_rate").notNull().default(0),
    epdoScore: doublePrecision("epdo_score").notNull().default(0),
    vulnerabilityScore: doublePrecision("vulnerability_score").notNull().default(0),
    epistemicUncertainty: doublePrecision("epistemic_uncertainty").notNull().default(0.15),
    trueLambdaBenchmark: doublePrecision("true_lambda_benchmark").notNull().default(0),
  },
  (table) => [index("spatial_results_job_lixel_idx").on(table.jobId, table.lixelId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorRole: text("actor_role").notNull(),
    actorName: text("actor_name").notNull(),
    actionType: text("action_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detailsJson: jsonb("details_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_logs_created_idx").on(table.createdAt)]
);
