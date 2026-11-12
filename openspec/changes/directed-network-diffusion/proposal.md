# directed-network-diffusion

## Why

Undirected distance can transmit traffic influence across illegal turns, grade separation or against allowed flow (GAP-1).

## What Changes

Add versioned directed topology, turn restrictions and validated diffusion/advection on lixels while retaining existing undirected NKDE.

## Capabilities

### New Capabilities

- `directed-network-diffusion`: Add versioned directed topology, turn restrictions and validated diffusion/advection on lixels while retaining existing undirected NKDE.

### Modified Capabilities

None. These are proposed new specifications; they do not assert that the capability is already implemented.

## Impact

migrations, network_generator.py, spatial_lab.py, simulation, API and map layer metadata.

## Dependencies and scope

roadscope-foundation. Supplies network contract to TNKDE and Hawkes. See `IMPLEMENTATION_PLAN_FA.md` for sequencing. Out of scope: representing synthetic or unvalidated results as operational safety conclusions.
