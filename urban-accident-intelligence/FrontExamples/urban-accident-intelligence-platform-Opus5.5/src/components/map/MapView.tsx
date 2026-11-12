"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from "maplibre-gl";
import { toUtm } from "@/lib/geo/projection";
import { useApp } from "../providers";

export type BasemapKind = "synthetic" | "minimal" | "blueprint" | "none";
export type GeoJSONData = GeoJSON.FeatureCollection | GeoJSON.Feature;

const PALETTE = {
  dark: { bg: "#0d1117", water: "#0f2233", residential: "#141a22", commercial: "#1a1a24", industrial: "#191b1d", park: "#11201a", arterial: "#3a4352", collector: "#2b323d", local: "#222830", node: "#3a4352", label: "#7d8796", halo: "#0d1117" },
  light: { bg: "#eef0f2", water: "#c9dbe8", residential: "#e4e6ea", commercial: "#e8e3df", industrial: "#e0e0dd", park: "#d6e6d4", arterial: "#ffffff", collector: "#fbfbfc", local: "#f6f7f8", node: "#b8bec8", label: "#5d6675", halo: "#ffffff" },
  blueprint: { bg: "#0a1a2f", water: "#0d2440", residential: "#0a1a2f", commercial: "#0a1a2f", industrial: "#0a1a2f", park: "#0a1a2f", arterial: "#3f7cc0", collector: "#2c5a8e", local: "#1f4570", node: "#3f7cc0", label: "#7fa7d4", halo: "#0a1a2f" },
};

function palette(theme: "dark" | "light", kind: BasemapKind) {
  return kind === "blueprint" ? PALETTE.blueprint : PALETTE[theme];
}

const baseStyle = (bg: string): StyleSpecification => ({
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": bg } }],
});

export function applyBasemap(map: MLMap, theme: "dark" | "light", kind: BasemapKind) {
  const p = palette(theme, kind);
  const set = (id: string, prop: string, v: unknown) => map.getLayer(id) && map.setPaintProperty(id, prop as never, v as never);
  set("background", "background-color", p.bg);
  set("bm-water", "fill-color", p.water);
  set("bm-blocks", "fill-color", ["match", ["get", "kind"], "commercial", p.commercial, "industrial", p.industrial, "park", p.park, p.residential]);
  set("bm-roads", "line-color", ["match", ["get", "roadClass"], "arterial", p.arterial, "collector", p.collector, p.local]);
  set("bm-nodes", "circle-color", p.node);
  set("bm-labels", "text-color", p.label);
  set("bm-labels", "text-halo-color", p.halo);
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  vis("bm-blocks", kind === "synthetic");
  vis("bm-water", kind !== "none");
  vis("bm-roads", kind !== "none");
  vis("bm-nodes", kind === "synthetic" || kind === "blueprint");
  vis("bm-labels", kind !== "none");
}

export function upsertSource(map: MLMap, id: string, data: GeoJSONData, opts: Partial<maplibregl.GeoJSONSourceSpecification> = {}) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data, ...opts });
}

export function removeLayers(map: MLMap, ids: string[]) {
  for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
}

let baseCache: Promise<[GeoJSON.FeatureCollection, GeoJSON.FeatureCollection]> | null = null;
function loadBase() {
  if (!baseCache)
    baseCache = Promise.all([fetch("/api/basemap").then((r) => r.json()), fetch("/api/roads").then((r) => r.json())]).catch((e) => {
      baseCache = null;
      throw e;
    });
  return baseCache;
}

