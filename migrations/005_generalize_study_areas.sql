-- RoadScope 005: study areas as data + CRS-agnostic ingestion.
--
-- This migration replaces the former EPSG:25832-only contract:
--   1. A dataset may declare any *projected metric* CRS (default 3857, Web Mercator, valid
--      worldwide) instead of failing a hard-coded CHECK (srid = 25832).
--   2. Study areas live in the `study_areas` table (key, metric CRS, centre, optional boundary).
--      A boundary is optional metadata used for UI framing and provenance counts. Ingestion is
--      never rejected because a coordinate lies outside a boundary.
--   3. Legacy metric WKT columns are rebuilt with the CRS-neutral name `wkt_m`; values are copied
--      verbatim so existing EPSG:25832 geometry keeps exactly the same meaning.
--   4. SQLite cannot drop a CHECK constraint or rename a column in place, therefore the six
--      affected tables are rebuilt inside one transaction while foreign keys are deferred by
--      the migration runner (see backend/app/migrations.py).
-- @foreign-keys-off
-- @rebuild-tables-off
CREATE TABLE study_areas (
    key TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_fa TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT '',
    canonical_epsg INTEGER NOT NULL CHECK (canonical_epsg > 0),
    center_lon REAL NOT NULL,
    center_lat REAL NOT NULL,
    boundary_geometry_json TEXT,
    network_source TEXT NOT NULL DEFAULT 'imported',
    is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    provenance TEXT NOT NULL DEFAULT 'builtin',
    created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO study_areas
    (key, name_en, name_fa, country_code, canonical_epsg, center_lon, center_lat,
     boundary_geometry_json, network_source, is_demo, provenance)
VALUES
    ('tehran', 'Tehran', 'تهران', 'IR', 3857, 51.3890, 35.6892,
     '{"type":"bbox","bbox":[51.05,35.52,51.62,35.86]}', 'seeded_demo', 1, 'builtin')
;


ALTER TABLE road_lixels RENAME TO road_lixels__legacy;

CREATE TABLE road_lixels (
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
    srid INTEGER NOT NULL DEFAULT 3857 CHECK (srid > 0),
    mid_x_m REAL NOT NULL,
    mid_y_m REAL NOT NULL,
    mid_lon REAL NOT NULL,
    mid_lat REAL NOT NULL,
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    wkt_m TEXT NOT NULL,
    geojson_4326 TEXT NOT NULL,
    UNIQUE (parent_segment_id, lixel_index)
);

INSERT INTO road_lixels (id, dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m, midpoint_m, dist_to_nearest_junction_m, true_lambda_per_km_yr, srid, mid_x_m, mid_y_m, mid_lon, mid_lat, min_x, max_x, min_y, max_y, wkt_m, geojson_4326)
SELECT id, dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m, midpoint_m, dist_to_nearest_junction_m, true_lambda_per_km_yr, srid, mid_x_m, mid_y_m, mid_lon, mid_lat, min_x, max_x, min_y, max_y, wkt_25832, geojson_4326 FROM road_lixels__legacy;

DROP TABLE road_lixels__legacy;


ALTER TABLE accidents RENAME TO accidents__legacy;

CREATE TABLE accidents (
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
    srid INTEGER NOT NULL DEFAULT 3857 CHECK (srid > 0),
    raw_x_m REAL NOT NULL,
    raw_y_m REAL NOT NULL,
    raw_lon REAL NOT NULL,
    raw_lat REAL NOT NULL,
    snapped_x_m REAL,
    snapped_y_m REAL,
    snapped_lon REAL,
    snapped_lat REAL,
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
    created_at_utc TEXT NOT NULL,
    geocode_source TEXT NOT NULL DEFAULT 'map_click',
    reported_from_country_code TEXT NOT NULL DEFAULT ''
);

INSERT INTO accidents (id, dataset_id, canonical_parent_id, source_type, verification_status, reporter_user_id, category_id, severity_id, occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians, involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid, raw_x_m, raw_y_m, raw_lon, raw_lat, snapped_x_m, snapped_y_m, snapped_lon, snapped_lat, snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m, snap_probability, snap_candidates_json, vgi_credibility_score, witness_count, is_false_alarm_gt, gt_source_event_uid, created_at_utc)
SELECT id, dataset_id, canonical_parent_id, source_type, verification_status, reporter_user_id, category_id, severity_id, occurred_at_utc, reported_at_utc, reporting_lag_min, involved_vehicles, involved_pedestrians, involved_cyclists, emergency_response_present, narrative, observational_radius_m, srid, raw_x_m, raw_y_m, raw_lon, raw_lat, snapped_x_m, snapped_y_m, snapped_lon, snapped_lat, snapped_segment_id, snapped_lixel_id, linear_offset_m, orthogonal_snap_dist_m, snap_probability, snap_candidates_json, vgi_credibility_score, witness_count, is_false_alarm_gt, gt_source_event_uid, created_at_utc FROM accidents__legacy;

DROP TABLE accidents__legacy;


ALTER TABLE report_verifications RENAME TO report_verifications__legacy;

CREATE TABLE report_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    steward_user_id INTEGER NOT NULL REFERENCES users(id),
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    override_from_status TEXT,
    override_segment_id INTEGER REFERENCES road_segments(id),
    override_offset_m REAL,
    review_notes TEXT NOT NULL DEFAULT '',
    verified_at_utc TEXT NOT NULL
);

