/**
 * Urban Accident Intelligence — normalized relational-spatial schema.
 *
 * Dual-CRS strategy
 * -----------------
 * Canonical geometry is stored in a *metric projected* CRS (UTM, EPSG:326xx) in
 * the columns `x` / `y` (easting / northing, metres) together with an explicit
 * `srid`. Geographic WGS84 (lon/lat, EPSG:4326) is materialised only at the
 * serialisation boundary (`src/lib/geojson.ts`) for web-mapping protocols.
 * All lengths, buffers, kernel bandwidths and shortest-path costs are computed
 * in metres. Every row additionally carries a discrete spatial-hash `gridKey`
 * (100 m cell) which is B-tree indexed and acts as the R-Tree/GiST surrogate
 * for candidate-set retrieval in this PostGIS-free deployment.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const uuid = () => crypto.randomUUID();
const now = () => new Date();

/* ------------------------------------------------------------------ */
/* Reference / controlled vocabularies                                 */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", {
      enum: [
        "simulation_scientist",
        "citizen_reporter",
        "data_steward",
        "researcher",
        "safety_engineer",
        "mobility_analyst",
        "administrator",
      ],
    })
      .notNull()
      .default("citizen_reporter"),
    /** RBAC permission atoms resolved server-side; never trusted from client. */
    permissions: jsonb("permissions").$type<string[]>().notNull().$defaultFn(() => []),
    isSyntheticActor: boolean("is_synthetic_actor").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email)],
);

export const accidentCategories = pgTable(
  "accident_categories",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    code: text("code").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    /** Relative reporting-propensity multiplier used by the VGI noise model. */
    reportingPropensity: doublePrecision("reporting_propensity").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("accident_categories_code_key").on(t.code)],
);

export const severityLevels = pgTable(
  "severity_levels",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    code: text("code").notNull(),
    label: text("label").notNull(),
    rank: integer("rank").notNull(),
    /** Equivalent Property Damage Only weight (KABO-style multiplier). */
    epdoWeight: doublePrecision("epdo_weight").notNull().default(1),
    injuryWeight: doublePrecision("injury_weight").notNull().default(0),
    color: text("color").notNull().default("#94a3b8"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("severity_levels_code_key").on(t.code)],
);

/* ------------------------------------------------------------------ */
/* Datasets (provenance root)                                          */
/* ------------------------------------------------------------------ */

export const datasetSources = pgTable(
  "dataset_sources",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["synthetic", "empirical", "imported"] }).notNull().default("synthetic"),
    /** Simulation scenario label; always surfaced in the UI for synthetic data. */
    scenario: text("scenario", {
      enum: [
        "uniform_baseline",
        "intersection_clustered",
        "diurnal_rush_hour_shock",
        "multi_covariate_complex_urban",
        "empirical",
      ],
    })
      .notNull()
      .default("uniform_baseline"),
    seed: integer("seed").notNull(),
    /** EPSG code of the canonical metric projected CRS. */
    srid: integer("srid").notNull().default(32633),
    crsAuthority: text("crs_authority").notNull().default("EPSG"),
    crsName: text("crs_name").notNull().default("WGS 84 / UTM zone 33N"),
    utmZone: integer("utm_zone").notNull().default(33),
    hemisphere: text("hemisphere", { enum: ["north", "south"] }).notNull().default("north"),
    originLon: doublePrecision("origin_lon").notNull(),
    originLat: doublePrecision("origin_lat").notNull(),
    /** Lixel resolution in metres (LRS spatial unit). */
    lixelLengthM: doublePrecision("lixel_length_m").notNull().default(25),
    extentXMin: doublePrecision("extent_x_min"),
    extentXMax: doublePrecision("extent_x_max"),
    extentYMin: doublePrecision("extent_y_min"),
    extentYMax: doublePrecision("extent_y_max"),
    networkStats: jsonb("network_stats")
      .$type<{
        nodeCount: number;
        segmentCount: number;
        lixelCount: number;
        totalLengthKm: number;
        meanSegmentLengthM: number;
        meanNodeDegree: number;
        classShare: Record<string, number>;
        betaGamma: { beta: number; gamma: number };
      } | null>()
      .default(null),
    /** Full simulator parameter block — required for reproducible ground truth. */
    simParams: jsonb("sim_params")
      .$type<Record<string, unknown> | null>()
      .default(null),
    groundTruthAvailable: boolean("ground_truth_available").notNull().default(false),
    recordCounts: jsonb("record_counts")
      .$type<{
        groundTruthAccidents: number;
        vgiReports: number;
        verifiedAccidents: number;
        falseAlarms: number;
      } | null>()
      .default(null),
    generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).$defaultFn(now),
    generatorVersion: text("generator_version").notNull().default("1.0.0"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("dataset_sources_slug_key").on(t.slug), index("dataset_sources_kind_idx").on(t.kind)],
);