export function MapView({ onReady, basemap = "synthetic", className, children, cursor }: { onReady?: (map: MLMap) => void; basemap?: BasemapKind; className?: string; children?: ReactNode; cursor?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const { theme, meta } = useApp();
  const [coord, setCoord] = useState<{ lon: number; lat: number; e: number; n: number } | null>(null);
  const [zoom, setZoom] = useState(13);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const bmRef = useRef(basemap);
  bmRef.current = basemap;

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: baseStyle(palette(themeRef.current, bmRef.current).bg),
      center: [15.0, 45.137],
      zoom: 13,
      attributionControl: { compact: true, customAttribution: "Synthetic basemap © UAI generator" },
      maxZoom: 19,
      minZoom: 10,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-right");
    map.on("mousemove", (e) => {
      const [x, y] = toUtm(e.lngLat.lng, e.lngLat.lat);
      setCoord({ lon: e.lngLat.lng, lat: e.lngLat.lat, e: x, n: y });
    });
    map.on("zoomend", () => setZoom(map.getZoom()));
    map.on("load", () => {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      map.addSource("bm", { type: "geojson", data: empty });
      map.addSource("bm-roads", { type: "geojson", data: empty });
      map.addLayer({ id: "bm-water", type: "fill", source: "bm", filter: ["==", ["get", "kind"], "water"], paint: { "fill-color": "#0f2233" } });
      map.addLayer({ id: "bm-blocks", type: "fill", source: "bm", filter: ["all", ["!=", ["get", "kind"], "water"], ["==", ["geometry-type"], "Polygon"]], paint: { "fill-color": "#141a22", "fill-opacity": 0.95 } });
      map.addLayer({
        id: "bm-roads",
        type: "line",
        source: "bm-roads",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#333", "line-width": ["interpolate", ["linear"], ["zoom"], 12, ["match", ["get", "roadClass"], "arterial", 2.2, "collector", 1.4, 0.8], 17, ["match", ["get", "roadClass"], "arterial", 14, "collector", 9, 6]] },
      });
      map.addLayer({ id: "bm-nodes", type: "circle", source: "bm", minzoom: 15.5, filter: ["==", ["get", "kind"], "node"], paint: { "circle-radius": ["case", ["get", "signalized"], 3, 1.6], "circle-color": "#3a4352" } });
      map.addLayer({
        id: "bm-labels",
        type: "symbol",
        source: "bm-roads",
        minzoom: 14.5,
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Open Sans Regular"], "text-size": 10.5, "text-letter-spacing": 0.04 },
        paint: { "text-color": "#7d8796", "text-halo-color": "#0d1117", "text-halo-width": 1.2 },
      });
      applyBasemap(map, themeRef.current, bmRef.current);
      readyCb.current?.(map);
      loadBase()
        .then(([bm, roads]) => {
          (map.getSource("bm") as GeoJSONSource | undefined)?.setData(bm);
          (map.getSource("bm-roads") as GeoJSONSource | undefined)?.setData(roads);
        })
        .catch(() => undefined);
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (m && m.isStyleLoaded()) applyBasemap(m, theme, basemap);
  }, [theme, basemap]);

  const fitted = useRef(false);
  useEffect(() => {
    const m = mapRef.current;
    if (m && meta?.bounds && !fitted.current) {
      fitted.current = true;
      const [a, b, c, d] = meta.bounds;
      m.fitBounds([a, b, c, d], { padding: 40, duration: 0 });
    }
  }, [meta?.bounds]);

  useEffect(() => {
    const m = mapRef.current;
    if (m) m.getCanvas().style.cursor = cursor ?? "";
  }, [cursor]);

  return (
    <div className={`relative ${className ?? ""}`} style={{ background: "var(--map-bg)" }}>
      <div ref={el} className="absolute inset-0" />
      {children}
      <div className="absolute left-2 bottom-2 z-10 pointer-events-none num text-[10.5px] text-muted bg-panel/85 border border-line rounded-[3px] px-1.5 py-0.5 leading-4 backdrop-blur-sm">
        {coord ? (
          <>
            {coord.lat.toFixed(5)}°N {coord.lon.toFixed(5)}°E <span className="text-faint">| UTM33N</span> E {coord.e.toFixed(0)} N {coord.n.toFixed(0)} <span className="text-faint">| z{zoom.toFixed(1)}</span>
          </>
        ) : (
          <>EPSG:4326 · EPSG:32633 · z{zoom.toFixed(1)}</>
        )}
      </div>
    </div>
  );
}
