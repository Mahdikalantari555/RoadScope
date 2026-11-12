# Frontend experience improvements

## ADDED Requirements

### Requirement: Inventory and preserve existing functionality
Before implementing the improvements, the team SHALL compare selected FrontExamples patterns with existing workspaces and API capabilities and SHALL document existing, partial, absent and unsupported behavior. Existing working workflows and security restrictions SHALL remain intact.

#### Scenario: Feature already exists
- **WHEN** inventory finds an existing legend or filter
- **THEN** the implementation improves or reuses it rather than introducing a conflicting second source of state

#### Scenario: API unavailable
- **WHEN** a proposed example interaction has no supporting API or permission
- **THEN** it is omitted or visibly unavailable and no fabricated result is shown

### Requirement: Accessible scientific guidance
The application SHALL provide discoverable Persian and English guidance for displayed analysis, with definitions, units, input requirements, uncertainty and limitations where applicable.

#### Scenario: Synthetic risk explanation
- **WHEN** a user opens guidance on a synthetic risk output
- **THEN** the guidance identifies the output as illustrative and not validated evidence of actual risk

### Requirement: Understandable selected-feature details
The application SHALL present accessible details for selected map incidents or road segments using available authorized fields, with clear source/status and missing values. It SHALL NOT expose fields prohibited by the active data access policy.

#### Scenario: Select a segment
- **WHEN** a user selects a road segment by mouse or keyboard-accessible alternative
- **THEN** its available details and provenance are shown and the user can close the panel without losing unrelated filters

#### Scenario: Sensitive report
- **WHEN** the current user lacks permission to see exact citizen report details
- **THEN** neither the panel nor its network response exposes those details

### Requirement: Visible, coordinated filters
The application SHALL show active filters and provide clear-one and reset-all controls, preserving backend semantics and synchronizing supported chart/map interactions.

#### Scenario: Chart filter
- **WHEN** a user chooses an available chart category
- **THEN** its selected state, filter summary and map/analytics responses reflect the same filter

#### Scenario: Async failure or out-of-order response
- **WHEN** a request fails or an older request completes after a newer one
- **THEN** the UI shows an error or stale-state indication and does not present the older response as the current selection

### Requirement: Honest presentation view
The application SHALL offer an uncluttered presentation view with the active dataset, applicable synthetic warning, source attribution, relevant legend and filter context visible, including in browser screenshots.

#### Scenario: Synthetic Tehran presentation
- **WHEN** presentation mode is opened on the Tehran synthetic dataset
- **THEN** the view clearly distinguishes real street geometry from synthetic observations and retains attribution and legend

#### Scenario: No Tehran profile
- **WHEN** the presentation view is opened with an existing Frankfurt dataset
- **THEN** the view remains functional and displays its own dataset metadata

### Requirement: Localized and accessible interaction
All new controls and state messages SHALL be available in Persian and English, usable with keyboard and at small viewport sizes, and provide loading, empty, error and non-WebGL fallback states.

#### Scenario: RTL keyboard use
- **WHEN** a Persian user navigates filters and feature details using a keyboard
- **THEN** labels, focus, controls and bidirectional numeric values remain understandable and operable
