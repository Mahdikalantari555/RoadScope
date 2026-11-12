"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  LayersControl,
  CircleMarker,
  Popup,
  Polygon,
  Polyline,
  useMap,
  useMapEvents,
  ScaleControl,
} from "react-leaflet";
import type { GeoJSON as GeoJSONType, Feature, LineString, Point, Polygon as PolyType } from "geojson";
import L from "leaflet";
import { useAppStore, type AnalysisResult } from "@/lib/store";

// Fix default marker icons for leaflet
// (We are using circle markers only so this is not strictly needed, but include for completeness)

function ZoomCapture({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({
    zoom: () => onZoom(map.getZoom()),
    load: () => onZoom(map.getZoom()),
  });
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  return null;
}

function MapEvents() {
  const map = useMap();
  const setSelectionBounds = useAppStore(s => s.setSelectionBounds);
  const openReportModal = useAppStore(s => s.openReportModal);

  useMapEvents({
    click(e) {
      // Hold shift to drop a report pin
      if (e.originalEvent.shiftKey) {
        openReportModal({ lon: e.latlng.lng, lat: e.latlng.lat });
      }
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    setSelectionBounds([
      [bounds.getSouth(), bounds.getWest()],
      [bounds.getNorth(), bounds.getEast()],
    ]);
    const onMove = () => {
      const b = map.getBounds();
      setSelectionBounds([
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ]);
    };
    map.on("moveend", onMove);
    map.on("zoomend", onMove);
    return () => {
      map.off("moveend", onMove);
      map.off("zoomend", onMove);
    };
  }, [map, setSelectionBounds]);

  return null;
}

// Color scale helpers
function viridis(t: number): string {
  // t in [0,1]
  t = Math.max(0, Math.min(1, t));
  // Stops of viridis approximated
  const stops = [
    [68, 1, 84],
    [72, 36, 117],
    [65, 68, 135],
    [53, 95, 141],
    [42, 120, 142],
    [33, 145, 140],
    [29, 169, 121],
    [55, 190, 96],
    [112, 209, 57],
    [189, 223, 38],
    [253, 231, 37],
  ];
  const idx = t * (stops.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const c0 = stops[Math.min(i, stops.length - 1)];
  const c1 = stops[Math.min(i + 1, stops.length - 1)];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
  return `rgb(${r},${g},${b})`;
}

function inferno(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0, 0, 4],
    [27, 11, 65],
    [74, 12, 107],
    [120, 28, 109],
    [163, 42, 93],
    [203, 65, 58],
    [231, 93, 28],
    [248, 138, 16],
    [252, 185, 22],
    [244, 225, 68],
    [252, 255, 164],
  ];
  const idx = t * (stops.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const c0 = stops[Math.min(i, stops.length - 1)];
  const c1 = stops[Math.min(i + 1, stops.length - 1)];
  return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
}

function roadClassColor(c: string): string {
  switch (c) {
    case "primary": return "#f97316";
    case "secondary": return "#fbbf24";
    case "tertiary": return "#94a3b8";
    case "residential": return "#475569";
    default: return "#64748b";
  }
}

function roadClassWidth(c: string, zoom: number): number {
  const base = Math.max(1, (zoom - 10) * 0.8);
  switch (c) {
    case "primary": return base * 2 + 2;
    case "secondary": return base * 1.6 + 1.5;
    case "tertiary": return base * 1.2 + 1;
    default: return base + 0.5;
  }
}

interface HotspotLixel {
  coordinates: [number, number][];
  value: number;
  pValue?: number;
  zScore?: number;
  clusterType?: string;
  groundTruth?: number;
  diff?: number;
  eb?: number;
  psi?: number;
}

function buildHotspotData(result: AnalysisResult | null): {
  lines: HotspotLixel[];
  maxValue: number;
  maxDiff: number;
} {
  if (!result || !result.lixelMeta) return { lines: [], maxValue: 0, maxDiff: 0 };
  const values = result.nkde ?? result.pkde ?? result.counts ?? result.giStar ?? [];
  const zScores = result.zScore;
  const pVals = result.pValue;
  const clusterTypes = result.clusterType;
  const diffs = result.diff;
  const ebMap = new Map<number, number>();
  const psiMap = new Map<number, number>();
  if (result.ebResults) {
    for (const ebr of result.ebResults) {
      // We need to map segmentId -> lixels by parent segment; use simple mapping via parentSegmentId
      // Here we will store by segment id and assign in the loop
    }
  }
  let maxV = 0;
  let maxD = 0;
  for (const v of values) if (Math.abs(v) > maxV) maxV = Math.abs(v);
  if (diffs) for (const d of diffs) if (Math.abs(d) > maxD) maxD = Math.abs(d);
  const lines: HotspotLixel[] = [];
  for (let i = 0; i < result.lixelMeta.length; i++) {
    const meta = result.lixelMeta[i];
    const v = values[i] ?? 0;
    const d = diffs?.[i];
    lines.push({
      coordinates: meta.coordinates as [number, number][],
      value: v,
      pValue: pVals?.[i],
      zScore: zScores?.[i],
      clusterType: clusterTypes?.[i],
      groundTruth: meta.groundTruthLambda ?? undefined,
      diff: d,
    });
  }
  return { lines, maxValue: maxV || 1, maxDiff: maxD || 1 };
}

export default function MapCanvas() {
  const [segments, setSegments] = useState<GeoJSONType | null>(null);
  const [nodes, setNodes] = useState<GeoJSONType | null>(null);
  const [accidents, setAccidents] = useState<GeoJSONType | null>(null);
  const [zoom, setZoom] = useState(13);
  const [center] = useState<[number, number]>([40.72, -73.95]);

  const showSegments = useAppStore(s => s.showSegments);
  const showNodes = useAppStore(s => s.showNodes);
  const showLixels = useAppStore(s => s.showLixels);
  const showAccidents = useAppStore(s => s.showAccidents);
  const showHotspots = useAppStore(s => s.showHotspots);
  const showClusters = useAppStore(s => s.showClusters);
  const accidentStatusFilter = useAppStore(s => s.accidentStatusFilter);
  const accidentSeverityFilter = useAppStore(s => s.accidentSeverityFilter);
  const analysisResult = useAppStore(s => s.analysisResult);
  const analysisType = useAppStore(s => s.analysisConfig.type);

  // Load data on mount and when filters change
  useEffect(() => {
    fetch("/api/network?layer=segments").then(r => r.json()).then(setSegments);
    fetch("/api/network?layer=nodes").then(r => r.json()).then(setNodes);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (accidentStatusFilter.length) params.set("statuses", accidentStatusFilter.join(","));
    if (accidentSeverityFilter.length) params.set("severities", accidentSeverityFilter.join(","));
    fetch(`/api/accidents?${params.toString()}`).then(r => r.json()).then(setAccidents);
  }, [accidentStatusFilter, accidentSeverityFilter]);

  // Reload segments when simulation re-runs: listen to simStats changes via a simple poll on sim runs
  const simStats = useAppStore(s => s.simStats);
  useEffect(() => {
    if (simStats) {
      fetch("/api/network?layer=segments").then(r => r.json()).then(setSegments);
      fetch("/api/network?layer=nodes").then(r => r.json()).then(setNodes);
      const params = new URLSearchParams();
      if (accidentStatusFilter.length) params.set("statuses", accidentStatusFilter.join(","));
      fetch(`/api/accidents?${params.toString()}`).then(r => r.json()).then(setAccidents);
    }
  }, [simStats]);

  const hotspot = useMemo(() => buildHotspotData(analysisResult), [analysisResult]);

  const segmentStyle = (feature: Feature) => {
    const props = feature.properties as { roadClass: string };
    return {
      color: roadClassColor(props.roadClass),
      weight: zoom < 13 ? 1 : roadClassWidth(props.roadClass, zoom),
      opacity: 0.55,
    };
  };

  return (
    <MapContainer
      center={center}
      zoom={13}
      style={{ height: "100%", width: "100%", background: "#0f172a" }}
      zoomControl={true}
      boxZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ScaleControl position="bottomleft" imperial={false} />
      <MapEvents />
      <ZoomCapture onZoom={setZoom} />
      <LayersControl position="topright" collapsed={false}>
        {showSegments && segments && (
          <LayersControl.Overlay checked name="Road Network">
            <GeoJSON
              key={`seg-${simStats?.segments ?? "init"}`}
              data={segments}
              style={segmentStyle as any}
              onEachFeature={(f, l) => {
                const p = f.properties as any;
                l.bindTooltip(
                  `<div style="font-size:11px">
                    <b>${p.roadClass?.toUpperCase()}</b> · ${Math.round(p.lengthMeters)}m<br/>
                    ${p.speedLimit} km/h · ${p.lanes} lanes<br/>
                    AADT: ${p.aadt?.toLocaleString() ?? "n/a"} v/day
                  </div>`,
                  { sticky: true }
                );
              }}
            />
          </LayersControl.Overlay>
        )}
        {showNodes && nodes && (
          <LayersControl.Overlay checked name="Intersections">
            <GeoJSON
              data={nodes}
              pointToLayer={(f, latlng) => L.circleMarker(latlng, {
                radius: 3,
                color: (f.properties as any).signalized ? "#10b981" : "#64748b",
                weight: 1,
                fillColor: (f.properties as any).signalized ? "#10b981" : "#334155",
                fillOpacity: 0.8,
              })}
            />
          </LayersControl.Overlay>
        )}
        {showAccidents && accidents && (
          <LayersControl.Overlay checked name="Accidents">
            <GeoJSON
              key={`acc-${(accidents as any)?.features?.length ?? 0}`}
              data={accidents}
              pointToLayer={(f, latlng) => {
                const p = f.properties as any;
                return L.circleMarker(latlng, {
                  radius: p.severityCode === "fatal" ? 6 : p.severityCode === "severe" ? 5 : p.severityCode === "injury" ? 4 : 3,
                  color: p.severityColor ?? "#fbbf24",
                  weight: 1,
                  fillColor: p.severityColor ?? "#fbbf24",
                  fillOpacity: p.status === "raw_vgi" ? 0.35 : 0.85,
                });
              }}
              onEachFeature={(f, l) => {
                const p = f.properties as any;
                const time = p.incidentTime ? new Date(p.incidentTime).toLocaleString() : "unknown";
                l.bindPopup(
                  `<h4>${p.severityLabel ?? "Incident"}</h4>
                  <div>
                    <b>Time:</b> ${time}<br/>
                    <b>Category:</b> ${p.categoryCode ?? "vehicle"}<br/>
                    <b>Vehicles/Peds/Cyclists:</b> ${p.vehicleCount ?? 0}/${p.pedestrianCount ?? 0}/${p.cyclistCount ?? 0}<br/>
                    ${p.fatalities ? `<b>Fatalities:</b> ${p.fatalities}<br/>` : ""}
                    ${p.injuries ? `<b>Injuries:</b> ${p.injuries}<br/>` : ""}
                    <b>Weather:</b> ${p.weather ?? "n/a"} &nbsp; <b>Lighting:</b> ${p.lightingCondition ?? "n/a"}<br/>
                    <b>Surface:</b> ${p.roadSurface ?? "n/a"}<br/>
                    <b>Credibility:</b> ${p.credibility != null ? (p.credibility * 100).toFixed(0) + "%" : "n/a"}<br/>
                    <b>Status:</b> <span class="badge badge-${p.status === "verified" || p.status === "synthetic_ground_truth" ? "success" : "warn"}">${p.status}</span>
                  </div>`
                );
              }}
            />
          </LayersControl.Overlay>
        )}
      </LayersControl>

      {/* Hotspot lixel layer */}
      {showHotspots && hotspot.lines.length > 0 && analysisType !== "benchmark" && (
        <HotspotLayer hotspot={hotspot} analysisType={analysisType} />
      )}

      {/* N-DBSCAN cluster hulls */}
      {showClusters && analysisResult?.clusters && analysisType === "ndbscan" && (
        <ClusterHullsLayer clusters={analysisResult.clusters} />
      )}

      {/* Shift-click hint */}
      <div className="absolute top-2 left-2 z-[500] panel px-2 py-1 text-[10px]" style={{ fontSize: 10 }}>
        <span className="text-cyan-400 font-semibold">SHIFT+CLICK</span> on map to submit a VGI report
      </div>
    </MapContainer>
  );
}

// ─── Hotspot layer component ───────────────────────────────────────────────

function HotspotLayer({ hotspot, analysisType }: {
  hotspot: ReturnType<typeof buildHotspotData>;
  analysisType: string;
}) {
  const map = useMap();
  useEffect(() => {
    const layers: L.Layer[] = [];
    for (const lix of hotspot.lines) {
      let color: string;
      let weight = 3;
      let opacity = 0.9;
      if (analysisType === "getis_ord") {
        // Only render statistically significant hot/cold spots
        if (lix.clusterType === "hot") {
          color = "#ef4444";
          weight = 4;
        } else if (lix.clusterType === "cold") {
          color = "#3b82f6";
          weight = 3;
        } else {
          color = "rgba(100,116,139,0.25)";
          weight = 1;
          opacity = 0.3;
        }
      } else if (analysisType === "compare_kde" && lix.diff !== undefined) {
        // Diverging: red = planar overestimates, blue = network overestimates
        const t = Math.max(-1, Math.min(1, lix.diff / hotspot.maxDiff));
        if (t > 0.05) {
          color = "#ef4444";
          const a = Math.abs(t);
          opacity = 0.3 + a * 0.7;
          weight = 2 + a * 4;
        } else if (t < -0.05) {
          color = "#3b82f6";
          const a = Math.abs(t);
          opacity = 0.3 + a * 0.7;
          weight = 2 + a * 4;
        } else {
          continue;
        }
      } else if (analysisType === "eb_risk") {
        // Render by EB estimate per segment - approximate via value if available
        const v = Math.abs(lix.value);
        const t = Math.min(1, v / hotspot.maxValue);
        color = inferno(t);
        weight = 2 + t * 5;
      } else {
        // NKDE or planar KDE: use viridis density
        const v = Math.abs(lix.value);
        const t = Math.min(1, v / hotspot.maxValue);
        color = viridis(t);
        weight = 2 + t * 5;
      }
      const latlngs = lix.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
      const poly = L.polyline(latlngs, { color, weight, opacity, lineCap: "butt" });
      let tooltip = analysisType === "getis_ord"
        ? `<b>Gi* Z:</b> ${lix.zScore?.toFixed(2) ?? ""} <b>p:</b> ${lix.pValue?.toFixed(3) ?? ""}<br/>${lix.clusterType}`
        : analysisType === "compare_kde"
        ? `<b>Δ (Network - Planar):</b> ${lix.diff?.toExponential(2) ?? ""}`
        : `<b>Density:</b> ${lix.value.toExponential(2)}`;
      if (lix.groundTruth != null) tooltip += `<br/><b>True λ:</b> ${lix.groundTruth.toFixed(3)}`;
      poly.bindTooltip(tooltip, { sticky: true, direction: "top" });
      poly.addTo(map);
      layers.push(poly);
    }
    return () => { layers.forEach(l => map.removeLayer(l)); };
  }, [map, hotspot, analysisType]);
  return null;
}

// ─── Cluster hulls ─────────────────────────────────────────────────────────

function ClusterHullsLayer({ clusters }: { clusters: NonNullable<AnalysisResult["clusters"]> }) {
  const map = useMap();
  useEffect(() => {
    const layers: L.Layer[] = [];
    for (const c of clusters) {
      const latlngs = c.hull.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]);
      const poly = L.polygon(latlngs, {
        color: "#f97316",
        weight: 2,
        fillColor: "#f97316",
        fillOpacity: 0.12,
        dashArray: "4,3",
      });
      poly.bindTooltip(`<b>Cluster #${c.clusterId}</b><br/>${c.size} crashes`, { sticky: true });
      poly.addTo(map);
      layers.push(poly);
    }
    return () => { layers.forEach(l => map.removeLayer(l)); };
  }, [map, clusters]);
  return null;
}

