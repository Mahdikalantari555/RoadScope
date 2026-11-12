# surrogate-safety-fusion

## Why

Rare observed crashes alone cannot characterize newly built roads or near misses (GAP-7).

## What Changes

Ingest privacy-preserving safety surrogate observations with coverage and fit a validated joint crash–surrogate research model.

## Capabilities

### New Capabilities

- `surrogate-safety`: Ingest privacy-preserving safety surrogate observations with coverage and fit a validated joint crash–surrogate research model.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

new ingestion/schema, risk services and API, simulator, localized safety UI, privacy and statistical dependencies.

## Dependencies and scope

safety-bayes-and-decisions and roadscope-foundation; benchmark integration follows reproducible-research-benchmarks. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