/* ------------------------------------------------------------------ */
/* Road network topology                                               */
/* ------------------------------------------------------------------ */

export const roadNodes = pgTable(
  "road_nodes",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    srid: integer("srid").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    gridKey: text("grid_key").notNull(),
    /** Topological degree in the undirected projection of the graph. */
    degree: integer("degree").notNull().default(0),
    nodeType: text("node_type", { enum: ["intersection", "dead_end", "boundary", "grade_separator"] })
      .notNull()
      .default("intersection"),
    control: text("control", { enum: ["none", "yield", "stop", "signal", "roundabout", "interchange"] })
      .notNull()
      .default("none"),
    isGradeSeparated: boolean("is_grade_separated").notNull().default(false),
    elevationM: doublePrecision("elevation_m").notNull().default(0),
  },
  (t) => [
    index("road_nodes_dataset_idx").on(t.datasetId),
    index("road_nodes_grid_idx").on(t.datasetId, t.gridKey),
    index("road_nodes_xy_idx").on(t.x, t.y),
  ],
);

export const roadSegments = pgTable(
  "road_segments",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    srid: integer("srid").notNull(),
    fromNodeId: text("from_node_id").notNull(),
    toNodeId: text("to_node_id").notNull(),
    x1: doublePrecision("x1").notNull(),
    y1: doublePrecision("y1").notNull(),
    x2: doublePrecision("x2").notNull(),
    y2: doublePrecision("y2").notNull(),
    gridKey: text("grid_key").notNull(),
    /** Ordered centreline vertices in the metric CRS (realises sinuosity / LRS). */
    shape: jsonb("shape").$type<Array<[number, number]>>().notNull().$defaultFn(() => []),
    /** Geodesic (metric) length of the centreline chord. */
    lengthM: doublePrecision("length_m").notNull(),
    /** Curvilinear length including sinuosity — used for LRS m-values. */
    curvilinearLengthM: doublePrecision("curvilinear_length_m").notNull(),
    sinuosity: doublePrecision("sinuosity").notNull().default(1),
    roadClass: text("road_class", {
      enum: ["motorway", "primary", "secondary", "tertiary", "residential", "service"],
    }).notNull(),
    classOrdinal: integer("class_ordinal").notNull(),
    name: text("name"),
    directional: boolean("directional").notNull().default(false),
    lanes: integer("lanes").notNull().default(2),
    speedLimitKph: doublePrecision("speed_limit_kph").notNull().default(50),
    /** Annual average daily traffic — exposure proxy. NULL ⇒ epistemic gap. */
    aadt: integer("aadt"),
    aadtSource: text("aadt_source", { enum: ["counter", "modelled", "missing"] })
      .notNull()
      .default("modelled"),
    curvaturePerKm: doublePrecision("curvature_per_km").notNull().default(0),
    lighting: text("lighting", { enum: ["daylight", "lit", "unlit"] }).notNull().default("lit"),
    surface: text("surface", { enum: ["asphalt", "concrete", "cobble", "gravel"] })
      .notNull()
      .default("asphalt"),
    isBridge: boolean("is_bridge").notNull().default(false),
    sidewalk: boolean("sidewalk").notNull().default(true),
    cycleLane: boolean("cycle_lane").notNull().default(false),
    /** Per-km vehicle kilometres travelled derived from AADT (exposure denominator). */
    vktPerDay: doublePrecision("vkt_per_day"),
  },
  (t) => [
    index("road_segments_dataset_idx").on(t.datasetId),
    index("road_segments_grid_idx").on(t.datasetId, t.gridKey),
    index("road_segments_class_idx").on(t.datasetId, t.roadClass),
    index("road_segments_nodes_idx").on(t.fromNodeId, t.toNodeId),
  ],
);

