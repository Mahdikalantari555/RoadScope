# platform-foundation

## Purpose

The repository needs a reproducible, safe foundation for RoadScope without breaking the current API or user data. This specification defines proposed behavior and acceptance cases for RoadScope.

## ADDED Requirements

### Requirement: Safe migration and deployment
The platform SHALL support clean installation and versioned, repeatable data migrations, with backup and recovery of existing SQLite data before destructive changes.

#### Scenario: Existing installation
- **WHEN** an existing database is upgraded
- **THEN** a backup can be restored and existing datasets and audit records remain available

#### Scenario: Fresh installation
- **WHEN** a clean checkout is built according to the documented process
- **THEN** the API and frontend start without relying on an undeclared local build artifact

### Requirement: Trusted authorization
The server SHALL authorize privileged operations using an authenticated server-side identity and role; client-provided role strings SHALL NOT grant permissions.

#### Scenario: Forged role
- **WHEN** an unauthenticated or unauthorized client submits actor_role=data_steward
- **THEN** the privileged operation is denied and no mutation occurs

#### Scenario: Demo isolation
- **WHEN** synthetic demo mode is enabled
- **THEN** the UI and API identify it as non-production and deployment documentation prohibits use with sensitive data

### Requirement: Compatible branding and configuration
The product SHALL be presented as RoadScope while maintaining documented compatibility for existing API routes and UAI environment variables during migration.

#### Scenario: Legacy deployment
- **WHEN** only legacy UAI settings are provided
- **THEN** the settings continue to work according to the documented precedence rules
