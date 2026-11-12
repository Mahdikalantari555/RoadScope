"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { STUDY_AREA, type BBox, type GeoFeature, type GeoFeatureCollection, type GeoGeometry, type Position } from "@/lib/domain";
import { lonLatToUtm } from "@/lib/geo";
import { cx } from "./ui";
import { buildBasemapStyle, severityColorExpression, type BasemapId } from "./map-style";

export interface MapSelection {
  kind: "accident" | "segment" | "analysis";
  id: number | null;
  lon: number;
  lat: number;
  properties: Record<string, unknown>;
  geometry: GeoGeometry | null;
}

export interface CursorInfo {
  lon: number;
  lat: number;
  x: number;
  y: number;
  zoom: number;
}

export interface MapViewProps {
  basemap: BasemapId;
  points: GeoFeatureCollection | null;
  pointsMode: "points" | "clusters" | "heatmap" | "hidden";
  roads: GeoFeatureCollection | null;
  roadsMode: "base" | "value" | "hidden";
  analysis: GeoFeatureCollection | null;
  analysisKind: string | null;
  analysisOpacity?: number;
  highlight?: GeoFeatureCollection | null;
  selectedFeature?: GeoFeature | null;
  picked?: Position | null;
  pickMode?: boolean;
  fitBbox?: BBox | null;
  fitNonce?: number;
  focus?: { lon: number; lat: number; zoom?: number; nonce: number } | null;
  onSelect?: (sel: MapSelection | null) => void;
  onViewChange?: (bbox: BBox) => void;
  onCursor?: (c: CursorInfo | null) => void;
  onPick?: (lon: number, lat: number) => void;
  className?: string;
}

type Fc = GeoFeatureCollection;
const EMPTY: Fc = { type: "FeatureCollection", features: [] };
type DataSpec = maplibregl.GeoJSONSourceSpecification["data"];
const asData = (fc: Fc | null | undefined) => (fc ?? EMPTY) as unknown as DataSpec;

const POLYGON_LAYERS = ["kde", "gistar", "dbscan"];
const LINE_LAYERS = ["segment_aggregation", "spatial_comparison", "risk"];
const INTERACTIVE = ["clusters", "cluster-points", "flat-points", "analysis-fill", "analysis-line", "roads-base", "roads-value"];

function ensureSources(map: maplibregl.Map) {
  const add = (id: string, extra: Record<string, unknown> = {}) => {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY as unknown as DataSpec, ...extra } as maplibregl.GeoJSONSourceSpecification);
  };
  add("roads");
  add("analysis");
  add("points-cluster", { cluster: true, clusterRadius: 42, clusterMaxZoom: 13 });
  add("points-flat");
  add("highlight");
  add("selected");
  add("picked");
}

