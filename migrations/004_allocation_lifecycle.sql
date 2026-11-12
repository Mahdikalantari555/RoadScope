CREATE TABLE allocation_versions (
 accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 valid INTEGER NOT NULL DEFAULT 1 CHECK(valid IN (0,1)),
 source_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(accident_id,version)
);
CREATE TRIGGER invalidate_incident_allocations AFTER UPDATE OF snapped_lixel_id, snap_candidates_json, verification_status, canonical_parent_id ON accidents
BEGIN
 UPDATE allocation_versions SET valid=0 WHERE accident_id=NEW.id;
END;