export const roadLixels = pgTable(
  "road_lixels",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    srid: integer("srid").notNull(),
    segmentId: text("segment_id").notNull(),
    /** Linear referencing: index of the lixel along its parent edge. */
    lrsIndex: integer("lrs_index").notNull(),
    mStart: doublePrecision("m_start").notNull(),
    mEnd: doublePrecision("m_end").notNull(),
    mMid: doublePrecision("m_mid").notNull(),
    lengthM: doublePrecision("length_m").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    gridKey: text("grid_key").notNull(),
    /** Nearest intersection distance (m) — primary covariate of the ground-truth intensity. */
    distToNodeM: doublePrecision("dist_to_node_m").notNull(),
    roadClass: text("road_class").notNull(),
    classOrdinal: integer("class_ordinal").notNull(),
    speedLimitKph: doublePrecision("speed_limit_kph").notNull(),
    lanes: integer("lanes").notNull(),
    aadt: integer("aadt"),
    /** Hidden ground-truth integrated intensity Λ(s) over the study window. */
    trueLambda: doublePrecision("true_lambda"),
  },
  (t) => [
    index("road_lixels_dataset_idx").on(t.datasetId),
    index("road_lixels_segment_idx").on(t.datasetId, t.segmentId),
    index("road_lixels_grid_idx").on(t.datasetId, t.gridKey),
    index("road_lixels_lrs_idx").on(t.segmentId, t.lrsIndex),
  ],
);

/* ------------------------------------------------------------------ */
/* Accidents (canonical, network-referenced incidents)                 */
/* ------------------------------------------------------------------ */

