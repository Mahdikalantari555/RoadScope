# Tasks

## 1. Implementation and validation

- [ ] 1.1 Define and migrate SQLite direction, turn and provenance schema with explicit backward-compatible defaults; add PostGIS equivalent only if supported.
- [ ] 1.2 Generate directed lixel edge-state graph, restrictions, grade separation, cache versioning and validated input.
- [ ] 1.3 Implement separately labeled symmetric heat and directed conservative operator with documented solver, boundaries and diagnostics.
- [ ] 1.4 Expose explicit method parameters and provenance without changing the legacy NKDE default.
- [ ] 1.5 Test analytical line/Y cases, illegal turns, one-way, bridge, disconnected graphs, zero mass, conservation and nonnegativity at solver tolerances.
- [ ] 1.6 Benchmark runtime/memory across graph sizes; document assumptions, numerical error and bilingual UI integration.

## Implementation evidence

See [the per-change implementation ledger](../../../docs/IMPLEMENTATION_STATUS.md) for delivered primitives, tests and outstanding acceptance work. Partial sub-tasks are not marked complete and this change is not archived.
