# Design: usable and presentable scientific interface

## Inventory before implementation

Compare current six workspaces and tests with specific examples: Opus `methods`, `AccidentDetail`, `FilterPanel`, `Explorer`; DSV `FilterBar`, `AnalyticsDashboard`, `MapView`, and `TrackReport`; Gemini `MathematicalFormulationModal` and `CoordinatedAnalyticsDock`. Record implemented, partial, absent or unavailable and API prerequisites, with representative references. Inspect interactions, not just file names; do not assume example backend behavior is valid or production-ready. Keep existing map selection, cross-filter, exports and legends when present; do not claim new capabilities by relabeling them.

## Proposed interactions

- Add discoverable bilingual methods/help with short definitions, units, assumptions, source and limits of each exposed output. Link to detailed formulas if supported; distinguish illustrative synthetic output and model from calibrated evidence. Accessibility and small screens matter.
- Make a selected incident/road details panel keyboard accessible with close and explicit filter action; derive fields and state from existing API, show unknowns, permissions and provenance. For synthetic incident datasets show a persistent warning. Do not expose raw real citizen details: defer restricted behavior to citizen-reporting change.
- Consolidate active filters, show a localized summary and per-filter clear plus reset-all without changing backend semantics. Avoid silently clearing unrelated filters or selecting a hidden dataset. Preserve coordinate order and semantics in RTL.
- Improve chart-to-map coordination only where API-backed current fields and chart interactions support it. Provide visible selected states, keyboard alternatives and consistent handling of async updates; no fabricated charts or data. Define latest-request-wins and show errors or stale state, not stale values as fresh.
- Add a presentation view that preserves source, dataset, synthetic disclaimer, attribution, legend and filters while reducing visual clutter. Share presentation components/contracts with the Tehran change to prevent duplicate mode; screenshot is via browser unless CORS-compatible export is explicitly validated.

## Nonfunctional and migration

Maintain Persian/English and RTL/LTR, focus management, accessible names, responsive behavior and non-map fallback. Test each state and preserve existing endpoints and workspaces. Avoid leaking restricted report fields, new token persistence or implied access authority. If a feature relies on an unavailable API, clearly disable it with explanation. UI changes should be independently deployable/revertible; verify coordination if Tehran profile is absent. No default change to analytical filters without user-visible indication.
