# spatiotemporal-adaptive-tnkde

## Why

Static spatial bandwidth and time-window filtering conceal transient hotspots and do not select bandwidth from evidence (GAP-2).

## What Changes

Implement space-time NKDE with bounded adaptive bandwidths, reproducible leave-one-out selection, and time-slice playback.

## Capabilities

### New Capabilities

- `adaptive-spatiotemporal-density`: Implement space-time NKDE with bounded adaptive bandwidths, reproducible leave-one-out selection, and time-slice playback.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

spatial_lab services, job schema/API, SpatialLabWorkspace and map; optional sparse numerical routines.

## Dependencies and scope

directed-network-diffusion; integrate vgi-bias-and-uncertainty when allocations and weights exist. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