INSERT INTO report_verifications (id, accident_id, steward_user_id, previous_status, new_status, override_segment_id, override_offset_m, review_notes, verified_at_utc)
SELECT id, accident_id, steward_user_id, previous_status, new_status, override_segment_id, override_offset_m, review_notes, verified_at_utc FROM report_verifications__legacy;

DROP TABLE report_verifications__legacy;


ALTER TABLE road_segments RENAME TO road_segments__legacy;

CREATE TABLE road_segments (
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
    srid INTEGER NOT NULL DEFAULT 3857 CHECK (srid > 0),
    min_x REAL NOT NULL,
    max_x REAL NOT NULL,
    min_y REAL NOT NULL,
    max_y REAL NOT NULL,
    wkt_m TEXT NOT NULL,
    geojson_4326 TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'imported',
    UNIQUE (dataset_id, edge_code)
);

INSERT INTO road_segments (id, dataset_id, edge_code, name, u_node_id, v_node_id, is_directed, road_class, speed_limit_kmh, lanes, length_m, sinuosity, slope_pct, elevation_level, aadt, srid, min_x, max_x, min_y, max_y, wkt_m, geojson_4326)
SELECT id, dataset_id, edge_code, name, u_node_id, v_node_id, is_directed, road_class, speed_limit_kmh, lanes, length_m, sinuosity, slope_pct, elevation_level, aadt, srid, min_x, max_x, min_y, max_y, wkt_25832, geojson_4326 FROM road_segments__legacy;

DROP TABLE road_segments__legacy;


ALTER TABLE road_nodes RENAME TO road_nodes__legacy;

CREATE TABLE road_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    node_code TEXT NOT NULL,
    node_type TEXT NOT NULL,
    degree INTEGER NOT NULL DEFAULT 0,
    elevation_level INTEGER NOT NULL DEFAULT 0,
    srid INTEGER NOT NULL DEFAULT 3857 CHECK (srid > 0),
    x_m REAL NOT NULL,
    y_m REAL NOT NULL,
    lon REAL NOT NULL,
    lat REAL NOT NULL,
    wkt_m TEXT NOT NULL,
    UNIQUE (dataset_id, node_code)
);

INSERT INTO road_nodes (id, dataset_id, node_code, node_type, degree, elevation_level, srid, x_m, y_m, lon, lat, wkt_m)
SELECT id, dataset_id, node_code, node_type, degree, elevation_level, srid, x_m, y_m, lon, lat, wkt_25832 FROM road_nodes__legacy;

DROP TABLE road_nodes__legacy;


ALTER TABLE dataset_sources RENAME TO dataset_sources__legacy;

CREATE TABLE dataset_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    scenario_key TEXT NOT NULL,
    is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK (is_synthetic IN (0, 1)),
    crs_epsg INTEGER NOT NULL DEFAULT 3857 CHECK (crs_epsg > 0),
    lixel_resolution_m REAL NOT NULL DEFAULT 25.0 CHECK (lixel_resolution_m > 0),
    study_period_years REAL NOT NULL DEFAULT 1.0 CHECK (study_period_years > 0),
    random_seed INTEGER NOT NULL DEFAULT 42,
    generator_params_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    study_area_key TEXT NOT NULL DEFAULT 'tehran',
    epsg_definition TEXT NOT NULL DEFAULT '',
    boundary_json TEXT,
    is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
    created_at_utc TEXT NOT NULL
);

