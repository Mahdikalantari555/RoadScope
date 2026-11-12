# How to import a street-network extract

This guide covers importing a versioned, repeatable street network into RoadScope. The import
produces the **geometry and attributes** of a network. It does *not* produce traffic exposure,
calibrated risk or crash observations — those stay unavailable until real observations exist.

> Redistribution matters. Many street datasets (OpenStreetMap in particular) carry a licence such
> as ODbL. Record the licence and attribution you are entitled to redistribute under, and keep the
> extract file itself **out of Git**.

---

## 1. Prerequisites

| Requirement | Why |
|---|---|
| A `data_steward` bearer token | Network administration requires a steward |
| Demo mode **off** for real imports | Demo mode blocks all ingest mutations |
| A dataset with **no** existing network | Import refuses to overwrite an existing network |
| The extract as a local file or inline JSON | Remote URL fetching is disabled by design |

```bash
export ROADSCOPE_API=http://localhost:8000
export STEWARD_TOKEN='…'          # never commit this
```

## 2. Choose the input format

| Field | Format | When |
|---|---|---|
| `geojson` | GeoJSON `FeatureCollection` of `LineString` | Most portable |
| `graphml` | GraphML with `x`/`y` node keys | OSMnx exports |
| `extract_path` | **Absolute** path to a file on the **server** | Large extracts |

Inline payloads are capped by `ROADSCOPE_MAX_IMPORT_BYTES` (8 MiB by default). Anything larger must
be placed on the server and referenced with `extract_path`; relative paths and traversal are
rejected.

## 3. Profiles: which dataset may hold real data

A dataset's `profile_key` decides whether real reports and publication are even possible:

| Created how | `profile_key` |
|---|---|
| Synthetic/demo network | always `demo` (never promotable) |
| Real import while `ROADSCOPE_PROFILE=pilot` | `pilot` |
| Real import while `ROADSCOPE_PROFILE=demo` | `demo` — **cannot** be used for pilot intake |

So run the deployment that will hold real data with `ROADSCOPE_PROFILE=pilot`
(and ideally its own `ROADSCOPE_PROFILE_DB`). Then either create the dataset explicitly:

```bash
curl -X POST "$ROADSCOPE_API/api/v1/study-areas/tehran/datasets" \
  -H "Authorization: Bearer $STEWARD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Tehran OSM 2026-06","is_synthetic":false,"activate":false}'
# → {"dataset_id": 3, "crs_epsg": 32639, "profile_key": "pilot", …}
```

…or let the import create it (below). Note the `crs_epsg`: all metric values in the import are
expressed in that CRS.

## 4. Import

```bash
curl -X POST "$ROADSCOPE_API/api/v1/ingest/network/extract" \
  -H "Authorization: Bearer $STEWARD_TOKEN" -H 'Content-Type: application/json' \
  --data @- <<'JSON'
{
  "study_area_key": "tehran",
  "dataset_id": 3,
  "dataset_name": "Central Tehran OSM extract",
  "epsg_in": 4326,
  "extract_version": "tehran-osm-2026-06-12",
  "source_url": "https://www.openstreetmap.org/",
  "source_attribution": "© OpenStreetMap contributors",
  "license": "ODbL 1.0",
  "snapshot_date": "2026-06-12",
  "boundary_4326": [51.38600, 35.68700, 51.42600, 35.71700],
  "buffer_m": 250,
  "lixel_resolution_m": 25,
  "activate": true,
  "graphml": "<graphml …>"
}
JSON
```

Required-ish fields:
`epsg_in` (input CRS), `extract_version` (your snapshot label), `license`, `source_attribution`,
`snapshot_date`. Omitting `dataset_id` creates a new dataset automatically.

### Response you should read