export const accidents = pgTable(
  "accidents",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    srid: integer("srid").notNull(),
    /** TRUE only for simulator ground-truth realisations (hidden λ realisations). */
    isGroundTruth: boolean("is_ground_truth").notNull().default(false),
    isSynthetic: boolean("is_synthetic").notNull().default(true),
    /** True network position of the realisation (oracle; not visible to analysts). */
    trueSegmentId: text("true_segment_id"),
    trueLixelId: text("true_lixel_id"),
    trueM: doublePrecision("true_m"),
    trueX: doublePrecision("true_x"),
    trueY: doublePrecision("true_y"),
    /** Validated, map-matched network reference. */
    segmentId: text("segment_id"),
    lixelId: text("lixel_id"),
    mOffset: doublePrecision("m_offset"),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    gridKey: text("grid_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true, mode: "date" }),
    categoryId: text("category_id"),
    severityId: text("severity_id").notNull(),
    weatherCode: text("weather_code"),
    lightingCode: text("lighting_code"),
    trafficState: text("traffic_state", { enum: ["free_flow", "dense", "congested", "queue", "unknown"] })
      .notNull()
      .default("unknown"),
    roadSurfaceState: text("road_surface_state", { enum: ["dry", "wet", "snow", "ice", "unknown"] })
      .notNull()
      .default("unknown"),
    vehicleCount: integer("vehicle_count").notNull().default(1),
    pedestrianCount: integer("pedestrian_count").notNull().default(0),
    cyclistCount: integer("cyclist_count").notNull().default(0),
    injuredCount: integer("injured_count").notNull().default(0),
    fatalityCount: integer("fatality_count").notNull().default(0),
    emergencyResponse: boolean("emergency_response").notNull().default(false),
    /** Multi-witness trust accumulated through conflation. */
    witnessCount: integer("witness_count").notNull().default(0),
    credibilityScore: doublePrecision("credibility_score"),
    status: text("status", {
      enum: ["unverified", "triaged", "verified", "rejected", "merged"],
    })
      .notNull()
      .default("unverified"),
    canonicalReportId: text("canonical_report_id"),
    narrative: text("narrative"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("accidents_dataset_idx").on(t.datasetId),
    index("accidents_occurred_idx").on(t.datasetId, t.occurredAt),
    index("accidents_grid_idx").on(t.datasetId, t.gridKey),
    index("accidents_lixel_idx").on(t.datasetId, t.lixelId),
    index("accidents_segment_idx").on(t.datasetId, t.segmentId),
    index("accidents_status_idx").on(t.datasetId, t.status),
    index("accidents_severity_idx").on(t.datasetId, t.severityId),
  ],
);

/* ------------------------------------------------------------------ */
/* VGI: raw citizen reports, verification, attachments                 */
/* ------------------------------------------------------------------ */

export const vgiReports = pgTable(
  "vgi_reports",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    srid: integer("srid").notNull(),
    contributorId: text("contributor_id"),
    accidentId: text("accident_id"),
    /** Raw observational provenance — never destroyed, even after snapping. */
    rawX: doublePrecision("raw_x").notNull(),
    rawY: doublePrecision("raw_y").notNull(),
    rawLon: doublePrecision("raw_lon"),
    rawLat: doublePrecision("raw_lat"),
    gridKey: text("grid_key").notNull(),
    /** Self-declared / device-derived positional uncertainty radius (metres). */
    positionalAccuracyM: doublePrecision("positional_accuracy_m").notNull().default(15),
    /** Simulator-injected true off-centreline drift (oracle). */
    injectedDriftM: doublePrecision("injected_drift_m"),
    isFalseAlarm: boolean("is_false_alarm").notNull().default(false),
    isDuplicateWitness: boolean("is_duplicate_witness").notNull().default(false),
    occurrenceTime: timestamp("occurrence_time", { withTimezone: true, mode: "date" }).notNull(),
    reportedTime: timestamp("reported_time", { withTimezone: true, mode: "date" }).notNull(),
    reportingLagSeconds: integer("reporting_lag_seconds").notNull().default(0),
    categoryId: text("category_id"),
    severityId: text("severity_id").notNull(),
    weatherCode: text("weather_code"),
    lightingCode: text("lighting_code"),
    trafficState: text("traffic_state"),
    vehicleCount: integer("vehicle_count").notNull().default(1),
    pedestrianCount: integer("pedestrian_count").notNull().default(0),
    injuredCount: integer("injured_count").notNull().default(0),
    fatalityCount: integer("fatality_count").notNull().default(0),
    emergencyResponse: boolean("emergency_response").notNull().default(false),
    narrative: text("narrative"),
    deviceType: text("device_type", { enum: ["mobile_app", "web_form", "in_vehicle", "api_feed"] })
      .notNull()
      .default("mobile_app"),
    /** Probabilistic map-matching output: ranked candidate snaps + score decomposition. */
    mapMatch: jsonb("map_match")
      .$type<{
        candidates: Array<{
          segmentId: string;
          lixelId: string;
          m: number;
          x: number;
          y: number;
          perpDistanceM: number;
          bearingDeltaDeg: number;
          roadClass: string;
          classPrior: number;
          topologyBonus: number;
          posterior: number;
        }>;
        chosenIndex: number;
        sigmaM: number;
        entropyNats: number;
        ambiguity: number;
      } | null>()
      .default(null),
    snappedSegmentId: text("snapped_segment_id"),
    snappedLixelId: text("snapped_lixel_id"),
    snappedM: doublePrecision("snapped_m"),
    snappedX: doublePrecision("snapped_x"),
    snappedY: doublePrecision("snapped_y"),
    snapPerpDistanceM: doublePrecision("snap_perp_distance_m"),
    snapPosterior: doublePrecision("snap_posterior"),
    /** Composite VGI credibility decomposition. */
    credibility: jsonb("credibility")
      .$type<{
        total: number;
        witnessAgreement: number;
        attributeConsistency: number;
        spatialProximity: number;
        temporalProximity: number;
        contributorReliability: number;
        reportAge: number;
      } | null>()
      .default(null),
    credibilityScore: doublePrecision("credibility_score"),
    status: text("status", {
      enum: ["unverified", "triaged", "corroborated", "verified", "rejected", "merged"],
    })
      .notNull()
      .default("unverified"),
    mergedIntoReportId: text("merged_into_report_id"),
    clusterId: text("cluster_id"),
    /** Privacy: EXIF/GPS metadata stripped before persistence. */
    mediaMetadataStripped: boolean("media_metadata_stripped").notNull().default(true),
    consentGiven: boolean("consent_given").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("vgi_reports_dataset_idx").on(t.datasetId),
    index("vgi_reports_status_idx").on(t.datasetId, t.status),
    index("vgi_reports_occurred_idx").on(t.datasetId, t.occurrenceTime),
    index("vgi_reports_grid_idx").on(t.datasetId, t.gridKey),
    index("vgi_reports_accident_idx").on(t.accidentId),
    index("vgi_reports_cluster_idx").on(t.datasetId, t.clusterId),
  ],
);

