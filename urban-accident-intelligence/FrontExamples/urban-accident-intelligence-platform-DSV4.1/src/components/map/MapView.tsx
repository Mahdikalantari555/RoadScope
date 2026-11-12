"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMapCtor,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from "maplibre-gl";
import type * as MapLibreTypes from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Crosshair, Layers2, MousePointerClick } from "lucide-react";
import { baseStyle, basemapColors, SEVERITY_COLORS, type BasemapVariant } from "./style";

export type MapMode = "points" | "clusters" | "heat" | "kde" | "hotspot" | "dbscan" | "segments" | "risk" | "environment" | "temporal";

export type MapFeatureCollection = GeoJSON.FeatureCollection;

export type NetworkPayload = {
  segments: MapFeatureCollection;
  intersections: MapFeatureCollection;
  water: MapFeatureCollection;
  parks: MapFeatureCollection;
  districts: MapFeatureCollection;
};

export type Viewport = {
  bbox: [number, number, number, number];
  zoom: number;
  center: { lat: number; lng: number };
};

type MapViewProps = {
  mode: MapMode;
  accidents: MapFeatureCollection | null;
  analysis?: MapFeatureCollection | null;
  segmentValues?: MapFeatureCollection | null;
  network?: NetworkPayload | null;
  basemap: BasemapVariant;
  toggles?: { roads?: boolean; districts?: boolean; water?: boolean; parks?: boolean; heat?: boolean; intersections?: boolean };
  selectedPublicId?: string | null;
  pickMode?: boolean;
  pickedLocation?: { lat: number; lng: number } | null;
  fitBounds?: [[number, number], [number, number]] | null;
  fitNonce?: number;
  legend?: { label: string; color: string }[];
  className?: string;
  showEmptyHint?: string | null;
  onSelectAccident?: (properties: Record<string, unknown>) => void;
  onSelectSegment?: (properties: Record<string, unknown>) => void;
  onPick?: (lat: number, lng: number) => void;
  onViewportChange?: (viewport: Viewport) => void;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function MapView({
  mode,
  accidents,
  analysis,
  segmentValues,
  network,
  basemap,
  toggles,
  selectedPublicId,
  pickMode = false,
  pickedLocation,
  fitBounds,
  fitNonce = 0,
  legend,
  className = "",
  showEmptyHint,
  onSelectAccident,
  onSelectSegment,
  onPick,
  onViewportChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);
  const [zoom, setZoom] = useState(11.4);
  const markersRef = useRef<Marker[]>([]);
  const callbacksRef = useRef({ onSelectAccident, onSelectSegment, onPick, onViewportChange, pickMode });
  callbacksRef.current = { onSelectAccident, onSelectSegment, onPick, onViewportChange, pickMode };
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMapCtor({
      container: containerRef.current,
      style: baseStyle(basemapRef.current),
      center: [4.951, 52.301],
      zoom: 11.4,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      maxBounds: [
        [4.62, 52.17],
        [5.28, 52.44],
      ],
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");

    map.on("load", () => {
      setReady(true);
    });

    map.on("mousemove", (event: { lngLat: { lat: number; lng: number } }) => {
      setCursor({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    map.on("zoom", () => setZoom(map.getZoom()));

    let timer: ReturnType<typeof setTimeout> | null = null;
    map.on("moveend", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const bounds = map.getBounds();
        const center = map.getCenter();
        callbacksRef.current.onViewportChange?.({
          bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          zoom: map.getZoom(),
          center: { lat: center.lat, lng: center.lng },
        });
      }, 220);
    });

    map.on("error", (event: { error?: { message?: string } }) => {
      if (!String(event?.error?.message ?? "").includes("glyph")) {
        console.warn("map warning", event?.error?.message);
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  /* ---------------------------------------------------- layer construction */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const colors = basemapColors(basemap);

    const ensureSource = (id: string, options: MapLibreTypes.SourceSpecification) => {
      if (!map.getSource(id)) map.addSource(id, options);
    };

    ensureSource("districts", { type: "geojson", data: EMPTY });
    ensureSource("parks", { type: "geojson", data: EMPTY });
    ensureSource("water", { type: "geojson", data: EMPTY });
    ensureSource("roads", { type: "geojson", data: EMPTY });
    ensureSource("intersections", { type: "geojson", data: EMPTY });
    ensureSource("accidents", {
      type: "geojson",
      data: EMPTY,
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 15,
    });
    ensureSource("analysis", { type: "geojson", data: EMPTY });
    ensureSource("segment-values", { type: "geojson", data: EMPTY });
    ensureSource("selected", { type: "geojson", data: EMPTY });
    ensureSource("picked", { type: "geojson", data: EMPTY });

    const addLayer = (layer: MapLibreTypes.LayerSpecification) => {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    };

    addLayer({
      id: "districts-fill",
      type: "fill",
      source: "districts",
      paint: { "fill-color": colors.districtFill, "fill-opacity": 0.55 },
    });
    addLayer({
      id: "parks-fill",
      type: "fill",
      source: "parks",
      paint: { "fill-color": colors.parkFill, "fill-opacity": 0.85 },
    });
    addLayer({
      id: "districts-line",
      type: "line",
      source: "districts",
      paint: { "line-color": colors.districtLine, "line-width": 0.9, "line-dasharray": [3, 3] },
    });
    addLayer({
      id: "water-fill",
      type: "fill",
      source: "water",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": colors.waterFill },
    });
    addLayer({
      id: "water-line",
      type: "line",
      source: "water",
      paint: { "line-color": colors.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 12] },
    });
    const roadLayers: { id: string; filter: MapLibreTypes.FilterSpecification; color: string; width: number[] }[] = [
      { id: "roads-local", filter: ["==", ["get", "roadClass"], "local"], color: colors.roadLocal, width: [10, 0.7, 14, 2.4, 17, 6] },
      { id: "roads-secondary", filter: ["==", ["get", "roadClass"], "secondary"], color: colors.roadSecondary, width: [10, 1.1, 14, 3.2, 17, 8] },
      { id: "roads-arterial", filter: ["==", ["get", "roadClass"], "arterial"], color: colors.roadArterial, width: [10, 1.7, 14, 4.6, 17, 11] },
      { id: "roads-ring", filter: ["==", ["get", "roadClass"], "ring"], color: colors.roadRing, width: [10, 2.2, 14, 5.6, 17, 13] },
    ];
    for (const road of roadLayers) {
      addLayer({
        id: road.id,
        type: "line",
        source: "roads",
        filter: road.filter,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": road.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], ...road.width] as MapLibreTypes.ExpressionSpecification,
        },
      });
    }
    addLayer({
      id: "intersections",
      type: "circle",
      source: "intersections",
      minzoom: 13,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.4, 17, 3.4],
        "circle-color": colors.intersection,
        "circle-stroke-color": colors.background,
        "circle-stroke-width": 0.6,
      },
    });
    addLayer({
      id: "segment-values-casing",
      type: "line",
      source: "segment-values",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#000000", "line-opacity": 0.35, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 17, 14] },
    });
    addLayer({
      id: "segment-values",
      type: "line",
      source: "segment-values",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "phase"], 0],
          0,
          "#164e63",
          30,
          "#0e7490",
          55,
          "#22d3ee",
          75,
          "#e3b341",
          90,
          "#f2762e",
          100,
          "#e5402a",
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 17, 11],
        "line-opacity": 0.92,
      },
    });
    addLayer({
      id: "accidents-heat",
      type: "heatmap",
      source: "accidents",
      maxzoom: 16,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 1, 0.4, 4, 1.2],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 15, 2.6],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 14, 13, 26, 16, 46],
        "heatmap-opacity": 0.82,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(6,18,26,0)",
          0.15,
          "#0e7490",
          0.35,
          "#22d3ee",
          0.55,
          "#e3b341",
          0.75,
          "#f2762e",
          1,
          "#e5402a",
        ],
      },
    });
    addLayer({
      id: "accidents-cluster",
      type: "circle",
      source: "accidents",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#0e7490", 12, "#0891b2", 40, "#0e7490", 120, "#e3b341"],
        "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 11, 30, 17, 120, 24, 400, 30],
        "circle-opacity": 0.82,
        "circle-stroke-color": "#67e8f9",
        "circle-stroke-width": 1,
      },
    });
    addLayer({
      id: "accidents-point",
      type: "circle",
      source: "accidents",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["case", ["==", ["get", "severity"], 4], 3.4, 1.9],
          14,
          ["case", ["==", ["get", "severity"], 4], 8, 4.6],
          18,
          ["case", ["==", ["get", "severity"], 4], 12, 7],
        ],
        "circle-color": [
          "match",
          ["get", "severity"],
          4,
          SEVERITY_COLORS[4],
          3,
          SEVERITY_COLORS[3],
          2,
          SEVERITY_COLORS[2],
          SEVERITY_COLORS[1],
        ],
        "circle-opacity": ["case", ["==", ["get", "status"], "reported"], 0.45, 0.9],
        "circle-stroke-color": ["case", ["==", ["get", "status"], "reported"], "#e3b341", "#04090f"],
        "circle-stroke-width": ["case", ["==", ["get", "status"], "reported"], 1.6, 0.5],
      },
    });
    addLayer({
      id: "analysis-fill",
      type: "fill",
      source: "analysis",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "coalesce",
          ["get", "color"],
          ["interpolate", ["linear"], ["coalesce", ["get", "phase"], 0], 0, "#0b1c2e", 25, "#0e7490", 55, "#22d3ee", 78, "#e3b341", 100, "#e5402a"],
        ],
        "fill-opacity": ["case", ["has", "size"], 0.18, 0.62],
      },
    });
    addLayer({
      id: "analysis-line",
      type: "line",
      source: "analysis",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "color"], ["interpolate", ["linear"], ["coalesce", ["get", "phase"], 0], 0, "#0e7490", 60, "#22d3ee", 80, "#e3b341", 100, "#e5402a"]],
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.4, 17, 11],
        "line-opacity": 0.94,
      },
    });
    addLayer({
      id: "analysis-circle-halo",
      type: "circle",
      source: "analysis",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "classification"], "isolated"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 14, 34],
        "circle-color": ["coalesce", ["get", "color"], "#22d3ee"],
        "circle-opacity": 0.14,
        "circle-blur": 1,
      },
    });
    addLayer({
      id: "analysis-circle",
      type: "circle",
      source: "analysis",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "noise"], true]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.2, 14, 7, 18, 10],
        "circle-color": ["coalesce", ["get", "color"], "#22d3ee"],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#04121a",
        "circle-stroke-width": 0.7,
      },
    });
    addLayer({
      id: "selected-halo",
      type: "circle",
      source: "selected",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 12, 15, 22],
        "circle-color": "#2dd4bf",
        "circle-opacity": 0.22,
      },
    });
    addLayer({
      id: "selected-dot",
      type: "circle",
      source: "selected",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4.6, 15, 8],
        "circle-color": "#5eead4",
        "circle-stroke-color": "#03110f",
        "circle-stroke-width": 1.4,
      },
    });
    addLayer({
      id: "picked-ring",
      type: "circle",
      source: "picked",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 11, 15, 20],
        "circle-color": "rgba(45,212,191,0.12)",
        "circle-stroke-color": "#2dd4bf",
        "circle-stroke-width": 2,
      },
    });

    const layers = map.getStyle().layers ?? [];
    for (const layer of layers) {
      if (layer.id === "analysis-circle" || layer.id === "picked-ring") {
        map.moveLayer(layer.id);
      }
    }

    // interactions
    const accidentClick = (event: MapLibreTypes.MapMouseEvent & { features?: MapLibreTypes.MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties ?? {};
      if (props.publicId) {
        callbacksRef.current.onSelectAccident?.(props as Record<string, unknown>);
        new Popup({ closeButton: false, offset: 10, maxWidth: "260px" })
          .setLngLat(event.lngLat)
          .setHTML(
            `<div style="font-weight:600;letter-spacing:.03em">${props.publicId}</div>` +
              `<div style="color:#93a5b8;font-size:11px;margin-top:2px">${String(props.category ?? "").replace(/_/g, " ")} · severity ${props.severity}</div>` +
              `<div style="color:#93a5b8;font-size:11px">${String(props.occurredAt ?? "").slice(0, 16).replace("T", " ")} UTC · ${props.status}</div>`,
          )
          .addTo(map);
      }
    };
    const segmentClick = (event: MapLibreTypes.MapMouseEvent & { features?: MapLibreTypes.MapGeoJSONFeature[] }) => {
      const feature = event.features?.[0];
      if (feature?.properties) callbacksRef.current.onSelectSegment?.(feature.properties as Record<string, unknown>);
    };
    map.on("click", "accidents-point", accidentClick);
    map.on("click", "accidents-cluster", (event) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: ["accidents-cluster"] })[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("accidents") as GeoJSONSource | undefined;
      if (clusterId !== undefined && source) {
        source.getClusterExpansionZoom(clusterId).then((nextZoom) => {
          map.easeTo({ center: event.lngLat, zoom: Math.min(nextZoom + 0.2, 17) });
        });
      }
    });
    map.on("click", "analysis-line", segmentClick);
    map.on("click", "segment-values", segmentClick);
    map.on("click", "analysis-circle", (event) => {
      const feature = event.features?.[0];
      if (feature?.properties) callbacksRef.current.onSelectAccident?.(feature.properties as Record<string, unknown>);
    });
    map.on("click", (event) => {
      if (!callbacksRef.current.pickMode) return;
      callbacksRef.current.onPick?.(event.lngLat.lat, event.lngLat.lng);
    });

    for (const layerId of ["accidents-point", "analysis-circle", "analysis-line", "segment-values"]) {
      map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
    }

    return () => {
      for (const layerId of ["accidents-point", "accidents-cluster", "analysis-line", "segment-values", "analysis-circle"]) {
        map.off("click", layerId, accidentClick);
      }
    };
    // layers are built once; data and paint are synchronised below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* ------------------------------------------------------------ paint + data */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const colors = basemapColors(basemap);
    const set = (layer: string, prop: string, value: unknown) => {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop as never, value as never);
    };
    set("background", "background-color", colors.background);
    set("districts-fill", "fill-color", colors.districtFill);
    set("parks-fill", "fill-color", colors.parkFill);
    set("districts-line", "line-color", colors.districtLine);
    set("water-fill", "fill-color", colors.waterFill);
    set("water-line", "line-color", colors.waterLine);
    set("roads-local", "line-color", colors.roadLocal);
    set("roads-secondary", "line-color", colors.roadSecondary);
    set("roads-arterial", "line-color", colors.roadArterial);
    set("roads-ring", "line-color", colors.roadRing);
    set("intersections", "circle-color", colors.intersection);
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("accidents") as GeoJSONSource | undefined;
    source?.setData(accidents ?? EMPTY);
    const selected = map.getSource("selected") as GeoJSONSource | undefined;
    const match = selectedPublicId && accidents
      ? accidents.features.filter((feature) => feature.properties?.publicId === selectedPublicId)
      : [];
    selected?.setData({ type: "FeatureCollection", features: match });
    const picked = map.getSource("picked") as GeoJSONSource | undefined;
    picked?.setData(
      pickedLocation
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [pickedLocation.lng, pickedLocation.lat] },
                properties: {},
              },
            ],
          }
        : EMPTY,
    );
  }, [accidents, selectedPublicId, pickedLocation, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("analysis") as GeoJSONSource | undefined)?.setData(analysis ?? EMPTY);
  }, [analysis, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("segment-values") as GeoJSONSource | undefined)?.setData(segmentValues ?? EMPTY);
  }, [segmentValues, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("roads") as GeoJSONSource | undefined)?.setData(network?.segments ?? EMPTY);
    (map.getSource("intersections") as GeoJSONSource | undefined)?.setData(network?.intersections ?? EMPTY);
    (map.getSource("water") as GeoJSONSource | undefined)?.setData(network?.water ?? EMPTY);
    (map.getSource("parks") as GeoJSONSource | undefined)?.setData(network?.parks ?? EMPTY);
    (map.getSource("districts") as GeoJSONSource | undefined)?.setData(network?.districts ?? EMPTY);

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (network) {
      const cityMarker = document.createElement("div");
      cityMarker.className = "map-label map-label-strong";
      cityMarker.textContent = "VANTIA — SYNTHETIC";
      const marker = new Marker({ element: cityMarker, anchor: "center" })
        .setLngLat([4.951, 52.301])
        .addTo(map);
      markersRef.current.push(marker);
      network.districts.features.slice(0, 12).forEach((feature) => {
        const props = (feature.properties ?? {}) as { name?: string; centroid?: { lat: number; lng: number } };
        if (!props.name || !props.centroid) return;
        const element = document.createElement("div");
        element.className = "map-label";
        element.textContent = props.name;
        markersRef.current.push(
          new Marker({ element, anchor: "center" }).setLngLat([props.centroid.lng, props.centroid.lat]).addTo(map),
        );
      });
    }
  }, [network, ready]);

  const visibility: Record<MapMode, Record<string, boolean>> = {
    points: { "accidents-point": true, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
    clusters: { "accidents-point": true, "accidents-cluster": true, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
    heat: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": true, "analysis-fill": false, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
    kde: { "accidents-point": true, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": true, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
    hotspot: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": true, "analysis-circle-halo": true },
    dbscan: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": true, "analysis-line": true, "analysis-circle": true, "analysis-circle-halo": false },
    segments: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": true, "analysis-circle": false, "analysis-circle-halo": false },
    risk: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
    environment: { "accidents-point": false, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": true, "analysis-circle-halo": false },
    temporal: { "accidents-point": true, "accidents-cluster": false, "accidents-heat": false, "analysis-fill": false, "analysis-line": false, "analysis-circle": false, "analysis-circle-halo": false },
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const base: Record<string, boolean> = {
      "districts-fill": toggles?.districts !== false,
      "districts-line": toggles?.districts !== false,
      "parks-fill": toggles?.parks !== false,
      "water-fill": toggles?.water !== false,
      "water-line": toggles?.water !== false,
      "roads-local": toggles?.roads !== false,
      "roads-secondary": toggles?.roads !== false,
      "roads-arterial": toggles?.roads !== false,
      "roads-ring": toggles?.roads !== false,
      intersections: toggles?.intersections !== false,
    };
    if (toggles?.heat === false && mode === "heat") base["accidents-heat"] = false;
    const modeVisibility = visibility[mode];
    const all = { ...base, ...modeVisibility };
    if (mode === "segments" || mode === "risk") {
      all["segment-values"] = true;
      all["segment-values-casing"] = true;
    } else {
      all["segment-values"] = false;
      all["segment-values-casing"] = false;
    }
    for (const [layerId, visible] of Object.entries(all)) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, toggles, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fitBounds) return;
    map.fitBounds(fitBounds, { padding: 48, duration: 650, maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce, ready, fitBounds?.[0]?.[0], fitBounds?.[0]?.[1], fitBounds?.[1]?.[0], fitBounds?.[1]?.[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  const zoomLabel = zoom.toFixed(2);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-[var(--surface)] ${className}`}>
      <div ref={containerRef} className="absolute inset-0" aria-label="Interactive accident map" />

      <div className="pointer-events-none absolute left-0 right-0 top-0 flex justify-between p-2">
        <div className="panel pointer-events-auto flex items-center gap-2 px-2 py-1 text-[10.5px] text-muted">
          <Layers2 size={12} className="text-accent" />
          <span className="label-caps">Mode</span>
          <span className="mono text-ink">{mode}</span>
          <span className="text-faint">|</span>
          <span className="mono text-ink">{accidents?.features.length ?? 0}</span>
          <span className="text-faint">pts loaded</span>
        </div>
        {pickMode && (
          <div className="panel pointer-events-auto flex items-center gap-1.5 border-accent px-2 py-1 text-[10.5px] text-accent">
            <MousePointerClick size={12} /> Click map to place incident
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-0 right-0 flex items-end justify-between gap-2 px-2">
        <div className="panel pointer-events-auto mono flex items-center gap-2 px-2 py-1 text-[10px] text-muted">
          <Crosshair size={11} className="text-accent" />
          <span>{cursor ? `${cursor.lat.toFixed(5)}, ${cursor.lng.toFixed(5)}` : "lat, lng"}</span>
          <span className="text-faint">| z {zoomLabel}</span>
          <span className="hidden text-faint sm:inline">| EPSG:4326</span>
        </div>
        {legend && legend.length > 0 && (
          <div className="panel pointer-events-auto max-w-[190px] px-2 py-1.5">
            <div className="label-caps mb-1">Legend</div>
            <div className="space-y-0.5">
              {legend.map((entry) => (
                <div key={entry.label} className="flex items-center gap-1.5 text-[10px] text-muted">
                  <span className="legend-swatch" style={{ background: entry.color }} />
                  <span className="truncate">{entry.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showEmptyHint && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="panel max-w-[280px] px-4 py-3 text-center">
            <div className="text-[12px] font-medium text-ink">{showEmptyHint}</div>
            <div className="mt-1 text-[11px] text-faint">Adjust filters or widen the date range to populate this layer.</div>
          </div>
        </div>
      )}
    </div>
  );
}
