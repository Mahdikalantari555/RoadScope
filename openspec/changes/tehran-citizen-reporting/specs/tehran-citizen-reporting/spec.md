# Tehran citizen reporting

## ADDED Requirements

### Requirement: Separate real and synthetic data
Real citizen reports SHALL be stored in an explicitly identified real incident dataset, separate from synthetic observations, with network source/version provenance. Demo mode SHALL refuse real incident datasets and SHALL NOT permit real ingestion.

#### Scenario: Synthetic to real transition
- **WHEN** real-data reporting is enabled
- **THEN** no synthetic incident is automatically reclassified, imported into real counts, or deleted, and existing demo datasets remain available separately

#### Scenario: Demo guard
- **WHEN** demo mode encounters a real incident dataset
- **THEN** it denies access rather than silently exposing or modifying real data

### Requirement: Minimal consented report submission
The system SHALL offer a localized, access-controlled reporting flow for crash location, occurrence time, category, severity including unknown, and uncertainty. It SHALL explain purpose and obtain the required informed consent before collecting data. Photos and unrestricted narrative SHALL NOT be collected in the pilot.

#### Scenario: Valid report
- **WHEN** an authorized participant submits a consented, valid report inside the supported area
- **THEN** the system stores the report as unverified, preserving the UTC occurrence time, location uncertainty and dataset provenance, and acknowledges receipt

#### Scenario: Invalid input or consent absent
- **WHEN** required input is invalid or consent is absent
- **THEN** no report is saved and a localized actionable error is returned

### Requirement: Reviewable spatial matching and duplicates
The system SHALL preserve the raw point securely, associate optional road candidates with their network version, and permit a report to remain unmatched where confidence is insufficient. It SHALL suggest possible duplicates without automatic irreversible merging.

#### Scenario: Grade-separated ambiguity
- **WHEN** a point is near multiple roads at different elevations
- **THEN** candidate alternatives and uncertainty are retained for review without asserting an unverified match as fact

#### Scenario: Possible duplicate
- **WHEN** a report resembles an existing report in space and time
- **THEN** the reviewer can assess the suggestion and the system does not automatically count or merge it as a verified incident

### Requirement: Authenticated stewardship and tracking
The system SHALL enforce server-side roles and support authorized review, status changes, duplicate decisions and auditable correction. It SHALL provide secure reporter status access by a reviewed ownership mechanism, not by guessable report ID alone.

#### Scenario: Unauthorized review
- **WHEN** an unauthenticated or insufficiently privileged requester attempts to read restricted details or change status
- **THEN** the request is denied without leaking report content

#### Scenario: Duplicate decision
- **WHEN** a steward marks a report as a duplicate
- **THEN** the relationship and audit record are retained, the event is counted at most once, and the decision can be reviewed and reversed

#### Scenario: Tracking credential misuse
- **WHEN** a tracking credential is missing, invalid or repeatedly guessed
- **THEN** access is denied, guessing is rate-limited and no sensitive details are disclosed

### Requirement: Privacy-preserving public outputs
The system SHALL expose only fields and spatial/temporal granularity approved in a documented privacy review, and SHALL exclude unverified reports by default. Internal exact locations, credentials, personal details and narratives SHALL NOT be returned in public APIs, maps or exports.

#### Scenario: Public map and export
- **WHEN** a public client requests reports or exports
- **THEN** only approved verified, privacy-protected outputs are returned and private raw values are absent

#### Scenario: Policy not approved
- **WHEN** a disclosure or retention policy is not approved
- **THEN** real public publication remains disabled

### Requirement: Honest analytics and lifecycle
The system SHALL retain report source, status and limitations throughout analysis and SHALL NOT treat citizen submissions as complete official crashes or invent exposure. It SHALL support correction and deletion under an approved documented retention policy.

#### Scenario: Sparse reports or absent exposure
- **WHEN** reports are sparse or AADT is unavailable
- **THEN** exposure-normalized or calibrated-risk claims are disabled or clearly unavailable rather than filled with fabricated observations

#### Scenario: Correction or deletion request
- **WHEN** an authorized request is accepted under the retention policy
- **THEN** affected private and public views are updated and a minimal authorized audit trail is retained according to that policy