export const reportVerifications = pgTable(
  "report_verifications",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    reportId: text("report_id").notNull(),
    datasetId: text("dataset_id").notNull(),
    actorId: text("actor_id"),
    actorRole: text("actor_role").notNull().default("data_steward"),
    action: text("action", {
      enum: ["created", "map_matched", "triaged", "verified", "rejected", "flagged", "merged", "reopened", "edited"],
    }).notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    reason: text("reason"),
    confidenceDelta: doublePrecision("confidence_delta"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("report_verifications_report_idx").on(t.reportId),
    index("report_verifications_dataset_idx").on(t.datasetId),
    index("report_verifications_created_idx").on(t.createdAt),
  ],
);

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    reportId: text("report_id").notNull(),
    kind: text("kind", { enum: ["image", "video", "audio", "document"] }).notNull().default("image"),
    originalFilename: text("original_filename"),
    storedFilename: text("stored_filename"),
    mimeType: text("mime_type"),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    /** Privacy-preserving metadata stripping provenance. */
    exifStripped: boolean("exif_stripped").notNull().default(true),
    strippedFields: jsonb("stripped_fields").$type<string[]>().notNull().$defaultFn(() => []),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [index("report_attachments_report_idx").on(t.reportId)],
);

/* ------------------------------------------------------------------ */
/* Covariates: environment + traffic exposure                          */
/* ------------------------------------------------------------------ */

export const environmentalObservations = pgTable(
  "environmental_observations",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    validAt: timestamp("valid_at", { withTimezone: true, mode: "date" }).notNull(),
    stationId: text("station_id").notNull().default("SIM-01"),
    x: doublePrecision("x"),
    y: doublePrecision("y"),
    weatherCode: text("weather_code").notNull().default("clear"),
    precipitationMmPerH: doublePrecision("precipitation_mm_per_h").notNull().default(0),
    temperatureC: doublePrecision("temperature_c").notNull().default(15),
    visibilityM: doublePrecision("visibility_m").notNull().default(20000),
    windSpeedKph: doublePrecision("wind_speed_kph").notNull().default(8),
    lightingCode: text("lighting_code").notNull().default("daylight"),
    roadSurfaceState: text("road_surface_state").notNull().default("dry"),
    source: text("source").notNull().default("synthetic_meso_model"),
  },
  (t) => [
    index("env_obs_dataset_time_idx").on(t.datasetId, t.validAt),
    index("env_obs_time_idx").on(t.validAt),
  ],
);