// Custom legend component (outside map)
export function MapLegend() {
  const analysisResult = useAppStore(s => s.analysisResult);
  const analysisType = useAppStore(s => s.analysisConfig.type);

  if (!analysisResult) return null;

  if (analysisType === "getis_ord") {
    return (
      <div className="legend">
        <div className="font-semibold mb-1 text-cyan-400 text-[10px] uppercase tracking-wider">Network Getis-Ord Gi*</div>
        <div className="flex items-center gap-2 my-1">
          <span style={{ display: "inline-block", width: 16, height: 4, background: "#ef4444" }}></span>
          <span>Hot spot (p &lt; 0.05, FDR)</span>
        </div>
        <div className="flex items-center gap-2 my-1">
          <span style={{ display: "inline-block", width: 16, height: 4, background: "#3b82f6" }}></span>
          <span>Cold spot (p &lt; 0.05, FDR)</span>
        </div>
        <div className="flex items-center gap-2 my-1">
          <span style={{ display: "inline-block", width: 16, height: 2, background: "rgba(100,116,139,0.4)" }}></span>
          <span>Not significant</span>
        </div>
      </div>
    );
  }
  if (analysisType === "compare_kde") {
    return (
      <div className="legend">
        <div className="font-semibold mb-1 text-cyan-400 text-[10px] uppercase tracking-wider">Network vs Planar Δ</div>
        <div className="flex items-center gap-2 my-1">
          <span style={{ display: "inline-block", width: 16, height: 8, background: "linear-gradient(to right, #3b82f6, #94a3b8, #ef4444)" }}></span>
        </div>
        <div className="text-[10px] text-slate-400">
          Red: Planar overestimates<br />
          Blue: Planar underestimates
        </div>
      </div>
    );
  }
  if (analysisType === "nkde" || analysisType === "planar_kde") {
    return (
      <div className="legend">
        <div className="font-semibold mb-1 text-cyan-400 text-[10px] uppercase tracking-wider">
          {analysisType === "nkde" ? "Network KDE" : "Planar KDE"}
        </div>
        <div className="legend-gradient" style={{
          background: `linear-gradient(to right, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => viridis(t)).join(",")})`,
        }}></div>
        <div className="flex justify-between text-[10px] text-slate-400">
          <span>Low</span><span>High density</span>
        </div>
      </div>
    );
  }
  if (analysisType === "eb_risk") {
    return (
      <div className="legend">
        <div className="font-semibold mb-1 text-cyan-400 text-[10px] uppercase tracking-wider">
          EB Smoothed Risk
        </div>
        <div className="legend-gradient" style={{
          background: `linear-gradient(to right, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => inferno(t)).join(",")})`,
        }}></div>
        <div className="flex justify-between text-[10px] text-slate-400">
          <span>Low</span><span>High EB rate</span>
        </div>
      </div>
    );
  }
  return null;
}
