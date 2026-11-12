-- =============================================================================
-- Urban Accident Intelligence (UAI) — Canonical PostGIS Relational-Spatial Schema
-- Target Engine: PostgreSQL 16+ with PostGIS 3.4+
-- Canonical Projected Metric CRS: EPSG:25832 (ETRS89 / UTM Zone 32N, meters)
-- Web Serialization CRS: EPSG:4326 (WGS84 Geographic)
-- All timestamps stored strictly in UTC (TIMESTAMPTZ)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(128) NOT NULL,
    role VARCHAR(40) NOT NULL CHECK (role IN (
        'simulation_scientist', 'citizen_reporter', 'data_steward',
        'gis_researcher', 'safety_engineer', 'mobility_analyst'
    )),
    trust_weight DOUBLE PRECISION NOT NULL DEFAULT 0.75 CHECK (trust_weight BETWEEN 0.05 AND 1.0),
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS dataset_sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    scenario_key VARCHAR(64) NOT NULL,
    is_synthetic BOOLEAN NOT NULL DEFAULT TRUE,
    crs_epsg INTEGER NOT NULL DEFAULT 25832 CHECK (crs_epsg = 25832),
    lixel_resolution_m DOUBLE PRECISION NOT NULL DEFAULT 25.0 CHECK (lixel_resolution_m > 0),
    study_period_years DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (study_period_years > 0),
    random_seed INTEGER NOT NULL DEFAULT 42,
    generator_params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    description TEXT NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS road_nodes (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    node_code VARCHAR(32) NOT NULL,
    node_type VARCHAR(48) NOT NULL,
    degree INTEGER NOT NULL DEFAULT 0,
    elevation_level INTEGER NOT NULL DEFAULT 0,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    x_m DOUBLE PRECISION NOT NULL,
    y_m DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    geom_25832 GEOMETRY(Point, 25832) NOT NULL,
    UNIQUE (dataset_id, node_code)
);
CREATE INDEX IF NOT EXISTS idx_road_nodes_geom ON road_nodes USING GIST (geom_25832);
CREATE INDEX IF NOT EXISTS idx_road_nodes_dataset ON road_nodes (dataset_id);

CREATE TABLE IF NOT EXISTS road_segments (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    edge_code VARCHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    u_node_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
    v_node_id INTEGER NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
    is_directed BOOLEAN NOT NULL DEFAULT FALSE,
    road_class VARCHAR(40) NOT NULL,
    speed_limit_kmh INTEGER NOT NULL CHECK (speed_limit_kmh BETWEEN 10 AND 160),
    lanes INTEGER NOT NULL CHECK (lanes BETWEEN 1 AND 8),
    length_m DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    sinuosity DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (sinuosity >= 1.0),
    slope_pct DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    elevation_level INTEGER NOT NULL DEFAULT 0,
    aadt INTEGER,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    geom_25832 GEOMETRY(LineString, 25832) NOT NULL,
    UNIQUE (dataset_id, edge_code)
);
CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON road_segments USING GIST (geom_25832);
CREATE INDEX IF NOT EXISTS idx_road_segments_dataset_class ON road_segments (dataset_id, road_class);

CREATE TABLE IF NOT EXISTS road_lixels (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    parent_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    lixel_index INTEGER NOT NULL,
    m_start_m DOUBLE PRECISION NOT NULL CHECK (m_start_m >= 0),
    m_end_m DOUBLE PRECISION NOT NULL,
    length_m DOUBLE PRECISION NOT NULL CHECK (length_m > 0),
    midpoint_m DOUBLE PRECISION NOT NULL,
    dist_to_nearest_junction_m DOUBLE PRECISION NOT NULL DEFAULT 0,
    true_lambda_per_km_yr DOUBLE PRECISION NOT NULL DEFAULT 0,
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    mid_x_m DOUBLE PRECISION NOT NULL,
    mid_y_m DOUBLE PRECISION NOT NULL,
    mid_lon DOUBLE PRECISION NOT NULL,
    mid_lat DOUBLE PRECISION NOT NULL,
    geom_25832 GEOMETRY(LineString, 25832) NOT NULL,
    UNIQUE (parent_segment_id, lixel_index)
);
CREATE INDEX IF NOT EXISTS idx_road_lixels_geom ON road_lixels USING GIST (geom_25832);
CREATE INDEX IF NOT EXISTS idx_road_lixels_dataset ON road_lixels (dataset_id, parent_segment_id);

