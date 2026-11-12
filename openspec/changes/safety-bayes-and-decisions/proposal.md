# safety-bayes-and-decisions

## Why

Existing EB ignores length-dependent dispersion and spatial borrowing and does not connect uncertainty to a defensible decision value (GAP-6/8).

## What Changes

Add length-aware NB-SPF/EB, CURE diagnostics, calibrated spatial BYM2, and decision analysis with explicit loss and value-of-information assumptions.

## Capabilities

### New Capabilities

- `uncertainty-aware-safety-decisions`: Add length-aware NB-SPF/EB, CURE diagnostics, calibrated spatial BYM2, and decision analysis with explicit loss and value-of-information assumptions.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

risk_eb_engine.py, analytical jobs and API, topology, migrations, RiskEbWorkspace, model dependencies and exports.

## Dependencies and scope

roadscope-foundation; vgi-bias-and-uncertainty for optional fractional inputs; directed-network-diffusion provides topology metadata. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
