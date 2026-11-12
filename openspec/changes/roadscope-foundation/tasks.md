# Tasks

## 1. Implementation and validation

- [ ] 1.1 Inventory paths, assets, data provenance, environment aliases, deployment and license status; document decisions and backup procedure.
- [ ] 1.2 Add repeatable installation, isolated test DB, CI for Python, TypeScript and OpenSpec, and root ignore rules.
- [x] 1.3 Implement RoadScope branding and compatible configuration aliases; update docs and test both old and new names.
- [ ] 1.4 Implement versioned migrations, backup/restore and clean-build/static-serving tests before untracking generated files or data.
- [ ] 1.5 Decide and implement SQLite-only or a real PostGIS adapter; test chosen deployment and remove misleading claims.
- [ ] 1.6 Implement server-side authentication/authorization, secure audit attribution, abuse limits and explicitly isolated synthetic demo mode.
- [ ] 1.7 Test unauthorized, forged-role, upgrade, rollback/recovery and clean-install cases; update operator documentation.

Progress: CI, SQLite-only Compose, configuration aliases and an integrity-checked SQLite copy tool with backup/restore tests are in place. Container deployment validation, versioned migrations, operational recovery validation, and server-side authorization remain open.
