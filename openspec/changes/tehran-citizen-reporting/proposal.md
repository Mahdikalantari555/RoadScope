# Tehran citizen reporting

## Why

Following the synthetic presentation, RoadScope should be able to collect real citizen crash reports on Tehran streets without confusing them with fabricated incidents or presenting unreviewed reports as verified facts.

## What Changes

Propose a separate, gated real-data reporting pilot: consent and minimal structured reports, map location with uncertainty and reviewable snapping, duplicate suggestions, secure status tracking, stewardship and privacy-preserving publication. Keep real and synthetic incidents in distinct datasets. Migration and access controls precede any real collection.

## Capabilities

### New Capabilities

- `tehran-citizen-reporting`: Secure collection, verification, publication and lifecycle of real community incident reports.

### Modified Capabilities

None; the existing synthetic VGI workflow remains a demo and does not establish production readiness.

## Impact

FastAPI authentication/authorization, database schema/migrations and transactional workflows, network matching, audit and privacy controls, frontend reporting/stewardship, deployment and testing. The Tehran network import from `tehran-synthetic-demo` is reusable only after review; real reports use a separate real dataset/database and real-data safeguards.

## Dependencies and open decisions

Requires a verified Tehran network, correct dataset CRS and bounds, data-owner and retention policy, threat model, legal/privacy review, target hosting/provider assessment and operational steward. Audience (restricted pilot vs public), identity and anti-abuse method, approved disclosure granularity and retention duration remain release gates; do not silently choose them. Interim safe default is no public write access and no public unverified reports. Photos, near-misses, emergency dispatch, uncalibrated risk claims and automated ground-truth verification are out of scope.
