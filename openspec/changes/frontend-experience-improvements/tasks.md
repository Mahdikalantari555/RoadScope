# Tasks

## 1. Inventory and design
- [x] 1.1 Inventory relevant FrontExamples and current workspaces/API flows with evidence; record existing, partial, absent and unsupported interactions.
- [x] 1.2 Define interaction and accessibility design for methods, feature details, filter summary, supported linked charts and presentation mode; preserve current behavior.
- [ ] 1.3 Agree shared presentation contract with `tehran-synthetic-demo`, including dataset provenance, attribution and screenshots; keep profiles independent.

## 2. Implementation
- [x] 2.1 Add bilingual methods/help guidance with units, assumptions, source and uncertainty for supported outputs.
- [x] 2.2 Add or improve accessible incident/road details using authorized available fields and missing-value states.
- [x] 2.3 Add active-filter summary, individual clearing and reset-all while keeping existing chart/map behavior consistent.
- [x] 2.4 Improve supported coordinated chart interactions and visible selection; handle request races, loading, stale and error states.
- [x] 2.5 Implement or reuse presentation mode with persistent dataset/synthetic/source/legend/filter context; support Frankfurt and optional Tehran.
- [x] 2.6 Complete Persian/English localization, RTL/LTR, responsive layouts, focus management and non-WebGL fallback; enforce existing privacy and role boundaries.

## 3. Validation and operations
- [x] 3.1 Test keyboard, focus, responsive views, RTL/LTR, localized states, selected-feature detail and no restricted-field leakage.
- [x] 3.2 Test filter clear/reset, chart-map synchronization, async races/errors and all existing workspace regressions.
- [x] 3.3 Test presentation and screenshot visibility of attribution and warnings across supported profiles, offline tiles and missing API states.
- [x] 3.4 Document existing patterns, limitations, user workflows, deployment and rollback of UI changes without database migration.