export const trafficObservations = pgTable(
  "traffic_observations",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    segmentId: text("segment_id").notNull(),
    validAt: timestamp("valid_at", { withTimezone: true, mode: "date" }).notNull(),
    hourlyVolume: doublePrecision("hourly_volume"),
    aadt: integer("aadt"),
    meanSpeedKph: doublePrecision("mean_speed_kph"),
    occupancyPct: doublePrecision("occupancy_pct"),
    state: text("state", { enum: ["free_flow", "dense", "congested", "queue", "unknown"] })
      .notNull()
      .default("free_flow"),
    vkt: doublePrecision("vkt"),
    source: text("source").notNull().default("loop_detector"),
    isImputed: boolean("is_imputed").notNull().default(false),
  },
  (t) => [
    index("traffic_obs_dataset_time_idx").on(t.datasetId, t.validAt),
    index("traffic_obs_segment_idx").on(t.datasetId, t.segmentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Asynchronous geocomputation: jobs, results, risk                    */
/* ------------------------------------------------------------------ */

export const spatialAnalysisJobs = pgTable(
  "spatial_analysis_jobs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    method: text("method", {
      enum: [
        "nkde",
        "planar_kde",
        "nkde_planar_diff",
        "network_getis_ord",
        "network_moran",
        "n_dbscan",
        "lixel_aggregation",
        "covariate_cross_comparison",
        "eb_smoothing",
        "composite_vulnerability",
        "ground_truth_benchmark",
        "simulation",
      ],
    }).notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    /** Content hash for result caching / reproducibility. */
    cacheKey: text("cache_key").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    progress: doublePrecision("progress").notNull().default(0),
    stage: text("stage").notNull().default("queued"),
    error: text("error"),
    requestedBy: text("requested_by"),
    resultId: text("result_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("jobs_dataset_idx").on(t.datasetId),
    index("jobs_status_idx").on(t.status),
    index("jobs_cache_idx").on(t.cacheKey),
    index("jobs_created_idx").on(t.createdAt),
  ],
);

export const spatialAnalysisResults = pgTable(
  "spatial_analysis_results",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    jobId: text("job_id"),
    datasetId: text("dataset_id").notNull(),
    method: text("method").notNull(),
    /** Full parameter block — the reproducibility contract. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    srid: integer("srid").notNull(),
    crsName: text("crs_name"),
    sampleSize: integer("sample_size").notNull().default(0),
    unitCount: integer("unit_count").notNull().default(0),
    runtimeMs: integer("runtime_ms"),
    /** GeoJSON FeatureCollection in EPSG:4326 (serialisation boundary). */
    features: jsonb("features").$type<Record<string, unknown> | null>().default(null),
    /** Scalar statistics, assumption checks, diagnostics. */
    stats: jsonb("stats").$type<Record<string, unknown> | null>().default(null),
    /** Ground-truth comparison metrics (PAI / RRI / RMSE / Spearman). */
    benchmark: jsonb("benchmark").$type<Record<string, unknown> | null>().default(null),
    /** LaTeX-grade mathematical explanation rendered in the UI. */
    formulation: jsonb("formulation").$type<{ title: string; latex: string; notes: string[] } | null>()
      .default(null),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("results_dataset_method_idx").on(t.datasetId, t.method),
    index("results_created_idx").on(t.createdAt),
  ],
);

