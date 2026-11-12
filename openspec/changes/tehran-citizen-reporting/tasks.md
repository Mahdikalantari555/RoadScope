# Tasks

## 1. Decisions and safeguards
- [ ] 1.1 Approve pilot boundary, operator, hosting, user population, identity/anti-abuse method, consent, retention, deletion and public disclosure granularity with privacy/legal review.
- [ ] 1.2 Review Tehran network quality, CRS and snap ambiguity; document separation and migration of demo versus real incident datasets.
- [ ] 1.3 Write threat model for reporting, tracking, authorization, location privacy, abuse and moderation; define launch gates and operational ownership.

## 2. Backend and data
- [ ] 2.1 Design migration, isolated datasets, source/network provenance, safe backup, compatibility and rollback/reconciliation; never overwrite synthetic observations.
- [ ] 2.2 Implement bounded structured intake, validated timezone conversion, explicit consent, raw point protection, uncertain/unmatched snapping and duplicate suggestions.
- [ ] 2.3 Implement approved reporter ownership and unguessable access credential or equivalent, authentication, role enforcement on all restricted reads/writes and distributed-safe rate limiting.
- [ ] 2.4 Implement transactional stewardship, auditable and reversible moderation/merges, safe idempotency, correction and retention/deletion workflows.
- [ ] 2.5 Implement privacy-reviewed public aggregates and separate publication flag; exclude unverified/private data from public map, GET and export routes.
- [ ] 2.6 Remove fake environmental/traffic defaults from real flows; gate risk and inference that lack required inputs or calibration.

## 3. Frontend and operations
- [ ] 3.1 Build responsive Persian/English intake, informed consent, uncertainty, duplicate and unmatched feedback, secure tracking and offline/error states; exclude photo/free text.
- [ ] 3.2 Build role-gated stewardship and clear synthetic/real and verification labels; never put tracking credentials in URLs or logs.
- [ ] 3.3 Document operator, threat controls, key rotation, monitoring, backup, launch approval, disablement, rollback, retention and deletion.

## 4. Validation
- [ ] 4.1 Test schema migration/backups, dataset isolation and demo guard with no real personal data.
- [ ] 4.2 Test permissions, CSRF/session risks as applicable, guessing/rate limits, idempotency, malformed inputs, privacy leaks and multi-user concurrent moderation.
- [ ] 4.3 Test uncertainty, unmatched reports, duplicate/merge reversal, status tracking and corrected/deleted public views.
- [ ] 4.4 Test timezone/RTL/LTR, accessibility, sparse/missing exposure behavior, restricted pilot and rollback with synthetic fixtures.
