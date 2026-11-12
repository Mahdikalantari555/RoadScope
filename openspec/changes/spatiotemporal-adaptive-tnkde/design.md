# Design

## Context

Static spatial bandwidth and time-window filtering conceal transient hotspots and do not select bandwidth from evidence (GAP-2).

## Goals / Non-Goals

**Goals:** Implement space-time NKDE with bounded adaptive bandwidths, reproducible leave-one-out selection, and time-slice playback.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Define a separable space-time intensity in crashes/(km·time) with explicit temporal kernel, window, integration and spatial network operator; time boundary correction and causal versus retrospective mode must be explicit. Use pilot density and bounded Abramson factors with specified floor. Select candidate h_s/h_t by leave-one-event-out log likelihood, remove all allocations for that event and account for exposure integral, numerical floor and ties. No future observations in prospective validation. Store search grid, chosen pair, objective and sampling coverage; handle insufficient events and disconnected topology without inventing an optimum. Link to existing asynchronous job/export model, with bounded resource use and status. Return time-indexed GeoJSON and uncertainty/method metadata for bilingual player; maintain legacy fixed NKDE.

## Dependencies

directed-network-diffusion; integrate vgi-bias-and-uncertainty when allocations and weights exist.

## Risks / Trade-offs

Bandwidth optimization can be expensive and sensitive to edge correction, sparse events and spatial leakage. Claims of better prediction require held-out data.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
