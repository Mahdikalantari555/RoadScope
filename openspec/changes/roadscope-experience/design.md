# Design

## Context

The current dense, English-only interface needs a coherent map-first experience while preserving working analytical flows.

## Goals / Non-Goals

**Goals:** Build a bilingual Persian/English interface combining the strongest navigation, map, overview and analysis patterns from FrontExamples without importing their incompatible APIs.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Use DSV/Opus navigation, Gemini/Seed coordinated map and analysis, Qwen overview, and Fable layer controls as design references, not drop-in Next.js backends. Retain React/Vite, current six workspaces, API contracts, selection/filter state and working map interactions. Extract reusable shell, control, error and map components incrementally from App/HeaderBar/MapCanvas. All user-visible strings including map legends, errors, accessibility names, empty states and scientific disclaimers use translation keys; both catalogs are complete and tested. Set document lang and dir dynamically (fa/rtl and en/ltr), mirror layout with logical CSS without reversing charts, coordinates or mathematical notation, and isolate bidirectional numeric/technical strings. Persist explicit language choice and choose a documented fallback. Format numbers, dates, UTC/timezone and units consistently without changing API values.

Make keyboard and screen-reader use, focus state, sufficient contrast, responsive layout, WebGL fallback and light/dark themes first-class. Persist or preserve filters on workspace switches where meaningful; indicate loading, unavailable outputs, synthetic data and research limitations. Future research controls must not appear functional before backend completion.

## Dependencies

roadscope-foundation; scientific controls depend on their respective completed API changes.

## Risks / Trade-offs

Automatic RTL mirroring can corrupt numeric coordinates or map controls; translations of scientific terminology require review. Visual inspiration must not imply unsupported example features.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