```json
{
  "status": "imported",
  "idempotent": false,
  "dataset_id": 3,
  "epsg_in": 4326,
  "epsg_out": 32639,
  "segment_count": 1842,
  "node_count": 1503,
  "lixel_count": 14877,
  "rejected_count": 0,
  "excluded_outside_boundary": 12,
  "ambiguous_crossing_count": 37,
  "ambiguous_crossings": [
    { "edge_code_a": "IMP_E1", "edge_code_b": "IMP_E14",
      "kind": "grade_separated_crossing",
      "elevation_a": 0, "elevation_b": 1,
      "connection_created": false }
  ],
  "missing_attribute_count": 41,
  "coverage": {
    "nodes_total": 1503,
    "nodes_connected_to_a_segment": 1499,
    "isolated_nodes": 4,
    "segments_total": 1842,
    "segments_flagged_ambiguous": 61
  },
  "source_feature_ids_sample": ["way/12345", "…"],
  "provenance": { "checksum_sha256": "…", "license": "ODbL 1.0", "imported_at_utc": "…" }
}
```

| Field | Meaning | What to do |
|---|---|---|
| `ambiguous_crossings` | Geometries that cross without sharing a node | Review; `connection_created` is always `false` |
| `kind: grade_separated_crossing` | Different `layer`/`bridge` — correctly **not** joined | Nothing, this is correct |
| `kind: geometric_crossing_without_node` | Possibly a missing junction in the source | Check the source data |
| `isolated_nodes` | Nodes not part of any segment | Usually source noise |
| `missing_attribute_count` | Features with no name | Advisory: an attribute gap, not an invented value |

**Topology is never invented.** A bridge over a road does not become an intersection, and an
assumed direction is recorded as an assumption (`direction_source_detail`), not as an observation.

## 5. Verify

```bash
# Recorded extracts: licence, snapshot, checksum, counts
curl -s "$ROADSCOPE_API/api/v1/ingest/network/extracts?dataset_id=3" \
  -H "Authorization: Bearer $STEWARD_TOKEN" | python3 -m json.tool

# The network as the client sees it (4326 at the boundary)
curl -s "$ROADSCOPE_API/api/v1/network/layers?dataset_id=3&include_lixels=false" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['segments_geojson']['features']), 'segments')"

# Provenance the UI and screenshots must display
curl -s "$ROADSCOPE_API/api/v1/meta" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['presentation'], indent=1))"
```

A segment's properties include `source_feature_id`, `source_version`, `grade_source`,
`direction_source_detail` and `topology_ambiguous` — these are what the accessible segment-detail
panel shows.

## 6. Idempotence and re-import

- **Identical** document (same checksum) → `status: "unchanged"`, nothing is written, safe to retry.
- **Different** document for a dataset that already has a network → HTTP 422. Create a new dataset
  for a new snapshot; do not attempt to patch a network in place.
- To replace a network: import the new snapshot into a **new** dataset, verify it, then activate it.
  The old dataset stays queryable and keeps its own provenance.

## 7. What the import does *not* give you

- **No exposure.** No AADT, no vehicle-kilometres. `risk_mvkt` stays unavailable, and risk layers
  remain research-only until observed exposure exists.
- **No incidents.** The dataset has no crash observations, so counts are zero and the useful layers
  stay gated.
- **No calibration.** `calibration_status` starts at `uncalibrated` and stops at `research_only`;
  nothing in the import can raise it to `approved`.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `422 Unknown study area` | Typo, or the area has no definition | Check `GET /api/v1/study-areas` |
| `422 …existing network` | Dataset already has segments | New dataset, or reuse the identical extract |
| `422 Provide either an inline geojson payload or graphml` | Empty body | Send one of `geojson`, `graphml`, `extract_path` |
| `request entity too large` | Over the byte cap | Use `extract_path` |
| `403 … disabled in synthetic demo mode` | `ROADSCOPE_DEMO_MODE=true` | Turn demo mode off for real imports |
| Enabling `pilot_intake` fails with `requires a dataset created under the isolated 'pilot' profile` | The dataset is `demo`-profile (real import happened in a demo-mode process) | Re-import in a `ROADSCOPE_PROFILE=pilot` deployment; profiles are never rewritten |
| `401 Authentication required` | Missing/unknown token | Check `ROADSCOPE_API_TOKENS` |
| Everything is `not reported` in the UI | Input lacked `name`/`speed`/`lanes` | Correct at the source; the importer will not invent values |