export const riskEstimates = pgTable(
  "risk_estimates",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    datasetId: text("dataset_id").notNull(),
    level: text("level", { enum: ["lixel", "segment"] }).notNull(),
    unitId: text("unit_id").notNull(),
    segmentId: text("segment_id").notNull(),
    srid: integer("srid").notNull(),
    x: doublePrecision("x").notNull(),
    y: doublePrecision("y").notNull(),
    gridKey: text("grid_key").notNull(),
    lengthKm: doublePrecision("length_km").notNull(),
    roadClass: text("road_class").notNull(),
    /** Tier 1 — raw crash frequency N. */
    crashCount: doublePrecision("crash_count").notNull().default(0),
    /** Tier 2 — linear crash density N / L_km. */
    crashDensityPerKm: doublePrecision("crash_density_per_km").notNull().default(0),
    /** Tier 3 — severity-weighted EPDO index. */
    epdo: doublePrecision("epdo").notNull().default(0),
    epdoPerKm: doublePrecision("epdo_per_km").notNull().default(0),
    /** Tier 4 — exposure-normalised rate (crashes / MVKT). NULL when AADT missing. */
    exposureVkt: doublePrecision("exposure_vkt"),
    crashRatePerMvkt: doublePrecision("crash_rate_per_mvkt"),
    hasExposure: boolean("has_exposure").notNull().default(false),
    /** Empirical Bayes block. */
    spfExpected: doublePrecision("spf_expected"),
    overdispersionPhi: doublePrecision("overdispersion_phi"),
    ebWeight: doublePrecision("eb_weight"),
    ebEstimate: doublePrecision("eb_estimate"),
    ebLower95: doublePrecision("eb_lower95"),
    ebUpper95: doublePrecision("eb_upper95"),
    /** Potential for Safety Improvement / excess crash frequency. */
    psi: doublePrecision("psi"),
    excessCrashes: doublePrecision("excess_crashes"),
    /** Multi-criteria composite (heuristic — never a calibrated probability). */
    compositeScore: doublePrecision("composite_score"),
    compositeRank: integer("composite_rank"),
    compositeWeights: jsonb("composite_weights").$type<Record<string, number> | null>().default(null),
    /** Epistemic + aleatoric uncertainty in [0,1]; 1 ⇒ maximally uncertain. */
    uncertainty: doublePrecision("uncertainty"),
    uncertaintyComponents: jsonb("uncertainty_components")
      .$type<{ sampleSparsity: number; exposureGap: number; vgiRatio: number; positionalDrift: number } | null>()
      .default(null),
    /** Oracle ground-truth intensity for benchmarking (synthetic datasets only). */
    trueLambda: doublePrecision("true_lambda"),
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("risk_unit_key").on(t.datasetId, t.level, t.unitId),
    index("risk_dataset_idx").on(t.datasetId),
    index("risk_grid_idx").on(t.datasetId, t.gridKey),
    index("risk_composite_idx").on(t.datasetId, t.compositeScore),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey().$defaultFn(uuid),
    actorId: text("actor_id"),
    actorRole: text("actor_role").notNull().default("anonymous"),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    datasetId: text("dataset_id"),
    before: jsonb("before").$type<Record<string, unknown> | null>().default(null),
    after: jsonb("after").$type<Record<string, unknown> | null>().default(null),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    severity: text("severity", { enum: ["info", "notice", "warning", "critical"] })
      .notNull()
      .default("info"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().$defaultFn(now),
  },
  (t) => [
    index("audit_entity_idx").on(t.entity, t.entityId),
    index("audit_created_idx").on(t.createdAt),
    index("audit_actor_idx").on(t.actorId),
  ],
);

export type DatasetSource = typeof datasetSources.$inferSelect;
export type RoadSegment = typeof roadSegments.$inferSelect;
export type RoadLixel = typeof roadLixels.$inferSelect;
export type RoadNode = typeof roadNodes.$inferSelect;
export type Accident = typeof accidents.$inferSelect;
export type VgiReport = typeof vgiReports.$inferSelect;
export type RiskEstimate = typeof riskEstimates.$inferSelect;
export type SpatialAnalysisJob = typeof spatialAnalysisJobs.$inferSelect;
export type SpatialAnalysisResult = typeof spatialAnalysisResults.$inferSelect;
