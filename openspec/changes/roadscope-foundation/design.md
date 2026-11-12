# Design

## Context

The repository needs a reproducible, safe foundation for RoadScope without breaking the current API or user data.

## Goals / Non-Goals

**Goals:** Brand and document RoadScope, establish reproducible development and deployment, protect existing data and implement server-side identity and authorization before real-world use.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Use the current root layout. The former FrontExamples references were removed from the working tree at the owner’s request after inventory; consult the pinned historical source linked from `docs/FRONTEND_INTERACTION_INVENTORY.md` if needed. Inventory tracked SQLite, compiled frontend assets and caches before deciding which to untrack. FastAPI serves static_bundle, so build it in deployment before removal; migrate/back up existing SQLite before replacing a tracked database with an explicitly reproducible seed. Add root ignores for local environments, databases and build outputs without hiding application sources. Choose and document SQLite-only versus a genuinely implemented and tested PostGIS adapter; the current Compose PostGIS is not used by db.py.

Use versioned, transactional, repeatable migrations and backup/restore tests. Introduce a server-authenticated principal with role derived on the server, not request actor_role; support an explicitly isolated synthetic demo mode without presenting it as production authentication. Preserve old environment names as documented aliases with precedence and deprecation policy. Document local and container build, runtime configuration, seed generation, and recovery. Guard endpoints with least privilege, audit attribution, validation and rate limits.

## Dependencies

None. The repository relocation has already been performed; verify it rather than moving it again.

## Risks / Trade-offs

Existing deployments may depend on checked-in bundles or mutable DB; never remove these until a working replacement and recovery are verified. Demo mode must not become a production bypass.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