INSERT INTO dataset_sources (id, name, scenario_key, is_synthetic, crs_epsg, lixel_resolution_m, study_period_years, random_seed, generator_params_json, description, is_active, created_at_utc)
SELECT id, name, scenario_key, is_synthetic, crs_epsg, lixel_resolution_m, study_period_years, random_seed, generator_params_json, description, is_active, created_at_utc FROM dataset_sources__legacy;

DROP TABLE dataset_sources__legacy;


CREATE INDEX idx_road_nodes_dataset ON road_nodes (dataset_id);
CREATE INDEX idx_road_segments_dataset_class ON road_segments (dataset_id, road_class);
CREATE INDEX idx_road_lixels_dataset ON road_lixels (dataset_id, parent_segment_id);
CREATE INDEX idx_accidents_occurred_btree ON accidents (dataset_id, occurred_at_utc);
CREATE INDEX idx_accidents_reported_btree ON accidents (dataset_id, reported_at_utc);
CREATE INDEX idx_accidents_status ON accidents (dataset_id, verification_status);
CREATE INDEX idx_accidents_segment ON accidents (dataset_id, snapped_segment_id);
CREATE INDEX idx_accidents_lixel ON accidents (dataset_id, snapped_lixel_id);
CREATE INDEX idx_report_verif_accident ON report_verifications (accident_id, verified_at_utc DESC);

CREATE TRIGGER trg_road_nodes_rtree_ins AFTER INSERT ON road_nodes BEGIN
    INSERT INTO rtree_road_nodes(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.x_m, NEW.x_m, NEW.y_m, NEW.y_m);
END;
CREATE TRIGGER trg_road_nodes_rtree_del AFTER DELETE ON road_nodes BEGIN
    DELETE FROM rtree_road_nodes WHERE id = OLD.id;
END;
CREATE TRIGGER trg_road_segments_rtree_ins AFTER INSERT ON road_segments BEGIN
    INSERT INTO rtree_road_segments(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.min_x, NEW.max_x, NEW.min_y, NEW.max_y);
END;
CREATE TRIGGER trg_road_segments_rtree_del AFTER DELETE ON road_segments BEGIN
    DELETE FROM rtree_road_segments WHERE id = OLD.id;
END;
CREATE TRIGGER topology_dataset_insert AFTER INSERT ON dataset_sources BEGIN
    INSERT INTO network_topology_versions(dataset_id) VALUES (NEW.id);
END;

CREATE TRIGGER topology_segment_insert AFTER INSERT ON road_segments BEGIN
    INSERT INTO road_segment_directions(segment_id, dataset_id, direction, source)
    VALUES (NEW.id, NEW.dataset_id,
            CASE WHEN NEW.is_directed = 1 THEN 1 ELSE 0 END,
            CASE WHEN NEW.is_directed = 1 THEN 'legacy_is_directed' ELSE 'assumed_bidirectional' END);
END;
CREATE TRIGGER topology_segment_update AFTER UPDATE OF u_node_id, v_node_id, length_m ON road_segments BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_segment_reassign BEFORE UPDATE OF dataset_id ON road_segments WHEN OLD.dataset_id != NEW.dataset_id BEGIN
    SELECT RAISE(ABORT, 'moving segments between datasets is not supported');
END;
CREATE TRIGGER topology_segment_endpoints BEFORE UPDATE OF u_node_id, v_node_id ON road_segments
WHEN EXISTS (SELECT 1 FROM turn_restrictions WHERE from_segment_id=OLD.id OR to_segment_id=OLD.id) BEGIN
    SELECT RAISE(ABORT, 'remove turn restrictions before changing segment endpoints');
END;
CREATE TRIGGER trg_road_lixels_rtree_ins AFTER INSERT ON road_lixels BEGIN
    INSERT INTO rtree_road_lixels(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.min_x, NEW.max_x, NEW.min_y, NEW.max_y);
