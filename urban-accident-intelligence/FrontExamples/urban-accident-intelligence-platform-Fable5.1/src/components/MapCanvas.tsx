"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, MapMouseEvent, GeoJSONSource, LayerSpecification, ExpressionSpecification } from "maplibre-gl";
import { CLASS_COLORS } from "@/lib/colors";

export type FC = GeoJSON.FeatureCollection;
export interface Overlay { id: string; data: FC; type: "line" | "fill" | "circle"; paint: Record<string, unknown>; layout?: Record<string, unknown>; beforePoints?: boolean; interactive?: boolean }
interface Props {
  segments?: FC | null; segmentColor?: ExpressionSpecification | string; segmentWidth?: ExpressionSpecification | number; segmentOpacity?: number;
  points?: FC | null; pointColor?: ExpressionSpecification | string; pointRadius?: ExpressionSpecification | number; cluster?: boolean;
  overlays?: Overlay[]; markers?: FC | null; selectedSegmentIds?: number[]; fitBbox?: [number, number, number, number] | null;
  onMapClick?: (lngLat: [number, number]) => void; onSegmentClick?: (id: number, props: Record<string, unknown>) => void; onPointClick?: (id: number, props: Record<string, unknown>) => void; onOverlayClick?: (layerId: string, props: Record<string, unknown>) => void;
  boxMode?: boolean; onBox?: (bbox: [number, number, number, number] | null) => void; bbox?: [number, number, number, number] | null;
  showBasemap?: boolean; theme?: "dark" | "light"; hoverHtml?: (layer: string, props: Record<string, unknown>) => string | null; children?: ReactNode; className?: string;
}

const EMPTY: FC = { type: "FeatureCollection", features: [] };
const bboxPoly = (b: [number, number, number, number]): FC => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } }] });

