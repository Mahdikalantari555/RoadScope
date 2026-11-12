# Tehran GraphML sample preparation (intermediate only)

This is **not** the Tehran RoadScope database import, full topology migration or a replacement for the Frankfurt dataset. The script creates a separate exchange JSON containing real OSM-derived line geometry and reproducible fictional points. Do not use its points as actual crash observations, and do not use its simplified street collection for routing or safety conclusions. Bidirectional reverse edges can be collapsed for sampling; the output is not a complete directed topology. It does not produce lixels or feed RoadScope analytics.

A small OSMnx sample obtained from [`liliarouhi/tehran-bike-routing`](https://github.com/liliarouhi/tehran-bike-routing) at commit `32252961020fa95426abfeea023b30415d4814d2` was inspected. It describes a 1.2 km area around 35.7036 N, 51.3517 E, **west of central Tehran**, not the confirmed central-Tehran pilot boundary. Its GraphML reports creation on 2025-12-16; the precise OSM snapshot timestamp and completeness are unknown. The repository states that street data are © OpenStreetMap contributors, ODbL. These facts do not establish fitness or current availability for production. Keep the network extract and derived dataset outside Git, preserve attribution and review ODbL obligations.

Example using GitHub CLI to obtain that specific sample (or use an appropriately sourced local GraphML):

```sh
mkdir -p /tmp/roadscope-tehran
gh api -H 'Accept: application/vnd.github.raw+json' \
  'repos/liliarouhi/tehran-bike-routing/contents/sample_data/small_tehran.graphml?ref=32252961020fa95426abfeea023b30415d4814d2' > /tmp/roadscope-tehran/graph.graphml
python scripts/prepare_tehran_sample.py /tmp/roadscope-tehran/graph.graphml \
  --source 'OSMnx sample liliarouhi/tehran-bike-routing@32252961020fa95426abfeea023b30415d4814d2' \
  --seed 42 --count 100 --output /tmp/roadscope-tehran/sample.json
```

To display this isolated sample in the app, set `ROADSCOPE_TEHRAN_PREVIEW_FILE=/tmp/roadscope-tehran/sample.json` when starting FastAPI, then choose **Tehran sample** in the app. Without that explicit setting, the preview is unavailable. The route is read-only and does not import into the database. The original Frankfurt database and analytical workspaces remain separate. The live OSM raster basemap requires browser internet access and is subject to the OSM tile policy; it can be switched off. The path above is illustrative, not included in Git.

Install the backend requirements first. The manifest records the exact SHA-256 and declares the incident data synthetic and the original network source. Source geometries use WGS84 (longitude, latitude); sampling lengths and interpolation use EPSG:32639 metres. `count` is a fixed illustrative sample size, not a model of crash frequency. Output should be backed up or discarded according to local policy; removing the external sample JSON and GraphML rolls back this preparation without modifying any database.

Before completing `tehran-synthetic-demo`, obtain the approved central-Tehran boundary and a versioned extract, implement the database/network topology and lixel import with explicit CRS isolation, verify direction/grades, integrate map, filters and analysis safely, and measure performance. Do not archive the change until its acceptance tasks have been verified.

## Screenshot verification (2026-11-12)

The presentation screenshot `docs/presentation/screenshots/tehran-synthetic-preview.png` was captured at 1440×900 using the configured sample and Persian UI. The browser environment could not reach online OSM tiles, so the screenshot intentionally shows the offline fallback and its warning, not a basemap. The network, synthetic points, provenance and attribution remain visible. A local Noto Sans Arabic font was supplied to the headless browser for Persian rendering. This is a visual-preview check, not validation of the analytical profile or proof that tiles are available to end users.

## Candidate central Tehran graph (visual prototype only)

A separate OSMnx driving graph covering Tehran is available from
[Tajasob/fuel-tanker-meeting-routing](https://github.com/Tajasob/fuel-tanker-meeting-routing/tree/a3bb5ecaa4f478cf771ef9bc6a9def344937ae9f).
The repository identifies the graph as an OSM extract from 2026-06-12. The code's
MIT license is not a substitute for OSM's ODbL obligations. Attribute OSM and
review database redistribution/share-alike obligations before deployment.
The pinned `data/road-network.zip` SHA-256 is
`fe46fab17d7d94d970ab267f334d9569a238c4477fb0c3d41f6fcf992c259017`.
A provisional rectangular pilot in central Tehran uses WGS84 bounds
west 51.40, south 35.68, east 51.44, north 35.72; this is an illustrative
selection, not an official administrative boundary. `extract_tehran_graph.py`
retains an edge only when both OSMnx endpoint nodes fall within the rectangle;
whole edge geometry can extend outside it and crossing roads are omitted. It
is therefore unsuitable as the final boundary-buffered analytical import.
It does not reconstruct intersections or preserve external links. Review the
area and topology before analytical use.

Example after downloading and verifying the pinned zip outside version control:

```sh
unzip road-network.zip -d /path/to/extract
python scripts/extract_tehran_graph.py /path/to/extract/real_city/data/tehran_drive.graphml \
  --bounds 51.40 35.68 51.44 35.72 --output /path/to/central.graphml
python scripts/prepare_tehran_sample.py /path/to/central.graphml \
  --source 'OSMnx Tehran drive graph, Tajasob/fuel-tanker-meeting-routing@a3bb5ecaa4f478cf771ef9bc6a9def344937ae9f, extracted 2026-06-12; node-bounded central sample' \
  --seed 42 --count 100 --output /path/to/central-demo.json
```

A local run yielded 4,392 nodes, 7,681 directed edges, 5,358 deduplicated
visual street geometries and 100 synthetic points. The GraphML output SHA-256
for that run was `73b61ace33f7060f6ad1e94990d3e75e28b0592d3770670a8cf678f9404b0c07`;
GraphML serialization may vary by library version. This bundle remains a
standalone visualization, not the default or an analysis-ready database.
Do not relabel or reproject the legacy database by changing `ROADSCOPE_CANONICAL_EPSG`; existing datasets retain their recorded CRS. The fictional simulator can generate a new EPSG:32639 dataset, but this is not the OSM analytical import and does not validate the candidate road network.