CREATE TABLE IF NOT EXISTS accident_categories (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    label VARCHAR(96) NOT NULL,
    compatible_road_classes_json JSONB NOT NULL,
    typical_speed_min_kmh INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS severity_levels (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE NOT NULL,
    rank INTEGER NOT NULL UNIQUE,
    label VARCHAR(64) NOT NULL,
    epdo_weight DOUBLE PRECISION NOT NULL CHECK (epdo_weight > 0),
    color_hex VARCHAR(16) NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accidents (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    canonical_parent_id INTEGER REFERENCES accidents(id) ON DELETE SET NULL,
    source_type VARCHAR(36) NOT NULL CHECK (source_type IN (
        'ground_truth_realization', 'synthetic_vgi', 'citizen_vgi'
    )),
    verification_status VARCHAR(36) NOT NULL CHECK (verification_status IN (
        'unverified_raw_vgi', 'corroborated_pending', 'verified_canonical',
        'merged_duplicate', 'rejected_false_alarm', 'flagged_review'
    )),
    reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category_id INTEGER NOT NULL REFERENCES accident_categories(id),
    severity_id INTEGER NOT NULL REFERENCES severity_levels(id),
    occurred_at_utc TIMESTAMPTZ NOT NULL,
    reported_at_utc TIMESTAMPTZ NOT NULL,
    reporting_lag_min DOUBLE PRECISION NOT NULL DEFAULT 0,
    involved_vehicles INTEGER NOT NULL DEFAULT 1 CHECK (involved_vehicles >= 0),
    involved_pedestrians INTEGER NOT NULL DEFAULT 0 CHECK (involved_pedestrians >= 0),
    involved_cyclists INTEGER NOT NULL DEFAULT 0 CHECK (involved_cyclists >= 0),
    emergency_response_present BOOLEAN NOT NULL DEFAULT FALSE,
    narrative TEXT NOT NULL DEFAULT '',
    observational_radius_m DOUBLE PRECISION NOT NULL DEFAULT 15.0 CHECK (observational_radius_m > 0),
    srid INTEGER NOT NULL DEFAULT 25832 CHECK (srid = 25832),
    raw_geom_25832 GEOMETRY(Point, 25832) NOT NULL,
    snapped_geom_25832 GEOMETRY(Point, 25832),
    snapped_segment_id INTEGER REFERENCES road_segments(id) ON DELETE SET NULL,
    snapped_lixel_id INTEGER REFERENCES road_lixels(id) ON DELETE SET NULL,
    linear_offset_m DOUBLE PRECISION,
    orthogonal_snap_dist_m DOUBLE PRECISION,
    snap_probability DOUBLE PRECISION,
    snap_candidates_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    vgi_credibility_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (vgi_credibility_score BETWEEN 0.0 AND 1.0),
    witness_count INTEGER NOT NULL DEFAULT 1 CHECK (witness_count >= 1),
    is_false_alarm_gt BOOLEAN NOT NULL DEFAULT FALSE,
    gt_source_event_uid VARCHAR(64),
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_accidents_raw_geom ON accidents USING GIST (raw_geom_25832);
CREATE INDEX IF NOT EXISTS idx_accidents_snapped_geom ON accidents USING GIST (snapped_geom_25832);
CREATE INDEX IF NOT EXISTS idx_accidents_occurred_brin ON accidents USING BRIN (occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_accidents_occurred_btree ON accidents (dataset_id, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_accidents_status ON accidents (dataset_id, verification_status);

CREATE TABLE IF NOT EXISTS report_verifications (
    id SERIAL PRIMARY KEY,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    steward_user_id INTEGER NOT NULL REFERENCES users(id),
    previous_status VARCHAR(36) NOT NULL,
    new_status VARCHAR(36) NOT NULL,
    override_segment_id INTEGER REFERENCES road_segments(id),
    override_offset_m DOUBLE PRECISION,
    review_notes TEXT NOT NULL DEFAULT '',
    verified_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS report_attachments (
    id SERIAL PRIMARY KEY,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(80) NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    exif_stripped BOOLEAN NOT NULL DEFAULT TRUE,
    sha256_hash VARCHAR(64) NOT NULL,
    caption VARCHAR(255) NOT NULL DEFAULT '',
    uploaded_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS environmental_observations (
    id SERIAL PRIMARY KEY,
    accident_id INTEGER REFERENCES accidents(id) ON DELETE CASCADE,
    segment_id INTEGER REFERENCES road_segments(id) ON DELETE CASCADE,
    observed_at_utc TIMESTAMPTZ NOT NULL,
    weather_condition VARCHAR(32) NOT NULL,
    road_surface VARCHAR(32) NOT NULL,
    lighting_condition VARCHAR(32) NOT NULL,
    visibility_m DOUBLE PRECISION NOT NULL DEFAULT 1000.0,
    precipitation_mm_hr DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    temperature_c DOUBLE PRECISION NOT NULL DEFAULT 14.0
);
CREATE INDEX IF NOT EXISTS idx_env_obs_accident ON environmental_observations (accident_id);
CREATE INDEX IF NOT EXISTS idx_env_obs_time ON environmental_observations (observed_at_utc);

CREATE TABLE IF NOT EXISTS traffic_observations (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    observation_period VARCHAR(64) NOT NULL,
    aadt_vehicles_per_day INTEGER NOT NULL CHECK (aadt_vehicles_per_day > 0),
    peak_hour_volume INTEGER NOT NULL,
    avg_speed_kmh DOUBLE PRECISION NOT NULL,
    heavy_vehicle_pct DOUBLE PRECISION NOT NULL,
    exposure_mvkt_annual DOUBLE PRECISION NOT NULL,
    coverage_confidence DOUBLE PRECISION NOT NULL CHECK (coverage_confidence BETWEEN 0.0 AND 1.0),
    is_imputed BOOLEAN NOT NULL DEFAULT FALSE,
    observed_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_traffic_obs_segment ON traffic_observations (dataset_id, segment_id);

CREATE TABLE IF NOT EXISTS spatial_analysis_jobs (
    id SERIAL PRIMARY KEY,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    job_type VARCHAR(48) NOT NULL,
    status VARCHAR(24) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    parameters_json JSONB NOT NULL,
    crs_epsg INTEGER NOT NULL DEFAULT 25832,
    sample_size INTEGER NOT NULL DEFAULT 0,
    runtime_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    completed_at_utc TIMESTAMPTZ,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_dataset ON spatial_analysis_jobs (dataset_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS spatial_analysis_results (
    id SERIAL PRIMARY KEY,
    job_id INTEGER UNIQUE NOT NULL REFERENCES spatial_analysis_jobs(id) ON DELETE CASCADE,
    summary_metrics_json JSONB NOT NULL,
    ground_truth_eval_json JSONB,
    mathematical_notes_json JSONB NOT NULL,
    layer_geojson_text TEXT NOT NULL,
    tabular_results_json JSONB NOT NULL,
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor_user_id INTEGER REFERENCES users(id),
    actor_role VARCHAR(40) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    entity_type VARCHAR(48) NOT NULL,
    entity_id INTEGER,
    before_state_json JSONB,
    after_state_json JSONB,
    ip_hash VARCHAR(64) NOT NULL DEFAULT 'local-session',
    created_at_utc TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs (created_at_utc DESC);
