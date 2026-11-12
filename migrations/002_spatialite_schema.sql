-- =============================================================================
-- Urban Accident Intelligence (UAI) — Embedded SpatiaLite / SQLite R*Tree Schema
-- Canonical Projected Metric CRS: EPSG:25832 (ETRS89 / UTM Zone 32N, meters)
-- Web Serialization CRS: EPSG:4326 (WGS84 Geographic)
-- Spatial Indexing: SQLite R*Tree Virtual Tables + Trigger Synchronization
-- Temporal Indexing: UTC ISO-8601 B-Tree Indexes
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN (
        'simulation_scientist', 'citizen_reporter', 'data_steward',
        'gis_researcher', 'safety_engineer', 'mobility_analyst'
    )),
    trust_weight REAL NOT NULL DEFAULT 0.75 CHECK (trust_weight BETWEEN 0.05 AND 1.0),
    created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scenario_key TEXT NOT NULL,
    is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0, 1)),
    crs_epsg INTEGER NOT NULL DEFAULT 25832 CHECK (crs_epsg = 25832),
    lixel_resolution_m REAL NOT NULL DEFAULT 25.0 CHECK (lixel_resolution_m > 0),
    study_period_years REAL NOT NULL DEFAULT 1.0 CHECK (study_period_years > 0),
    random_seed INTEGER NOT NULL DEFAULT 42,
    generator_params_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS road_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    node_code TEXT NOT NULL,
    node_type TEXT NOT NULL,
    degree INTEGER NOT NULL DEFAULT 0,
    elevation_level INTEGER NOT NULL DEFAULT 0,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    x_m REAL NOT NULL,
    y_m REAL NOT NULL,
    lon REAL NOT NULL,
    lat REAL NOT NULL,
    wkt_25832 TEXT NOT NULL,
    UNIQUE (dataset_id, node_code)
);
CREATE INDEX IF NOT EXISTS idx_road_nodes_dataset ON road_nodes (dataset_id);

CREATE VIRTUAL TABLE IF NOT EXISTS rtree_road_nodes USING rtree(
    id, min_x, max_x, min_y, max_y
);

CREATE TRIGGER IF NOT EXISTS trg_road_nodes_rtree_ins AFTER INSERT ON road_nodes BEGIN
    INSERT INTO rtree_road_nodes(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.x_m, NEW.x_m, NEW.y_m, NEW.y_m);
END;
CREATE TRIGGER IF NOT EXISTS trg_road_nodes_rtree_del AFTER DELETE ON road_nodes BEGIN
    DELETE FROM rtree_road_nodes WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS road_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    edge_code TEXT NOT NULL,
    name TEXT NOT NULL,
    u_node_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
    v_node_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
    is_directed INTEGER NOT NULL DEFAULT 0,
    road_class TEXT NOT NULL,
    speed_limit_kmh INTEGER NOT NULL CHECK (speed_limit_kmh BETWEEN 10 AND 160),
    lanes INTEGER NOT NULL CHECK (lanes BETWEEN 1 AND 8),
    length_m REAL NOT NULL CHECK (length_m > 0),
    sinuosity REAL NOT NULL DEFAULT 1.0 CHECK (sinuosity >= 0.999),
    slope_pct REAL NOT NULL DEFAULT 0.0,
    elevation_level INTEGER NOT NULL DEFAULT 0,
    aadt INTEGER,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    wkt_25832 TEXT NOT NULL,
    geojson_4326 TEXT NOT NULL,
    UNIQUE (dataset_id, edge_code)
);
CREATE INDEX IF NOT EXISTS idx_road_segments_dataset_class ON road_segments (dataset_id, road_class);

CREATE VIRTUAL TABLE IF NOT EXISTS rtree_road_segments USING rtree(
    id, min_x, max_x, min_y, max_y
);

CREATE TRIGGER IF NOT EXISTS trg_road_segments_rtree_ins AFTER INSERT ON road_segments BEGIN
    INSERT INTO rtree_road_segments(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.min_x, NEW.max_x, NEW.min_y, NEW.max_y);
END;
CREATE TRIGGER IF NOT EXISTS trg_road_segments_rtree_del AFTER DELETE ON road_segments BEGIN
    DELETE FROM rtree_road_segments WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS road_lixels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    parent_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    lixel_index INTEGER NOT NULL,
    m_start_m REAL NOT NULL CHECK (m_start_m >= 0),
    m_end_m REAL NOT NULL,
    length_m REAL NOT NULL CHECK (length_m > 0),
    midpoint_m REAL NOT NULL,
    dist_to_nearest_junction_m REAL NOT NULL DEFAULT 0,
    true_lambda_per_km_yr REAL NOT NULL DEFAULT 0,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    mid_x_m REAL NOT NULL,
    mid_y_m REAL NOT NULL,
    mid_lon REAL NOT NULL,
    mid_lat REAL NOT NULL,
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    wkt_25832 TEXT NOT NULL,
    geojson_4326 TEXT NOT NULL,
    UNIQUE (parent_segment_id, lixel_index)
);
CREATE INDEX IF NOT EXISTS idx_road_lixels_dataset ON road_lixels (dataset_id, parent_segment_id);

