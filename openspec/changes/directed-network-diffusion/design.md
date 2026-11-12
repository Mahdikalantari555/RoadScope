# Design

## Context

Undirected distance can transmit traffic influence across illegal turns, grade separation or against allowed flow (GAP-1).

## Goals / Non-Goals

**Goals:** Add versioned directed topology, turn restrictions and validated diffusion/advection on lixels while retaining existing undirected NKDE.

**Non-Goals:** Claiming real-world calibration or completing other changes implicitly. Maintain the existing /api/v1 and user data during rollout.

## Decisions

Persist direction relative to ordered u→v (-1 reverse, 0 bidirectional, 1 forward) plus source/quality and legal turn restrictions tied to dataset and topology version. Migrate old data explicitly as assumed bidirectional, not as measured fact. Use edge-state transitions so turn restrictions and grade-separated topology survive lixel subdivision; invalidate caches on changes. Keep a symmetric metric-graph heat model (Kirchhoff/no-flux where appropriate) separate from a directed transport/diffusion operator; define flow units and orientation, boundary and mass conservation for each. Use a sparse length-weighted finite-volume formulation, document h-to-time calibration and solve using a validated implicit scheme; Crank–Nicolson can require a positivity condition, so reject unstable settings or use a positivity-preserving alternative. Do not assume sparse LU is O(M) or a fixed latency. Export parameter, operator, direction quality and solver diagnostics.

## Dependencies

roadscope-foundation. Supplies network contract to TNKDE and Hawkes.

## Risks / Trade-offs

Directed diffusion is a modeling assumption, not identical to symmetric metric-graph heat. Bad turn restrictions and unknown direction can bias results. Large sparse factorizations can be expensive.

## Migration and verification

Use versioned, backwards-compatible contracts and migrations where needed; preserve existing data and legacy behavior until replacement is tested. Include deterministic unit and integration tests, bilingual accessibility/error states for UI-facing behavior, documented provenance, and recovery or rollback steps appropriate to the change.
