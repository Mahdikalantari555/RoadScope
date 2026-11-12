# Frontend experience improvements

## Why

RoadScope already has six workspaces, map layers, legends, filters and research controls, but dense interactions and scattered explanations make it hard to understand and present. The former FrontExamples contained useful interface patterns (see the pinned historical source in `docs/FRONTEND_INTERACTION_INVENTORY.md`); they are alternatives, not a shared implementation or proof that all features exist in RoadScope.

## What Changes

Inventory selected example patterns against current behavior, then improve a methods/help view, map feature details, active-filter visibility, coordinated charts and presentation mode without duplicating existing capabilities or replacing working backend semantics. Implement the presentation integration against Tehran when that profile exists and retain support for Frankfurt. Explicitly document unavailable data and analysis limitations.

## Capabilities

### New Capabilities

- `frontend-experience-improvements`: Accessible scientific guidance, understandable map details and filters, linked views and honest presentation mode.

### Modified Capabilities

None; this change extends current workspaces without asserting that examples' backend features exist.

## Impact

React/Vite UI, localization, map and analytics interactions, accessible responsive components, tests and documentation. No automatic copy of Next.js examples, no new statistical models or change in backend authorization or real data collection.

## Dependencies and scope

Preserve `roadscope-experience` behavior and existing API contracts. Presentation mode may integrate with `tehran-synthetic-demo` but SHALL degrade gracefully without it; avoid duplicating that change's dataset-specific map setup. `tehran-citizen-reporting` owns real-report tracking and privacy; links to it are gated until implemented. Initial inventory and acceptance testing are part of this change because example features have not all been verified end to end. Prioritize improvements over full redesign.
