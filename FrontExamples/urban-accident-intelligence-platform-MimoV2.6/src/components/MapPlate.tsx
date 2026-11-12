"use client";

/**
 * MapPlate — the illuminated console plate.
 *
 * Rendered entirely from local vector data: the synthetic Meridian road network
 * plus analysis geometries produced by the laboratory. No external tile service
 * is contacted, so the map is deterministic and reproducible offline.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJsonFeature, GeoJsonFeatureCollection, Position } from "@/lib/types";
import { useApp, type Basemap, type MapLayerPayload } from "@/lib/appState";
import { SEVERITY_BY_CODE, STUDY_AREA, METRIC_CRS, TARGET_CRS } from "@/lib/constants";

const BASEMAPS: Record<
  Basemap,
  {
    label: string;
    bg: string;
    arterial: string;
    collector: string;
    local: string;
    casing: string;
    text: string;
  }
> = {
  plate: {
    label: "Console plate",
    bg: "#0b0e11",
    arterial: "#7e6a50",
    collector: "#4a4740",
    local: "#2f2e2b",
    casing: "#050709",
    text: "#5b6c78",
  },
  light: {
    label: "Paper plate",
    bg: "#eae5da",
    arterial: "#c9a877",
    collector: "#d5cdbc",
    local: "#e2dbcd",
    casing: "#ffffff",
    text: "#8b8375",
  },
  blueprint: {
    label: "Blueprint",
    bg: "#07121a",
    arterial: "#2e6f86",
    collector: "#1c4757",
    local: "#122e39",
    casing: "#030a0f",
    text: "#3f7f92",
  },
};

export interface MapPlateProps {
  roads: GeoJsonFeatureCollection;
  onCursor?: (c: { lon: number; lat: number; zoom: number }) => void;
  onMapClick?: (info: { lon: number; lat: number }) => void;
  pickMode?: boolean;
  pickedPoint?: { lon: number; lat: number } | null;
  height?: string;
}

interface OverlayLabel {
  lon: number;
  lat: number;
  text: string;
  kind: "district" | "street" | "cluster";
  size?: number;
}

export default function MapPlate({
  roads,
  onCursor,
  onMapClick,
  pickMode = false,
  pickedPoint = null,
  height = "100%",
}: MapPlateProps) {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(12.4);
  const [labels, setLabels] = useState<OverlayLabel[]>([]);
  const [scaleBar, setScaleBar] = useState({ width: 80, label: "1 km" });

  // --- static overlay label anchors (districts + arterial street names) ---
  const anchors = useMemo<OverlayLabel[]>(() => {
    const districtNames = [
      "NORTHGATE", "FOUNDRY QUARTER", "VESSEL HEIGHTS",
      "MERIDIAN CORE", "HARBOUR WARD", "ELLIS YARDS",
      "ALDER FIELDS", "SOUTHBANK", "WEIR ESTATE",
    ];
    const districtCentres: OverlayLabel[] = districtNames.map((text, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const xs = [13.3815, 13.4105, 13.4415];
      const ys = [52.5305, 52.5145, 52.4995];
      return { lon: xs[col], lat: ys[row], text, kind: "district" };
    });
    const streetNames = new Map<string, { lon: number; lat: number }>();
    for (const f of roads.features) {
      const p = f.properties as { roadClass: string; streetName: string };
      if (p.roadClass !== "arterial") continue;
      if (streetNames.has(p.streetName)) continue;
      const coords = (f.geometry as { coordinates: [number, number][] }).coordinates;
      streetNames.set(p.streetName, {
        lon: (coords[0][0] + coords[coords.length - 1][0]) / 2,
        lat: (coords[0][1] + coords[coords.length - 1][1]) / 2,
      });
    }
    const streets: OverlayLabel[] = [...streetNames.entries()].map(([text, c]) => ({
      ...c,
      text: text.toUpperCase(),
      kind: "street",
    }));
    return [...districtCentres, ...streets];
  }, [roads]);

  // --- cluster computation (screen-independent metric grid) -------------
  const clusters = useMemo(() => {
    const pts = app.filtered;
    const cellDeg = 0.0042;
    const buckets = new Map<string, { lon: number; lat: number; n: number; ids: number[] }>();
    for (const a of pts) {
      const key = `${Math.floor(a.lon / cellDeg)}:${Math.floor(a.lat / cellDeg)}`;
      const b = buckets.get(key);
      if (b) {
        b.lon += a.lon;
        b.lat += a.lat;
        b.n += 1;
        b.ids.push(a.id);
      } else {
        buckets.set(key, { lon: a.lon, lat: a.lat, n: 1, ids: [a.id] });
      }
    }
    const out: OverlayLabel[] = [];
    const features: GeoJsonFeature[] = [];
    for (const b of buckets.values()) {
      const lon = b.lon / b.n;
      const lat = b.lat / b.n;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] as Position },
        properties: { count: b.n, ids: b.ids.slice(0, 400) },
      });
      out.push({ lon, lat, text: String(b.n), kind: "cluster", size: b.n });
    }
    return {
      labels: out,
      data: { type: "FeatureCollection", features } as GeoJsonFeatureCollection,
    };
  }, [app.filtered]);

  const accidentsGeoJson = useMemo<GeoJsonFeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: app.filtered.map((a): GeoJsonFeature => ({
        type: "Feature",
        id: a.id,
        geometry: { type: "Point", coordinates: [a.lon, a.lat] as Position },
        properties: {
          id: a.id,
          severityCode: a.severityCode,
          categoryCode: a.categoryCode,
          status: a.status,
          publicId: a.publicId,
          occurredAt: a.occurredAt,
          vehicles: a.vehicles,
          streetName: a.streetName ?? "—",
          accuracy: a.positionalAccuracyM,
        },
      })),
    }),
    [app.filtered],
  );

  const layer: MapLayerPayload | null = app.layer;

  // Live view of overlay inputs so the move handler never reads stale data.
  const overlayData = useRef({ anchors, clusters, mode: app.mapMode });
  overlayData.current = { anchors, clusters, mode: app.mapMode };

  // --- map initialisation ------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const bm = BASEMAPS[app.basemap];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(bm, roads, accidentsGeoJson, clusters.data, layer),
      center: [13.412, 52.5145],
      zoom: 12.4,
      minZoom: 10,
      maxZoom: 19,
      attributionControl: { compact: true },
      hash: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => setReady(true));
    map.on("mousemove", (e) => {
      onCursor?.({ lon: e.lngLat.lng, lat: e.lngLat.lat, zoom: map.getZoom() });
      // Cursor affordance — guarded because layers are rebuilt on basemap swap.
      try {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ["accidents-circle", "roads-core"].filter((id) => !!map.getLayer(id)),
        });
        map.getCanvas().style.cursor = hits.length ? (pickMode ? "crosshair" : "pointer") : pickMode ? "crosshair" : "";
      } catch {
        map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
      }
    });
    map.on("zoom", () => setZoom(map.getZoom()));
    map.on("move", () => updateOverlay(map));
    map.on("click", (e) => {
      if (pickMode) {
        onMapClick?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }
      try {
        const layerIds = ["accidents-circle", "accidents-clusters", "roads-core"].filter((id) =>
          !!map.getLayer(id),
        );
        const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
        const accHit = hits.find((h) => h.layer.id !== "roads-core");
        if (accHit) {
          const p = accHit.properties as Record<string, string>;
          if (p.count && !p.id) {
            map.easeTo({ center: e.lngLat, zoom: Math.min(17, map.getZoom() + 1.6), duration: 520 });
          } else if (p.id) {
            app.setSelection({ kind: "accident", id: Number(p.id) });
          }
          return;
        }
        const segHit = hits.find((h) => h.layer.id === "roads-core");
        if (segHit) {
          const p = segHit.properties as Record<string, string>;
          if (p.id) {
            app.setSelection({ kind: "segment", id: Number(p.id) });
            return;
          }
        }
      } catch {
        /* layers are being rebuilt — ignore */
      }
      onMapClick?.({ lon: e.lngLat.lng, lat: e.lngLat.lat });
    });

    function updateOverlay(m: maplibregl.Map) {
      const w = m.getContainer().clientWidth;
      const h = m.getContainer().clientHeight;
      const out: OverlayLabel[] = [];
      const z = m.getZoom();
      const { anchors: anchorList, clusters: clusterList, mode } = overlayData.current;
      for (const a of anchorList) {
        if (a.kind === "district" && z < 11.2) continue;
        if (a.kind === "street" && z < 13.4) continue;
        const p = m.project([a.lon, a.lat]);
        if (p.x < -80 || p.y < -20 || p.x > w + 80 || p.y > h + 20) continue;
        out.push(a);
      }
      if (mode === "clusters") {
        for (const c of clusterList.labels) {
          const p = m.project([c.lon, c.lat]);
          if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) continue;
          out.push(c);
        }
      }
      setLabels(out.map((a) => ({ ...a, ...pixelOf(m, a) })).map((a) => ({ ...a })) as OverlayLabel[]);
    }
    overlayRef.current = () => updateOverlay(map);
    // initial overlay after style settles
    const t = setTimeout(() => updateOverlay(map), 300);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- refresh overlay labels when data or mode changes -----------------
  useEffect(() => {
    const t = setTimeout(() => overlayRef.current?.(), 60);
    return () => clearTimeout(t);
  }, [app.mapMode, clusters, app.filtered.length, ready]);

  // --- basemap switching (cross-fade via setStyle) -----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildStyle(BASEMAPS[app.basemap], roads, accidentsGeoJson, clusters.data, layer));
    map.once("styledata", () => {
      applyData(map, roads, accidentsGeoJson, clusters.data, layer);
      setReady(true);
    });
  }, [app.basemap]);

  // --- data updates ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyData(map, roads, accidentsGeoJson, clusters.data, layer);
  }, [ready, roads, accidentsGeoJson, clusters.data, layer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const l = map.getLayer("accidents-circle");
    if (!l) return;
    const visible = app.mapMode === "points";
    map.setLayoutProperty("accidents-circle", "visibility", visible ? "visible" : "none");
    map.setLayoutProperty("accidents-glow", "visibility", visible ? "visible" : "none");
    const cl = map.getLayer("accidents-clusters");
    if (cl) map.setLayoutProperty("accidents-clusters", "visibility", app.mapMode === "clusters" ? "visible" : "none");
    const af = map.getLayer("analysis-fill");
    if (af) map.setLayoutProperty("analysis-fill", "visibility", layer?.data ? "visible" : "none");
    const al = map.getLayer("analysis-line");
    if (al) map.setLayoutProperty("analysis-line", "visibility", layer?.data ? "visible" : "none");
  }, [app.mapMode, ready, layer]);

  // --- selection fly-to + highlight -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !app.selection) return;
    const hit =
      app.selection.kind === "accident"
        ? app.filtered.find((a) => a.id === app.selection!.id)
        : app.segments.find((s) => s.id === app.selection!.id);
    if (!hit) return;
    const lon = app.selection.kind === "accident" ? (hit as { lon: number }).lon : (hit as { centroidLon: number }).centroidLon;
    const lat = app.selection.kind === "accident" ? (hit as { lat: number }).lat : (hit as { centroidLat: number }).centroidLat;
    if (map.getZoom() < 14.6) map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14.8), duration: 620 });
    else map.easeTo({ center: [lon, lat], duration: 420 });
  }, [app.selection]);

  // --- picked point marker (reporting workflow) -------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("picked") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: pickedPoint
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [pickedPoint.lon, pickedPoint.lat] },
              properties: {},
            },
          ]
        : [],
    });
    if (pickedPoint) map.easeTo({ center: [pickedPoint.lon, pickedPoint.lat], zoom: 15.6, duration: 500 });
  }, [pickedPoint, ready]);

  // --- scale bar ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const w = map.getContainer().clientWidth;
      const c = map.getContainer().getBoundingClientRect();
      const left = map.unproject([0, c.top + 20]);
      const right = map.unproject([100, c.top + 20]);
      const metresPer100px = haversine(left.lat, left.lng, right.lat, right.lng);
      const targets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000];
      const target = targets.find((t) => t / metresPer100px * 100 > 60) ?? 25000;
      const px = (target / metresPer100px) * 100;
      setScaleBar({ width: Math.round(px), label: target >= 1000 ? `${target / 1000} km` : `${target} m` });
      void w;
    };
    map.on("move", update);
    update();
    return () => {
      map.off("move", update);
    };
  }, [ready]);

  const bm = BASEMAPS[app.basemap];

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" style={{ cursor: pickMode ? "crosshair" : undefined }} />

      {/* overlay labels — engraved type on the plate, never baked into tiles */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((l, i) => (
          <div
            key={`${l.text}-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-[IBM_Plex_Mono,monospace]"
            style={{
              left: (l as unknown as { x: number }).x,
              top: (l as unknown as { y: number }).y,
              fontSize: l.kind === "district" ? 9 : l.kind === "cluster" ? 10 : 8.5,
              letterSpacing: l.kind === "cluster" ? "0.02em" : "0.22em",
              color: l.kind === "cluster" ? "#ffd9a0" : bm.text,
              opacity: l.kind === "cluster" ? 0.95 : 0.85,
              background: l.kind === "cluster" ? "rgba(11,14,17,0.82)" : "transparent",
              border: l.kind === "cluster" ? "1px solid rgba(242,160,61,0.45)" : "none",
              borderRadius: l.kind === "cluster" ? "50%" : 0,
              padding: l.kind === "cluster" ? "3px 5px" : 0,
              textShadow: "0 1px 3px rgba(0,0,0,0.75)",
            }}
          >
            {l.text}
          </div>
        ))}
      </div>

      {/* corner readouts */}
      <div className="pointer-events-none absolute right-2 bottom-2 flex flex-col items-end gap-1">
        <div className="border border-[var(--rule)] bg-[var(--panel)]/85 px-2 py-1 backdrop-blur-sm">
          <div className="micro">CRS</div>
          <div className="tnum text-[9px] text-[var(--text-2)]">{TARGET_CRS}</div>
          <div className="tnum text-[9px] text-[var(--text-3)]">{METRIC_CRS}</div>
        </div>
        <div className="flex items-center gap-2 border border-[var(--rule)] bg-[var(--panel)]/85 px-2 py-1">
          <div className="relative h-[6px] border-x border-b border-[var(--text-3)]" style={{ width: scaleBar.width }}>
            <div className="absolute left-1/2 top-0 h-full w-px bg-[var(--text-3)]" />
          </div>
          <span className="tnum text-[9px] text-[var(--text-2)]">{scaleBar.label}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute left-2 top-2 border border-[var(--rule)] bg-[var(--panel)]/85 px-2 py-1">
        <div className="micro">Study area</div>
        <div className="text-[11px] font-semibold tracking-[0.08em] text-[var(--amber)]">{STUDY_AREA.toUpperCase()}</div>
        <div className="tnum text-[9px] text-[var(--text-3)]">z {zoom.toFixed(2)} · {app.filtered.length} features</div>
      </div>

      {layer?.loading && (
        <div className="absolute inset-x-0 top-0 h-[2px] overflow-hidden bg-[var(--rule)]">
          <div className="sweep relative h-full w-full" />
        </div>
      )}
    </div>
  );
}

function pixelOf(map: maplibregl.Map, a: OverlayLabel) {
  const p = map.project([a.lon, a.lat]);
  return { x: p.x, y: p.y } as unknown as Partial<OverlayLabel>;
}

function haversine(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371008.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function severityExpression(): maplibregl.ExpressionSpecification {
  return [
    "match",
    ["get", "severityCode"],
    "fatal", SEVERITY_BY_CODE.fatal.colour,
    "serious", SEVERITY_BY_CODE.serious.colour,
    "slight", SEVERITY_BY_CODE.slight.colour,
    "damage_only", SEVERITY_BY_CODE.damage_only.colour,
    "#8fa3af",
  ] as maplibregl.ExpressionSpecification;
}

function buildStyle(
  bm: (typeof BASEMAPS)[Basemap],
  roads: GeoJsonFeatureCollection,
  accidents: GeoJsonFeatureCollection,
  clusters: GeoJsonFeatureCollection,
  layer: MapLayerPayload | null,
): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: "uai-console",
    sources: {
      roads: { type: "geojson", data: roads },
      accidents: { type: "geojson", data: accidents },
      clusters: { type: "geojson", data: clusters },
      analysis: { type: "geojson", data: layer?.data ?? { type: "FeatureCollection", features: [] } },
      picked: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": bm.bg } },
      {
        id: "roads-casing",
        type: "line",
        source: "roads",
        paint: {
          "line-color": bm.casing,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 13, 2.6, 16, 8, 19, 16],
          "line-opacity": 0.5,
        },
      },
      {
        id: "roads-core",
        type: "line",
        source: "roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "roadClass"],
            "arterial", bm.arterial,
            "collector", bm.collector,
            "local", bm.local,
            bm.local,
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 13, 1, 16, 3, 19, 6],
        },
      },
      {
        id: "analysis-fill",
        type: "fill",
        source: "analysis",
        paint: {
          "fill-color": ["coalesce", ["get", "fill"], "rgba(0,0,0,0)"],
          "fill-opacity": ["coalesce", ["get", "opacity"], 0.5],
          "fill-outline-color": ["coalesce", ["get", "stroke"], "rgba(0,0,0,0)"],
        },
      },
      {
        id: "analysis-line",
        type: "line",
        source: "analysis",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "lineColor"], ["coalesce", ["get", "fill"], "#4fd1c5"]],
          "line-width": ["coalesce", ["get", "width"], 1.5],
          "line-opacity": ["coalesce", ["get", "opacity"], 0.85],
          "line-blur": ["coalesce", ["get", "blur"], 0],
        },
      },
      {
        id: "accidents-glow",
        type: "circle",
        source: "accidents",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 16],
          "circle-color": severityExpression(),
          "circle-blur": 1.2,
          "circle-opacity": 0.22,
        },
      },
      {
        id: "accidents-circle",
        type: "circle",
        source: "accidents",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10, ["match", ["get", "severityCode"], "fatal", 3.2, "serious", 2.6, 2],
            14, ["match", ["get", "severityCode"], "fatal", 5.6, "serious", 4.6, 3.8],
            18, ["match", ["get", "severityCode"], "fatal", 9, "serious", 7.5, 6],
          ],
          "circle-color": severityExpression(),
          "circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 2, 0.6],
          "circle-stroke-color": "#0b0e11",
          "circle-opacity": [
            "match",
            ["get", "status"],
            "verified", 0.95,
            "pending", 0.55,
            "rejected", 0.22,
            "duplicate", 0.3,
            0.8,
          ],
        },
      },
      {
        id: "accidents-clusters",
        type: "circle",
        source: "clusters",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 11, 60, 26, 400, 38],
          "circle-color": "rgba(242,160,61,0.16)",
          "circle-stroke-color": "#f2a03d",
          "circle-stroke-width": 1.2,
        },
      },
      {
        id: "picked-marker",
        type: "circle",
        source: "picked",
        paint: {
          "circle-radius": 9,
          "circle-color": "rgba(242,160,61,0.2)",
          "circle-stroke-color": "#f2a03d",
          "circle-stroke-width": 2,
        },
      },
    ],
  };
}

function applyData(
  map: maplibregl.Map,
  roads: GeoJsonFeatureCollection,
  accidents: GeoJsonFeatureCollection,
  clusters: GeoJsonFeatureCollection,
  layer: MapLayerPayload | null,
) {
  const set = (id: string, data: GeoJsonFeatureCollection) => {
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
  };
  set("roads", roads);
  set("accidents", accidents);
  set("clusters", clusters);
  set("analysis", layer?.data ?? { type: "FeatureCollection", features: [] });
}