CREATE VIRTUAL TABLE IF NOT EXISTS rtree_road_lixels USING rtree(
    id, min_x, max_x, min_y, max_y
);

CREATE TRIGGER IF NOT EXISTS trg_road_lixels_rtree_ins AFTER INSERT ON road_lixels BEGIN
    INSERT INTO rtree_road_lixels(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.min_x, NEW.max_x, NEW.min_y, NEW.max_y);
END;
CREATE TRIGGER IF NOT EXISTS trg_road_lixels_rtree_del AFTER DELETE ON road_lixels BEGIN
    DELETE FROM rtree_road_lixels WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS accident_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    compatible_road_classes_json TEXT NOT NULL,
    typical_speed_min_kmh INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS severity_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    rank INTEGER NOT NULL UNIQUE,
    label TEXT NOT NULL,
    epdo_weight REAL NOT NULL CHECK (epdo_weight > 0),
    color_hex TEXT NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    canonical_parent_id INTEGER REFERENCES accidents(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK (source_type IN (
        'ground_truth_realization', 'synthetic_vgi', 'citizen_vgi'
    )),
    verification_status TEXT NOT NULL CHECK (verification_status IN (
        'unverified_raw_vgi', 'corroborated_pending', 'verified_canonical',
        'merged_duplicate', 'rejected_false_alarm', 'flagged_review'
    )),
    reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category_id INTEGER NOT NULL REFERENCES accident_categories(id),
    severity_id INTEGER NOT NULL REFERENCES severity_levels(id),
    occurred_at_utc TEXT NOT NULL,
    reported_at_utc TEXT NOT NULL,
    reporting_lag_min REAL NOT NULL DEFAULT 0,
    involved_vehicles INTEGER NOT NULL DEFAULT 1 CHECK (involved_vehicles >= 0),
    involved_pedestrians INTEGER NOT NULL DEFAULT 0 CHECK (involved_pedestrians >= 0),
    involved_cyclists INTEGER NOT NULL DEFAULT 0 CHECK (involved_cyclists >= 0),
    emergency_response_present INTEGER NOT NULL DEFAULT 0 CHECK (emergency_response_present IN (0, 1)),
    narrative TEXT NOT NULL DEFAULT '',
    observational_radius_m REAL NOT NULL DEFAULT 15.0 CHECK (observational_radius_m > 0),
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    raw_x_m REAL NOT NULL,
    raw_y_m REAL NOT NULL,
    raw_lon REAL NOT NULL,
    raw_lat REAL NOT NULL,
    raw_wkt_25832 TEXT NOT NULL,
    snapped_x_m REAL,
    snapped_y_m REAL,
    snapped_lon REAL,
    snapped_lat REAL,
    snapped_wkt_25832 TEXT,
    snapped_segment_id INTEGER REFERENCES road_segments(id) ON DELETE SET NULL,
    snapped_lixel_id INTEGER REFERENCES road_lixels(id) ON DELETE SET NULL,
    linear_offset_m REAL,
    orthogonal_snap_dist_m REAL,
    snap_probability REAL,
    snap_candidates_json TEXT NOT NULL DEFAULT '[]',
    vgi_credibility_score REAL NOT NULL DEFAULT 0.5 CHECK (vgi_credibility_score BETWEEN 0.0 AND 1.0),
    witness_count INTEGER NOT NULL DEFAULT 1 CHECK (witness_count >= 1),
    is_false_alarm_gt INTEGER NOT NULL DEFAULT 0 CHECK (is_false_alarm_gt IN (0, 1)),
    gt_source_event_uid TEXT,
    created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accidents_occurred_btree ON accidents (dataset_id, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_accidents_reported_btree ON accidents (dataset_id, reported_at_utc);
CREATE INDEX IF NOT EXISTS idx_accidents_status ON accidents (dataset_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_accidents_segment ON accidents (dataset_id, snapped_segment_id);
CREATE INDEX IF NOT EXISTS idx_accidents_lixel ON accidents (dataset_id, snapped_lixel_id);

CREATE VIRTUAL TABLE IF NOT EXISTS rtree_accidents_raw USING rtree(
    id, min_x, max_x, min_y, max_y
);
CREATE VIRTUAL TABLE IF NOT EXISTS rtree_accidents_snapped USING rtree(
    id, min_x, max_x, min_y, max_y
);

CREATE TRIGGER IF NOT EXISTS trg_accidents_rtree_ins AFTER INSERT ON accidents BEGIN
    INSERT INTO rtree_accidents_raw(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.raw_x_m, NEW.raw_x_m, NEW.raw_y_m, NEW.raw_y_m);
    INSERT INTO rtree_accidents_snapped(id, min_x, max_x, min_y, max_y)
    SELECT NEW.id, NEW.snapped_x_m, NEW.snapped_x_m, NEW.snapped_y_m, NEW.snapped_y_m
    WHERE NEW.snapped_x_m IS NOT NULL AND NEW.snapped_y_m IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_accidents_rtree_upd AFTER UPDATE ON accidents BEGIN
    DELETE FROM rtree_accidents_raw WHERE id = OLD.id;
    INSERT INTO rtree_accidents_raw(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.raw_x_m, NEW.raw_x_m, NEW.raw_y_m, NEW.raw_y_m);
    DELETE FROM rtree_accidents_snapped WHERE id = OLD.id;
    INSERT INTO rtree_accidents_snapped(id, min_x, max_x, min_y, max_y)
    SELECT NEW.id, NEW.snapped_x_m, NEW.snapped_x_m, NEW.snapped_y_m, NEW.snapped_y_m
    WHERE NEW.snapped_x_m IS NOT NULL AND NEW.snapped_y_m IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_accidents_rtree_del AFTER DELETE ON accidents BEGIN
    DELETE FROM rtree_accidents_raw WHERE id = OLD.id;
    DELETE FROM rtree_accidents_snapped WHERE id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS report_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    steward_user_id INTEGER NOT NULL REFERENCES users(id),
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    override_segment_id INTEGER REFERENCES road_segments(id),
    override_offset_m REAL,
    review_notes TEXT NOT NULL DEFAULT '',
    verified_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_verif_accident ON report_verifications (accident_id, verified_at_utc DESC);

CREATE TABLE IF NOT EXISTS report_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    exif_stripped INTEGER NOT NULL DEFAULT 1 CHECK (exif_stripped = 1),
    sha256_hash TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    uploaded_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environmental_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER REFERENCES accidents(id) ON DELETE CASCADE,
    segment_id INTEGER REFERENCES road_segments(id) ON DELETE CASCADE,
    observed_at_utc TEXT NOT NULL,
    weather_condition TEXT NOT NULL,
    road_surface TEXT NOT NULL,
    lighting_condition TEXT NOT NULL,
    visibility_m REAL NOT NULL DEFAULT 1000.0,
    precipitation_mm_hr REAL NOT NULL DEFAULT 0.0,
    temperature_c REAL NOT NULL DEFAULT 14.0
);
CREATE INDEX IF NOT EXISTS idx_env_obs_accident ON environmental_observations (accident_id);
CREATE INDEX IF NOT EXISTS idx_env_obs_time ON environmental_observations (observed_at_utc);

CREATE TABLE IF NOT EXISTS traffic_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    observation_period TEXT NOT NULL,
    aadt_vehicles_per_day INTEGER NOT NULL CHECK (aadt_vehicles_per_day > 0),
    peak_hour_volume INTEGER NOT NULL,
    avg_speed_kmh REAL NOT NULL,
    heavy_vehicle_pct REAL NOT NULL,
    exposure_mvkt_annual REAL NOT NULL,
    coverage_confidence REAL NOT NULL CHECK (coverage_confidence BETWEEN 0.0 AND 1.0),
    is_imputed INTEGER NOT NULL DEFAULT 0 CHECK (is_imputed IN (0, 1)),
    observed_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_obs_segment ON traffic_observations (dataset_id, segment_id);

CREATE TABLE IF NOT EXISTS spatial_analysis_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    parameters_json TEXT NOT NULL,
    crs_epsg INTEGER NOT NULL DEFAULT 25832,
    sample_size INTEGER NOT NULL DEFAULT 0,
    runtime_ms REAL NOT NULL DEFAULT 0,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at_utc TEXT NOT NULL,
    completed_at_utc TEXT,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_dataset ON spatial_analysis_jobs (dataset_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS spatial_analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER UNIQUE NOT NULL REFERENCES spatial_analysis_jobs(id) ON DELETE CASCADE,
    summary_metrics_json TEXT NOT NULL,
    ground_truth_eval_json TEXT,
    mathematical_notes_json TEXT NOT NULL,
    layer_geojson_text TEXT NOT NULL,
    tabular_results_json TEXT NOT NULL,
    created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    actor_role TEXT NOT NULL,
    action_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    before_state_json TEXT,
    after_state_json TEXT,
    ip_hash TEXT NOT NULL DEFAULT 'local-session',
    created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs (created_at_utc DESC);
