-- Immutable research run manifests, versioned VGI allocations, and aggregate surrogate safety records.
CREATE TABLE research_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_version TEXT NOT NULL,
    method TEXT NOT NULL,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    manifest_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_research_runs_dataset_method ON research_runs(dataset_id, method);

CREATE TRIGGER immutable_research_runs BEFORE UPDATE ON research_runs BEGIN
    SELECT RAISE(ABORT, 'Research runs are immutable');
END;

CREATE TABLE allocation_versions (
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    valid INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0, 1)),
    source_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(accident_id, version)
);

CREATE TABLE incident_allocations (
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    lixel_id INTEGER NOT NULL REFERENCES road_lixels(id) ON DELETE CASCADE,
    probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
    provenance TEXT NOT NULL,
    PRIMARY KEY(accident_id, version, lixel_id)
);

CREATE TRIGGER invalidate_incident_allocations
AFTER UPDATE OF snapped_lixel_id, snap_candidates_json, verification_status, canonical_parent_id ON accidents
BEGIN
    UPDATE allocation_versions SET valid = 0 WHERE accident_id = NEW.id;
END;

CREATE TABLE surrogate_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
    start_utc TEXT NOT NULL,
    end_utc TEXT NOT NULL,
    definition TEXT NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 0),
    exposure REAL NOT NULL CHECK (exposure > 0),
    exposure_unit TEXT NOT NULL,
    coverage_fraction REAL NOT NULL DEFAULT 1.0 CHECK (coverage_fraction > 0 AND coverage_fraction <= 1.0),
    source TEXT NOT NULL,
    privacy_provenance TEXT NOT NULL,
    created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_utc > start_utc)
);
CREATE INDEX idx_surrogate_obs_dataset_segment ON surrogate_observations(dataset_id, segment_id);
