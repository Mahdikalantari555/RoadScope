# Design: citizen reporting pilot

## Scope and prerequisites

This change turns the current demo form into a real-data workflow only after a restricted pilot's owner, hosting, identity model, retention/disclosure and legal/privacy review are approved. It builds on reviewed Tehran network and CRS work from `tehran-synthetic-demo`, but uses a distinct real incident dataset or database. Network provenance and incident provenance are separate. Real and synthetic data must never be mixed by activation, analytics, exports, simulation or migration. Existing synthetic scenarios remain available and are never overwritten or reclassified. Demo mode refuses real datasets and remains disabled for the real pilot.

## Data flow

A consenting authorized participant places a pin or optionally uses device location and supplies occurrence date/time (Asia/Tehran converted to UTC), type, severity or unknown, and location uncertainty; no photo, identity documents, free-text narrative, license plate or victim details in MVP. The service validates schema, boundary and time, retains raw location securely, proposes snap candidates on the exact versioned network, and records uncertainty and explicit selection. No confident snap is fabricated for a missing road or grade ambiguity: allow a controlled unmatched review state. Detect possible duplicates spatially/temporally but do not auto-merge; manual decisions retain history. Return a secure unguessable report-access credential distinct from public report ID, display it once, store only a verifier, and rate-limit tracking. Exact tracking behavior may instead use a reviewed authenticated ownership model; choose and document one before public pilot.

Reports transition from submitted/unverified to in-review, verified, rejected or duplicate/merged with provenance, reversible moderation and auditable actor/time/reason. Duplicate is a relationship, not a second counted incident. Verification is a steward judgment, not proof of official reporting. Support requested correction/deletion via a secure identity/ownership process, recording minimal audit events under approved retention policy. If retention or deletion conflicts with scientific records, resolve before launch; never promise impossible deletion.

Public map returns only verified records with approved aggregation or coarse location/time, under a disclosure policy protecting re-identification; no raw locations, credentials, personal data, internal scores, candidate lists or sensitive fields in GETs, exports, logs or error messages. Small-cell suppression and temporal/spatial aggregation thresholds are release decisions validated by privacy review. Request authorization and server-side roles for review/export; UI persona is never authority. Avoid public exact raw points and narratives even for verified records. Read-only public service is disabled until privacy policy and threat model are approved.

## Security and operational controls

Separate authentication/authorization for reporter and steward, least-privilege routes including GET and exports; secure token storage and revocation, TLS, rate limits and abuse monitoring, input/body bounds, transactional idempotency, backups, audit access and retention/deletion jobs. Review current `security.py` GET paths, demo behavior and in-memory limits for multi-worker deployment; do not rely on demo roles or client-provided roles. Select and test identity and throttling strategy appropriate to deployment, explicitly acknowledging anonymous abuse versus privacy tradeoffs. Avoid exposing tracking secrets in URLs/logs. Do not store sensitive values in analytics telemetry. Production launch requires real credentials and operational owner, not demo mode.

## Statistical boundaries

Unverified and rejected records are excluded from verified analysis by default; duplicates counted once; filters and exports retain status/source/network version. Citizen reports cannot be represented as complete crash counts. Suppress or explicitly gate/calibrate EB, exposure-normalized risk and inferential outputs until actual denominator, selection bias, training and validation are addressed; do not invent AADT, weather or ground truth. Validate corrections and late reports across map, analytics and audit.

## Rollout and rollback

Ship schema migration with backups, backwards compatibility and reversible deployment instructions. Start with representative test data, no actual personal reports; then a restricted opt-in pilot after operational approval. Feature-flag intake and public publication separately. Disable intake/publication and restore application version without discarding reports or changing their statuses; if schema cannot safely downgrade use forward-only migration and documented restoration/reconciliation. Test failure paths, concurrency, privacy leakage and dataset isolation before opening the pilot.
