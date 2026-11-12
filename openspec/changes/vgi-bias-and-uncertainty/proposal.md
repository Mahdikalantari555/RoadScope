# vgi-bias-and-uncertainty

## Why

Winner-only snap and uncorrected reporting propensities hide positional and selection uncertainty (GAP-4/5).

## What Changes

Preserve and propagate event-level snap distributions, model reporting propensities only when identifiable, and diagnose bias without double-counting witnesses.

## Capabilities

### New Capabilities

- `vgi-probabilistic-observation`: Preserve and propagate event-level snap distributions, model reporting propensities only when identifiable, and diagnose bias without double-counting witnesses.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

map_matching.py, stewardship.py, migrations, simulation, spatial_lab.py, risk_eb_engine.py, API and QA UI.

## Dependencies and scope

roadscope-foundation and directed-network-diffusion for topology; downstream TNKDE and safety integrate the shared event allocation contract. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
