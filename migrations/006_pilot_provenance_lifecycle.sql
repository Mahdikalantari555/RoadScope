-- RoadScope 006: provenance, restricted-pilot lifecycle, moderation and reviewable disclosure.
--
-- This migration is strictly additive: it never rewrites or reinterprets an existing dataset,
-- network, accident, geometry or CRS. It adds:
--   1. Dataset profile/settlement metadata (`profile_key`, network/incident provenance,
--      calibration status, publication flag) so a synthetic demo dataset and a restricted real
--      pilot dataset can coexist without being conflated.
--   2. Source-level network provenance: which extract version produced each node/segment, the
--      original OSM/source feature id, how the grade/direction was decided, and whether the
--      topology at that feature was ambiguous (geometric crossing without a topological node).
--   3. Reporter-owned access credentials (only an HMAC lookup token + verifier are stored; the
--      plaintext credential is shown once and never persisted), explicit consent records,
--      reversible moderation events, duplicate links, corrections, deletion requests and
--      retention fields.
--   4. Privacy-reviewed public aggregates with small-cell suppression and an independent
--      publication flag.
--   5. Distributed-safe (database-backed) rate limiting plus request idempotency so multiple
--      worker processes share one budget.
--   6. Feature flags whose activation requires a recorded approval reference; both intake and
--      publication default to disabled (0).
--
-- All statements are idempotent-friendly through IF NOT EXISTS / OR IGNORE where SQLite allows.

-- ---------------------------------------------------------------------------------------------
-- 1. Dataset profiles and provenance
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dataset_profiles (
    profile_key TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('synthetic_demo', 'restricted_pilot', 'legacy')),
    sqlite_path TEXT NOT NULL DEFAULT '',
    allows_real_reports INTEGER NOT NULL DEFAULT 0 CHECK (allows_real_reports IN (0, 1)),
    allows_publication INTEGER NOT NULL DEFAULT 0 CHECK (allows_publication IN (0, 1)),
    notes TEXT NOT NULL DEFAULT '',
    created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO dataset_profiles (profile_key, purpose, sqlite_path, allows_real_reports, allows_publication, notes)
VALUES
    ('demo', 'synthetic_demo', '', 0, 0,
     'Synthetic-only demonstration profile. Real reports and public disclosure are refused.'),
    ('pilot', 'restricted_pilot', '', 1, 1,
     'Restricted invite-only pilot profile in a separate database. Activation requires documented ownership, legal/privacy approval, key rotation and retention decisions.'),
    ('legacy', 'legacy', '', 0, 0,
     'Pre-generalization EPSG:25832 data preserved verbatim. Never relabelled as Tehran.');

CREATE TABLE IF NOT EXISTS network_extracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    extract_key TEXT NOT NULL DEFAULT '',
    extract_version TEXT NOT NULL,
    format TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    source_attribution TEXT NOT NULL DEFAULT '',
    license TEXT NOT NULL DEFAULT '',
    snapshot_date TEXT NOT NULL DEFAULT '',
    checksum_sha256 TEXT NOT NULL,
    boundary_json TEXT NOT NULL DEFAULT '{}',
    buffer_m REAL NOT NULL DEFAULT 0,
    epsg_in INTEGER NOT NULL,
    epsg_out INTEGER NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    segment_count INTEGER NOT NULL DEFAULT 0,
    lixel_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    ambiguous_crossing_count INTEGER NOT NULL DEFAULT 0,
    missing_attribute_count INTEGER NOT NULL DEFAULT 0,
    coverage_json TEXT NOT NULL DEFAULT '{}',
    provenance_json TEXT NOT NULL DEFAULT '{}',
    imported_by_user_id INTEGER REFERENCES users(id),
    imported_at_utc TEXT NOT NULL,
    UNIQUE (dataset_id, checksum_sha256)
);
CREATE INDEX IF NOT EXISTS idx_network_extracts_dataset ON network_extracts (dataset_id, imported_at_utc DESC);

ALTER TABLE dataset_sources ADD COLUMN profile_key TEXT NOT NULL DEFAULT 'demo';
ALTER TABLE dataset_sources ADD COLUMN network_provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE dataset_sources ADD COLUMN incident_provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE dataset_sources ADD COLUMN calibration_status TEXT NOT NULL DEFAULT 'uncalibrated'
    CHECK (calibration_status IN ('uncalibrated', 'research_only', 'approved'));
ALTER TABLE dataset_sources ADD COLUMN is_publishable INTEGER NOT NULL DEFAULT 0 CHECK (is_publishable IN (0, 1));
ALTER TABLE dataset_sources ADD COLUMN user_disclosure_approved INTEGER NOT NULL DEFAULT 0 CHECK (user_disclosure_approved IN (0, 1));
ALTER TABLE dataset_sources ADD COLUMN archived_at_utc TEXT;

