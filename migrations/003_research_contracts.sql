ALTER TABLE road_segments ADD COLUMN travel_direction TEXT NOT NULL DEFAULT 'both' CHECK(travel_direction IN ('both','forward','reverse'));
ALTER TABLE road_segments ADD COLUMN direction_provenance TEXT NOT NULL DEFAULT 'assumed_bidirectional';
UPDATE road_segments SET travel_direction='forward', direction_provenance='legacy_is_directed' WHERE is_directed=1;
CREATE TABLE turn_restrictions (
 dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
 from_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
 to_segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
 provenance TEXT NOT NULL,
 PRIMARY KEY(dataset_id,from_segment_id,to_segment_id)
);
CREATE TABLE research_runs (
 id INTEGER PRIMARY KEY, contract_version TEXT NOT NULL, method TEXT NOT NULL,
 dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
 manifest_json TEXT NOT NULL, result_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE incident_allocations (
 accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, lixel_id INTEGER NOT NULL REFERENCES road_lixels(id) ON DELETE CASCADE,
 probability REAL NOT NULL CHECK(probability >= 0 AND probability <= 1),
 provenance TEXT NOT NULL, PRIMARY KEY(accident_id,version,lixel_id)
);
CREATE TABLE surrogate_observations (
 id INTEGER PRIMARY KEY, segment_id INTEGER NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
 start_utc TEXT NOT NULL, end_utc TEXT NOT NULL, definition TEXT NOT NULL,
 count INTEGER NOT NULL CHECK(count>=0), exposure REAL NOT NULL CHECK(exposure>0),
 exposure_unit TEXT NOT NULL, source TEXT NOT NULL, privacy_provenance TEXT NOT NULL,
 CHECK(end_utc>start_utc)
);
CREATE TRIGGER immutable_research_runs BEFORE UPDATE ON research_runs BEGIN SELECT RAISE(ABORT,'Research runs are immutable'); END;
