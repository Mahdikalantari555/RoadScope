# Tasks

## 1. Inventory and design
- [ ] 1.1 Inventory relevant FrontExamples and current workspaces/API flows with evidence; record existing, partial, absent and unsupported interactions.
- [ ] 1.2 Define interaction and accessibility design for methods, feature details, filter summary, supported linked charts and presentation mode; preserve current behavior.
- [ ] 1.3 Agree shared presentation contract with `tehran-synthetic-demo`, including dataset provenance, attribution and screenshots; keep profiles independent.

## 2. Implementation
- [ ] 2.1 Add bilingual methods/help guidance with units, assumptions, source and uncertainty for supported outputs.
- [ ] 2.2 Add or improve accessible incident/road details using authorized available fields and missing-value states.
- [ ] 2.3 Add active-filter summary, individual clearing and reset-all while keeping existing chart/map behavior consistent.
- [ ] 2.4 Improve supported coordinated chart interactions and visible selection; handle request races, loading, stale and error states.
- [ ] 2.5 Implement or reuse presentation mode with persistent dataset/synthetic/source/legend/filter context; support Frankfurt and optional Tehran.
- [ ] 2.6 Complete Persian/English localization, RTL/LTR, responsive layouts, focus management and non-WebGL fallback; enforce existing privacy and role boundaries.

## 3. Validation and operations
- [ ] 3.1 Test keyboard, focus, responsive views, RTL/LTR, localized states, selected-feature detail and no restricted-field leakage.
- [ ] 3.2 Test filter clear/reset, chart-map synchronization, async races/errors and all existing workspace regressions.
- [ ] 3.3 Test presentation and screenshot visibility of attribution and warnings across supported profiles, offline tiles and missing API states.
- [ ] 3.4 Document existing patterns, limitations, user workflows, deployment and rollback of UI changes without database migration.