export default function MapCanvas(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [coords, setCoords] = useState<string>("");
  const cbs = useRef(p); cbs.current = p;
  const overlayIds = useRef<Set<string>>(new Set());
  const dragStart = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const dark = (cbs.current.theme ?? "dark") === "dark";
    const map = new maplibregl.Map({
      container: el.current, center: [8.5417, 47.3769], zoom: 13.5, attributionControl: false, dragRotate: false,
      style: { version: 8, glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf", sources: {
        basemap: { type: "raster", tiles: [dark ? "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png" : "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© CARTO © OpenStreetMap" },
        segments: { type: "geojson", data: EMPTY }, selseg: { type: "geojson", data: EMPTY }, points: { type: "geojson", data: EMPTY, cluster: false }, pointsc: { type: "geojson", data: EMPTY, cluster: true, clusterRadius: 28, clusterMaxZoom: 14 }, markers: { type: "geojson", data: EMPTY }, bbox: { type: "geojson", data: EMPTY },
      }, layers: [
        { id: "bg", type: "background", paint: { "background-color": dark ? "#0b0e13" : "#f6f7f9" } },
        { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.35 }, layout: { visibility: cbs.current.showBasemap === false ? "none" : "visible" } },
        { id: "segments-casing", type: "line", source: "segments", paint: { "line-color": dark ? "#05070a" : "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 9] } },
        { id: "segments", type: "line", source: "segments", paint: { "line-color": ["match", ["get", "roadClass"], "arterial", CLASS_COLORS.arterial, "collector", CLASS_COLORS.collector, CLASS_COLORS.local], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 16, 6], "line-opacity": 0.9 } },
        { id: "overlay-anchor", type: "line", source: "selseg", paint: { "line-opacity": 0 } },
        { id: "selseg", type: "line", source: "selseg", paint: { "line-color": "#5ec8f2", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 10], "line-opacity": 0.9 } },
        { id: "bbox-fill", type: "fill", source: "bbox", paint: { "fill-color": "#5ec8f2", "fill-opacity": 0.08 } },
        { id: "bbox-line", type: "line", source: "bbox", paint: { "line-color": "#5ec8f2", "line-width": 1.5, "line-dasharray": [2, 2] } },
        { id: "clusters", type: "circle", source: "pointsc", filter: ["has", "point_count"], paint: { "circle-color": "#f2b55e", "circle-opacity": 0.75, "circle-stroke-color": "#000", "circle-stroke-width": 1, "circle-radius": ["step", ["get", "point_count"], 10, 10, 14, 50, 20, 200, 26] } },
        { id: "cluster-count", type: "symbol", source: "pointsc", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 10, "text-font": ["Open Sans Regular"] }, paint: { "text-color": "#111" } },
        { id: "points-unclustered", type: "circle", source: "pointsc", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#5ec8f2", "circle-radius": 3, "circle-stroke-color": "#000", "circle-stroke-width": 0.5 } },
        { id: "points", type: "circle", source: "points", paint: { "circle-color": "#5ec8f2", "circle-radius": 4, "circle-stroke-color": "#000", "circle-stroke-width": 0.6, "circle-opacity": 0.9 } },
        { id: "markers-fill", type: "fill", source: "markers", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["coalesce", ["get", "color"], "#f2b55e"], "fill-opacity": 0.18 } },
        { id: "markers-line", type: "line", source: "markers", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["coalesce", ["get", "color"], "#f2b55e"], "line-width": 2, "line-dasharray": [1, 1] } },
        { id: "markers", type: "circle", source: "markers", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["coalesce", ["get", "color"], "#f2b55e"], "circle-radius": ["coalesce", ["get", "radius"], 6], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } },
      ] },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    map.on("mousemove", (e: MapMouseEvent) => {
      setCoords(`${e.lngLat.lng.toFixed(5)}°, ${e.lngLat.lat.toFixed(5)}°`);
      if (cbs.current.boxMode && dragStart.current) { const a = dragStart.current; const b: [number, number] = [e.lngLat.lng, e.lngLat.lat]; (map.getSource("bbox") as GeoJSONSource).setData(bboxPoly([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])); return; }
      const layers = ["points", "points-unclustered", "selseg", ...[...overlayIds.current].filter((id) => true), "segments"].filter((l) => map.getLayer(l));
      const f = map.queryRenderedFeatures(e.point, { layers })[0];
      map.getCanvas().style.cursor = f || cbs.current.boxMode ? "crosshair" : "";
      if (f && cbs.current.hoverHtml) { const html = cbs.current.hoverHtml(f.layer.id, f.properties as Record<string, unknown>); if (html) { popup.setLngLat(e.lngLat).setHTML(html).addTo(map); return; } }
      popup.remove();
    });
    map.on("mousedown", (e: MapMouseEvent) => { if (cbs.current.boxMode) { e.preventDefault(); dragStart.current = [e.lngLat.lng, e.lngLat.lat]; } });
    map.on("mouseup", (e: MapMouseEvent) => {
      if (cbs.current.boxMode && dragStart.current) { const a = dragStart.current; dragStart.current = null; const b: [number, number] = [e.lngLat.lng, e.lngLat.lat]; const bb: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; if (Math.abs(bb[2] - bb[0]) < 1e-5) { cbs.current.onBox?.(null); (map.getSource("bbox") as GeoJSONSource).setData(EMPTY); } else cbs.current.onBox?.(bb); }
    });
    map.on("click", (e: MapMouseEvent) => {
      if (cbs.current.boxMode) return;
      const c = cbs.current;
      const pt = map.queryRenderedFeatures(e.point, { layers: ["points", "points-unclustered"].filter((l) => map.getLayer(l)) })[0];
      if (pt && c.onPointClick) { c.onPointClick(Number(pt.properties?.id ?? pt.id), pt.properties as Record<string, unknown>); return; }
      const cl = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      if (cl) { map.easeTo({ center: (cl.geometry as GeoJSON.Point).coordinates as [number, number], zoom: map.getZoom() + 1.5 }); return; }
      const ov = map.queryRenderedFeatures(e.point, { layers: [...overlayIds.current].filter((l) => map.getLayer(l)) })[0];
      if (ov && c.onOverlayClick) { c.onOverlayClick(ov.layer.id, ov.properties as Record<string, unknown>); return; }
      const seg = map.queryRenderedFeatures(e.point, { layers: ["segments"] })[0];
      if (seg && c.onSegmentClick) { c.onSegmentClick(Number(seg.properties?.id ?? seg.id), seg.properties as Record<string, unknown>); return; }
      c.onMapClick?.([e.lngLat.lng, e.lngLat.lat]);
    });
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const map = mapRef.current;
  // data updates
  useEffect(() => { if (ready && map) (map.getSource("segments") as GeoJSONSource).setData(p.segments ?? EMPTY); }, [ready, map, p.segments]);
  useEffect(() => { if (!ready || !map) return; const d = p.points ?? EMPTY; (map.getSource(p.cluster ? "pointsc" : "points") as GeoJSONSource).setData(d); (map.getSource(p.cluster ? "points" : "pointsc") as GeoJSONSource).setData(EMPTY); }, [ready, map, p.points, p.cluster]);
  useEffect(() => { if (ready && map) (map.getSource("markers") as GeoJSONSource).setData(p.markers ?? EMPTY); }, [ready, map, p.markers]);
  useEffect(() => { if (ready && map) (map.getSource("bbox") as GeoJSONSource).setData(p.bbox ? bboxPoly(p.bbox) : EMPTY); }, [ready, map, p.bbox]);
  useEffect(() => { if (!ready || !map || !p.segments) return; const ids = new Set(p.selectedSegmentIds ?? []); (map.getSource("selseg") as GeoJSONSource).setData({ type: "FeatureCollection", features: p.segments.features.filter((f) => ids.has(Number(f.id ?? (f.properties as { id?: number })?.id))) }); }, [ready, map, p.segments, p.selectedSegmentIds]);
  useEffect(() => { if (!ready || !map) return; if (p.segmentColor) map.setPaintProperty("segments", "line-color", p.segmentColor as never); if (p.segmentWidth) map.setPaintProperty("segments", "line-width", p.segmentWidth as never); map.setPaintProperty("segments", "line-opacity", p.segmentOpacity ?? 0.9); }, [ready, map, p.segmentColor, p.segmentWidth, p.segmentOpacity]);
  useEffect(() => { if (!ready || !map) return; for (const l of ["points", "points-unclustered"]) { if (p.pointColor) map.setPaintProperty(l, "circle-color", p.pointColor as never); if (p.pointRadius) map.setPaintProperty(l, "circle-radius", p.pointRadius as never); } }, [ready, map, p.pointColor, p.pointRadius]);
  useEffect(() => { if (ready && map) map.setLayoutProperty("basemap", "visibility", p.showBasemap === false ? "none" : "visible"); }, [ready, map, p.showBasemap]);
  useEffect(() => { if (ready && map && p.fitBbox) map.fitBounds([[p.fitBbox[0], p.fitBbox[1]], [p.fitBbox[2], p.fitBbox[3]]], { padding: 30, duration: 600 }); }, [ready, map, p.fitBbox]);
  useEffect(() => {
    if (!ready || !map) return;
    const wanted = new Set((p.overlays ?? []).map((o) => o.id));
    for (const id of [...overlayIds.current]) if (!wanted.has(id)) { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); overlayIds.current.delete(id); }
    for (const o of p.overlays ?? []) {
      if (!map.getSource(o.id)) map.addSource(o.id, { type: "geojson", data: o.data }); else (map.getSource(o.id) as GeoJSONSource).setData(o.data);
      if (!map.getLayer(o.id)) { map.addLayer({ id: o.id, type: o.type, source: o.id, paint: o.paint, layout: o.layout ?? {} } as LayerSpecification, o.beforePoints === false ? undefined : "selseg"); overlayIds.current.add(o.id); }
      else for (const [k, v] of Object.entries(o.paint)) map.setPaintProperty(o.id, k as never, v as never);
    }
  }, [ready, map, p.overlays]);

  return (
    <div className={`relative w-full h-full ${p.className ?? ""}`} style={{ background: "var(--map-bg)" }}>
      <div ref={el} className="absolute inset-0" />
      <div className="absolute bottom-1 right-1 mono text-[10px] px-1.5 py-0.5 rounded pointer-events-none" style={{ background: "var(--bg-1)", color: "var(--fg-1)", opacity: 0.9 }}>{coords || "WGS84 · EPSG:4326"}</div>
      {p.boxMode && <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--accent)", color: "#06121a" }}>Drag to draw a selection box · click to clear</div>}
      {p.children}
    </div>
  );
}