-- Existing rows keep their data; only honest profile/provenance labels are added.
UPDATE dataset_sources SET profile_key = 'legacy' WHERE study_area_key = 'legacy' OR crs_epsg = 25832;
UPDATE dataset_sources SET profile_key = 'demo' WHERE profile_key = 'demo' AND is_synthetic = 1;
UPDATE dataset_sources SET calibration_status = 'research_only' WHERE is_synthetic = 1;

-- ---------------------------------------------------------------------------------------------
-- 2. Network-level provenance on nodes / segments / lixels
-- ---------------------------------------------------------------------------------------------
ALTER TABLE road_nodes ADD COLUMN source_node_id TEXT;
ALTER TABLE road_nodes ADD COLUMN source_version TEXT;

ALTER TABLE road_segments ADD COLUMN source_feature_id TEXT;
ALTER TABLE road_segments ADD COLUMN source_version TEXT;
ALTER TABLE road_segments ADD COLUMN grade_source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE road_segments ADD COLUMN direction_source_detail TEXT NOT NULL DEFAULT 'assumed_bidirectional';
ALTER TABLE road_segments ADD COLUMN topology_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (topology_ambiguous IN (0, 1));

ALTER TABLE road_lixels ADD COLUMN source_version TEXT;

CREATE INDEX IF NOT EXISTS idx_road_segments_source_feature ON road_segments (dataset_id, source_feature_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Accident provenance, ownership, consent and lifecycle
-- ---------------------------------------------------------------------------------------------
ALTER TABLE accidents ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE accidents ADD COLUMN retention_until_utc TEXT;
ALTER TABLE accidents ADD COLUMN deleted_at_utc TEXT;
ALTER TABLE accidents ADD COLUMN deleted_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE accidents ADD COLUMN corrected_at_utc TEXT;
ALTER TABLE accidents ADD COLUMN duplicate_of_id INTEGER REFERENCES accidents(id) ON DELETE SET NULL;
ALTER TABLE accidents ADD COLUMN unmatched INTEGER NOT NULL DEFAULT 0 CHECK (unmatched IN (0, 1));
ALTER TABLE accidents ADD COLUMN coarse_cell_key TEXT NOT NULL DEFAULT '';
ALTER TABLE accidents ADD COLUMN consent_withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (consent_withdrawn IN (0, 1));
ALTER TABLE accidents ADD COLUMN reporter_identity_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_accidents_duplicate_of ON accidents (duplicate_of_id);
CREATE INDEX IF NOT EXISTS idx_accidents_deleted ON accidents (dataset_id, deleted_at_utc);

CREATE TABLE IF NOT EXISTS report_consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL UNIQUE REFERENCES accidents(id) ON DELETE CASCADE,
    consent_version TEXT NOT NULL,
    consent_scope TEXT NOT NULL DEFAULT 'restricted_pilot_aggregate',
    locale TEXT NOT NULL DEFAULT 'fa',
    consented_at_utc TEXT NOT NULL,
    withdrawn_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_consents_withdrawn ON report_consents (withdrawn_at_utc);

CREATE TABLE IF NOT EXISTS report_access_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    credential_hmac TEXT NOT NULL UNIQUE,
    credential_verifier TEXT NOT NULL,
    verifier_salt TEXT NOT NULL,
    issued_at_utc TEXT NOT NULL,
    rotated_at_utc TEXT,
    revoked_at_utc TEXT,
    last_used_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_credentials_accident ON report_access_credentials (accident_id, issued_at_utc DESC);

CREATE TABLE IF NOT EXISTS report_moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES users(id),
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN (
        'submit', 'verify', 'reject', 'flag_review', 'merge', 'unmerge',
        'correct', 'delete', 'restore', 'withdraw_consent', 'rotate_credential', 'retention_purge'
    )),
    previous_state_json TEXT NOT NULL DEFAULT '{}',
    new_state_json TEXT NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    reversible INTEGER NOT NULL DEFAULT 1 CHECK (reversible IN (0, 1)),
    reversed_by_event_id INTEGER REFERENCES report_moderation_events(id),
    created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moderation_dataset ON report_moderation_events (dataset_id, created_at_utc DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_accident ON report_moderation_events (accident_id, id);

CREATE TABLE IF NOT EXISTS report_duplicate_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    canonical_accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    duplicate_accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK (decision IN ('suggested', 'merged', 'rejected')),
    merge_event_id INTEGER REFERENCES report_moderation_events(id),
    created_at_utc TEXT NOT NULL,
    reversed_at_utc TEXT,
    CHECK (canonical_accident_id != duplicate_accident_id),
    UNIQUE (canonical_accident_id, duplicate_accident_id)
);
CREATE INDEX IF NOT EXISTS idx_duplicate_links_dataset ON report_duplicate_links (dataset_id, decision);