END;
CREATE TRIGGER trg_road_lixels_rtree_del AFTER DELETE ON road_lixels BEGIN
    DELETE FROM rtree_road_lixels WHERE id = OLD.id;
END;
CREATE TRIGGER topology_lixel_insert AFTER INSERT ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id;
END;
CREATE TRIGGER topology_lixel_update AFTER UPDATE OF dataset_id, parent_segment_id, lixel_index, m_start_m, m_end_m, length_m ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=NEW.dataset_id AND NEW.dataset_id != OLD.dataset_id;
END;
CREATE TRIGGER topology_lixel_delete AFTER DELETE ON road_lixels BEGIN
    UPDATE network_topology_versions SET version=version+1 WHERE dataset_id=OLD.dataset_id;
END;
CREATE TRIGGER trg_accidents_rtree_ins AFTER INSERT ON accidents BEGIN
    INSERT INTO rtree_accidents_raw(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.raw_x_m, NEW.raw_x_m, NEW.raw_y_m, NEW.raw_y_m);
    INSERT INTO rtree_accidents_snapped(id, min_x, max_x, min_y, max_y)
    SELECT NEW.id, NEW.snapped_x_m, NEW.snapped_x_m, NEW.snapped_y_m, NEW.snapped_y_m
    WHERE NEW.snapped_x_m IS NOT NULL AND NEW.snapped_y_m IS NOT NULL;
END;
CREATE TRIGGER trg_accidents_rtree_upd AFTER UPDATE ON accidents BEGIN
    DELETE FROM rtree_accidents_raw WHERE id = OLD.id;
    INSERT INTO rtree_accidents_raw(id, min_x, max_x, min_y, max_y)
    VALUES (NEW.id, NEW.raw_x_m, NEW.raw_x_m, NEW.raw_y_m, NEW.raw_y_m);
    DELETE FROM rtree_accidents_snapped WHERE id = OLD.id;
    INSERT INTO rtree_accidents_snapped(id, min_x, max_x, min_y, max_y)
    SELECT NEW.id, NEW.snapped_x_m, NEW.snapped_x_m, NEW.snapped_y_m, NEW.snapped_y_m
    WHERE NEW.snapped_x_m IS NOT NULL AND NEW.snapped_y_m IS NOT NULL;
END;
CREATE TRIGGER trg_accidents_rtree_del AFTER DELETE ON accidents BEGIN
    DELETE FROM rtree_accidents_raw WHERE id = OLD.id;
    DELETE FROM rtree_accidents_snapped WHERE id = OLD.id;
END;


-- Rows from before the generalization are labelled honestly (study_area_key = 'legacy') rather
-- than being attributed to a study area they were never collected in.
UPDATE dataset_sources SET study_area_key = 'legacy', epsg_definition = 'EPSG:25832'
WHERE crs_epsg = 25832;
UPDATE dataset_sources SET epsg_definition = 'EPSG:' || crs_epsg WHERE epsg_definition = '';
INSERT INTO network_topology_versions(dataset_id)
SELECT d.id FROM dataset_sources d
WHERE NOT EXISTS (SELECT 1 FROM network_topology_versions v WHERE v.dataset_id = d.id);

UPDATE road_nodes SET srid = (SELECT d.crs_epsg FROM dataset_sources d WHERE d.id = road_nodes.dataset_id);
UPDATE road_segments SET srid = (SELECT d.crs_epsg FROM dataset_sources d WHERE d.id = road_segments.dataset_id);
UPDATE road_lixels SET srid = (SELECT d.crs_epsg FROM dataset_sources d WHERE d.id = road_lixels.dataset_id);
UPDATE accidents SET srid = (SELECT d.crs_epsg FROM dataset_sources d WHERE d.id = accidents.dataset_id);

CREATE TABLE ingestion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER REFERENCES dataset_sources(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('geojson_network', 'citizen_report', 'manual')),
    study_area_key TEXT NOT NULL DEFAULT '',
    epsg_in INTEGER,
    feature_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    outside_boundary_count INTEGER NOT NULL DEFAULT 0,
    report_json TEXT NOT NULL DEFAULT '{}',
    created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ingestion_events_dataset ON ingestion_events (dataset_id, created_at_utc DESC);