function ensureLayers(map: maplibregl.Map) {
  ensureSources(map);
  const add = (layer: Record<string, unknown>) => {
    if (!map.getLayer(layer.id as string)) map.addLayer(layer as unknown as maplibregl.LayerSpecification);
  };
  const pointPaint = {
    "circle-color": severityColorExpression(),
    "circle-stroke-color": ["case", ["==", ["get", "status"], "reported"], "#fbbf24", "#0a0e14"],
    "circle-stroke-width": ["case", ["==", ["get", "status"], "reported"], 1.6, 0.8],
    "circle-opacity": ["case", ["==", ["get", "status"], "verified"], 0.95, 0.5],
  };

  add({ id: "roads-base", type: "line", source: "roads", layout: { visibility: "visible" }, paint: {
    "line-color": ["match", ["get", "roadClass"], "arterial", "#cbd5e1", "collector", "#8593a6", "#4b5565"],
    "line-width": ["match", ["get", "roadClass"], "arterial", 3, "collector", 2, 1.1],
    "line-opacity": 0.9,
  } });
  add({ id: "roads-value", type: "line", source: "roads", layout: { visibility: "none" }, paint: {
    "line-color": ["coalesce", ["get", "color"], "#4b5565"],
    "line-width": ["coalesce", ["get", "width"], 2],
    "line-opacity": 0.95,
  } });
  add({ id: "analysis-fill", type: "fill", source: "analysis", filter: ["==", ["geometry-type"], "Polygon"], layout: { visibility: "none" }, paint: {
    "fill-color": ["coalesce", ["get", "color"], "#94a3b8"],
    "fill-opacity": ["coalesce", ["get", "opacity"], 0.5],
  } });
  add({ id: "analysis-line", type: "line", source: "analysis", filter: ["==", ["geometry-type"], "LineString"], layout: { visibility: "none" }, paint: {
    "line-color": ["coalesce", ["get", "color"], "#94a3b8"],
    "line-width": ["coalesce", ["get", "width"], 2],
    "line-opacity": 0.95,
  } });
  add({ id: "heat", type: "heatmap", source: "points-flat", layout: { visibility: "none" }, paint: {
    "heatmap-weight": ["interpolate", ["linear"], ["get", "severityWeight"], 1, 0.35, 20, 1],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 2],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 15, 28],
    "heatmap-opacity": 0.85,
    "heatmap-color": [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(0,0,0,0)", 0.2, "#1e3a8a", 0.4, "#0891b2", 0.6, "#facc15", 0.8, "#f97316", 1, "#fef2f2",
    ],
  } });
  add({ id: "clusters", type: "circle", source: "points-cluster", filter: ["has", "point_count"], layout: { visibility: "none" }, paint: {
    "circle-color": ["step", ["get", "point_count"], "#2dd4bf", 25, "#facc15", 100, "#f97316"],
    "circle-radius": ["step", ["get", "point_count"], 12, 25, 16, 100, 22],
    "circle-stroke-color": "#0a0e14",
    "circle-stroke-width": 1.5,
    "circle-opacity": 0.88,
  } });
  add({ id: "cluster-points", type: "circle", source: "points-cluster", filter: ["!", ["has", "point_count"]], layout: { visibility: "none" }, paint: {
    ...pointPaint,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 6],
    "circle-stroke-width": ["case", ["==", ["get", "status"], "reported"], 1.6, 0.8],
  } as Record<string, unknown> });
  add({ id: "flat-points", type: "circle", source: "points-flat", layout: { visibility: "none" }, paint: {
    ...pointPaint,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.5, 13, 5.5, 16, 8],
  } as Record<string, unknown> });
  add({ id: "selected-fill", type: "line", source: "selected", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#f8fafc", "line-width": 2 } });
  add({ id: "selected-line", type: "line", source: "selected", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f8fafc", "line-width": 4.5, "line-opacity": 0.95 } });
  add({ id: "highlight", type: "circle", source: "highlight", paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": "#2dd4bf", "circle-stroke-width": 2 } });
  add({ id: "picked", type: "circle", source: "picked", paint: { "circle-radius": 8, "circle-color": "#2dd4bf", "circle-stroke-color": "#03201c", "circle-stroke-width": 2.5 } });
}

function applyData(map: maplibregl.Map, p: MapViewProps) {
  const set = (id: string, data: Fc | null | undefined) => {
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    src?.setData(asData(data));
  };
  set("roads", p.roads);
  set("analysis", p.analysis);
  set("points-cluster", p.pointsMode === "hidden" ? EMPTY : p.points);
  set("points-flat", p.pointsMode === "hidden" ? EMPTY : p.points);
  set("highlight", p.highlight);
  set("picked", p.picked ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: p.picked }, properties: {} }] } : EMPTY);
  set("selected", p.selectedFeature ? { type: "FeatureCollection", features: [p.selectedFeature] } : EMPTY);
}

function applyVisibility(map: maplibregl.Map, p: MapViewProps) {
  const show = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  const kind = p.analysisKind ?? "";
  show("roads-base", p.roadsMode === "base");
  show("roads-value", p.roadsMode === "value");
  show("analysis-fill", POLYGON_LAYERS.includes(kind));
  show("analysis-line", LINE_LAYERS.includes(kind));
  show("heat", p.pointsMode === "heatmap");
  show("clusters", p.pointsMode === "clusters");
  show("cluster-points", p.pointsMode === "clusters");
  show("flat-points", p.pointsMode === "points");
}

function applyOpacity(map: maplibregl.Map, opacity: number) {
  if (map.getLayer("analysis-fill")) map.setPaintProperty("analysis-fill", "fill-opacity", ["*", ["coalesce", ["get", "opacity"], 0.5], opacity]);
  if (map.getLayer("analysis-line")) map.setPaintProperty("analysis-line", "line-opacity", opacity);
}

function toBBox(map: maplibregl.Map): BBox {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

export default function MapView(props: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const latest = useRef(props);
  const basemapRef = useRef(props.basemap);
  const lastFit = useRef<number>(-1);
  const lastFocus = useRef<number>(-1);

  useEffect(() => {
    latest.current = props;
  });

  // Map lifecycle: create once, register listeners once, and rebuild layers on every style load.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildBasemapStyle(latest.current.basemap),
      center: [STUDY_AREA.center.lon, STUDY_AREA.center.lat],
      zoom: 12.3,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

    map.on("style.load", () => {
      ensureLayers(map);
      applyData(map, latest.current);
      applyVisibility(map, latest.current);
      applyOpacity(map, latest.current.analysisOpacity ?? 0.8);
    });

    map.on("click", (e) => {
      const p = latest.current;
      if (p.pickMode) {
        p.onPick?.(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      const layers = INTERACTIVE.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (hits.length === 0) {
        p.onSelect?.(null);
        return;
      }
      const hit = hits[0]!;
      const layer = hit.layer.id;
      const props = (hit.properties ?? {}) as Record<string, unknown>;
      if (layer === "clusters") {
        map.easeTo({ center: e.lngLat, zoom: map.getZoom() + 2 });
        return;
      }
      const geometry = (hit.geometry as GeoGeometry) ?? null;
      const base = { lon: e.lngLat.lng, lat: e.lngLat.lat, properties: props, geometry };
      if (layer === "cluster-points" || layer === "flat-points") {
        p.onSelect?.({ kind: "accident", id: Number(props.id), ...base });
      } else if (layer === "roads-base" || layer === "roads-value") {
        p.onSelect?.({ kind: "segment", id: Number(props.segmentId), ...base });
      } else {
        p.onSelect?.({ kind: "analysis", id: props.segmentId !== undefined ? Number(props.segmentId) : props.clusterId !== undefined ? Number(props.clusterId) : null, ...base });
      }
    });

    map.on("mousemove", (e) => {
      const p = latest.current;
      const [x, y] = lonLatToUtm(e.lngLat.lng, e.lngLat.lat);
      p.onCursor?.({ lon: e.lngLat.lng, lat: e.lngLat.lat, x, y, zoom: map.getZoom() });
      const layers = INTERACTIVE.filter((id) => map.getLayer(id));
      const hover = !p.pickMode && map.queryRenderedFeatures(e.point, { layers }).length > 0;
      map.getCanvas().style.cursor = p.pickMode || hover ? "pointer" : "";
    });
    map.on("mouseout", () => latest.current.onCursor?.(null));
    map.on("moveend", () => latest.current.onViewChange?.(toBBox(map)));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Data and display state follow props without re-creating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyData(map, props);
  }, [props.points, props.roads, props.analysis, props.highlight, props.selectedFeature, props.picked, props.pointsMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getLayer("roads-base")) applyVisibility(map, props);
  }, [props.pointsMode, props.roadsMode, props.analysisKind]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.getLayer("roads-base")) applyOpacity(map, props.analysisOpacity ?? 0.8);
  }, [props.analysisOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemapRef.current === props.basemap) return;
    basemapRef.current = props.basemap;
    map.setStyle(buildBasemapStyle(props.basemap), { diff: false });
  }, [props.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fitBbox || props.fitNonce === undefined || lastFit.current === props.fitNonce) return;
    lastFit.current = props.fitNonce;
    const [a, b, c, d] = props.fitBbox;
    map.fitBounds(
      [
        [a, b],
        [c, d],
      ],
      { padding: 48, duration: 700, maxZoom: 15 },
    );
  }, [props.fitBbox, props.fitNonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.focus || lastFocus.current === props.focus.nonce) return;
    lastFocus.current = props.focus.nonce;
    map.flyTo({ center: [props.focus.lon, props.focus.lat], zoom: props.focus.zoom ?? 15.5, duration: 900 });
  }, [props.focus]);

  return <div ref={containerRef} className={cx("relative h-full w-full", props.className)} aria-label="Interactive map" role="application" />;
}