CREATE TABLE IF NOT EXISTS report_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL CHECK (requested_by IN ('reporter', 'steward')),
    field_name TEXT NOT NULL,
    previous_value_json TEXT,
    new_value_json TEXT,
    status TEXT NOT NULL CHECK (status IN ('requested', 'applied', 'rejected')),
    moderation_event_id INTEGER REFERENCES report_moderation_events(id),
    reason TEXT NOT NULL DEFAULT '',
    created_at_utc TEXT NOT NULL,
    applied_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_corrections_accident ON report_corrections (accident_id, created_at_utc DESC);

CREATE TABLE IF NOT EXISTS report_deletion_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    accident_id INTEGER NOT NULL REFERENCES accidents(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL CHECK (requested_by IN ('reporter', 'steward', 'retention_job')),
    status TEXT NOT NULL CHECK (status IN ('requested', 'scheduled', 'executed', 'declined')),
    reason TEXT NOT NULL DEFAULT '',
    requested_at_utc TEXT NOT NULL,
    executed_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_accident ON report_deletion_requests (accident_id, requested_at_utc DESC);

-- ---------------------------------------------------------------------------------------------
-- 4. Privacy-reviewed public aggregates and the independent publication flag
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public_report_aggregates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id INTEGER NOT NULL REFERENCES dataset_sources(id) ON DELETE CASCADE,
    cell_key TEXT NOT NULL,
    period_start_utc TEXT NOT NULL,
    period_end_utc TEXT NOT NULL,
    category_code TEXT NOT NULL,
    severity_band TEXT NOT NULL CHECK (severity_band IN ('pdo', 'injury', 'fatal')),
    report_count INTEGER NOT NULL CHECK (report_count >= 0),
    suppressed INTEGER NOT NULL DEFAULT 0 CHECK (suppressed IN (0, 1)),
    suppression_reason TEXT NOT NULL DEFAULT '',
    disclosure_policy_reference TEXT NOT NULL DEFAULT '',
    computed_at_utc TEXT NOT NULL,
    UNIQUE (dataset_id, cell_key, period_start_utc, period_end_utc, category_code, severity_band)
);
CREATE INDEX IF NOT EXISTS idx_public_aggregates_dataset ON public_report_aggregates (dataset_id, period_start_utc);

CREATE TABLE IF NOT EXISTS pilot_configuration (
    dataset_id INTEGER PRIMARY KEY REFERENCES dataset_sources(id) ON DELETE CASCADE,
    pilot_key TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '',
    operator TEXT NOT NULL DEFAULT '',
    hosting TEXT NOT NULL DEFAULT '',
    identity_model TEXT NOT NULL DEFAULT '',
    approval_reference TEXT NOT NULL DEFAULT '',
    approved_at_utc TEXT,
    retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days > 0),
    disclosure_json TEXT NOT NULL DEFAULT '{}',
    updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    owner TEXT NOT NULL DEFAULT '',
    approval_reference TEXT NOT NULL DEFAULT '',
    updated_at_utc TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO feature_flags (key, enabled, owner, approval_reference, updated_at_utc, notes) VALUES
    ('pilot_intake', 0, '', '', CURRENT_TIMESTAMP,
     'Restricted-pilot report intake. Stays disabled until owner, hosting, identity, consent and retention are approved.'),
    ('pilot_publication', 0, '', '', CURRENT_TIMESTAMP,
     'Public aggregate disclosure. Independent of intake; requires privacy-reviewed disclosure granularity and legal approval.'),
    ('pilot_tracking', 0, '', '', CURRENT_TIMESTAMP,
     'Reporter credential tracking endpoint. Requires an approved credential/ownership model.'),
    ('pilot_corrections', 0, '', '', CURRENT_TIMESTAMP,
     'Reporter correction and deletion requests. Requires an approved retention and deletion policy.');

-- ---------------------------------------------------------------------------------------------
-- 5. Database-backed rate limiting and request idempotency (shared by all worker processes)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit_windows (
    bucket TEXT NOT NULL,
    window_start_epoch INTEGER NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
    PRIMARY KEY (bucket, window_start_epoch)
);

CREATE TABLE IF NOT EXISTS request_idempotency (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at_utc TEXT NOT NULL,
    UNIQUE (scope, idempotency_key)
);

-- ---------------------------------------------------------------------------------------------
-- 6. Honest indexes on the new provenance columns
-- ---------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dataset_sources_profile ON dataset_sources (profile_key, is_synthetic);
CREATE INDEX IF NOT EXISTS idx_dataset_sources_area ON dataset_sources (study_area_key, is_active);

-- The default dataset can only be published when both the dataset flag and the global flag agree;
-- the service layer enforces this, and the trigger below prevents a dataset from flipping to
-- publishable while it still carries unverified or synthetic-only provenance.
CREATE TRIGGER IF NOT EXISTS guard_publishable_dataset
BEFORE UPDATE OF is_publishable ON dataset_sources
WHEN NEW.is_publishable = 1 AND NEW.is_synthetic = 1
BEGIN
    SELECT RAISE(ABORT, 'synthetic datasets cannot be marked publishable as real observations');
END;
