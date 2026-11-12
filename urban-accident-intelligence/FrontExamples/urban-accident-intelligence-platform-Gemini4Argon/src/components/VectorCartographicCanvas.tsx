"use client";

import React, { useState, useRef, useMemo } from "react";
import {
  STUDY_ORIGIN_X_M,
  STUDY_ORIGIN_Y_M,
  STUDY_MAX_X_M,
  STUDY_MAX_Y_M,
  metricToGeo,
} from "@/lib/geo/crs";
import { BIVARIATE_RISK_UNCERTAINTY_PALETTE } from "@/lib/geo/riskEngine";
import type { SnapCandidate } from "@/db/schema";
import {
  Compass,
  ZoomIn,
  ZoomOut,
  Maximize2,
  BoxSelect,
  MapPin,
  Layers,
  Eye,
  GitCommit,
  AlertTriangle,
} from "lucide-react";

export type CartographicLayerMode =
  | "nkde"
  | "planar_kde"
  | "kde_diff"
  | "gi_star"
  | "dbscan"
  | "eb_psi"
  | "bivariate_risk_uncertainty"
  | "ground_truth_lambda";

export interface EnrichedLixelItem {
  id: number;
  lixelCode: string;
  segmentId: number;
  lixelIndex: number;
  mStartM: number;
  mEndM: number;
  lengthM: number;
  centerXM: number;
  centerYM: number;
  centerLon: number;
  centerLat: number;
  distToNearestJunctionM: number;
  coordsMetricJson: [number, number][];
  coordsGeoJson: [number, number][];
  trueIntensityLambda: number;
  baselineRiskPrior: number;
  nkdeValue: number;
  planarKdeValue: number;
  kdeDiffValue: number;
  giStarZ: number;
  giStarPValue: number;
  giStarFdrPValue: number;
  giStarClusterType: string;
  dbscanClusterId: number;
  ebExpectedRate: number;
  psiExcessRate: number;
  epdoScore: number;
  vulnerabilityScore: number;
  epistemicUncertainty: number;
  bivariateClass: string;
  bivariateColorHex: string;
}

export interface RoadNodeItem {
  id: number;
  nodeCode: string;
  name: string;
  xM: number;
  yM: number;
  lon: number;
  lat: number;
  degree: number;
  isSignalized: boolean;
  elevationM: number;
}

export interface RoadSegmentItem {
  id: number;
  segmentCode: string;
  name: string;
  roadClass: string;
  fromNodeId: number;
  toNodeId: number;
  isOverpass: boolean;
  lengthM: number;
  speedLimitKmh: number;
  laneCount: number;
  sinuosity: number;
  aadt: number;
  coordsMetricJson: [number, number][];
  coordsGeoJson: [number, number][];
}

export interface AccidentItem {
  id: number;
  incidentCode: string;
  parentCanonicalId: number | null;
  rawXM: number;
  rawYM: number;
  rawLon: number;
  rawLat: number;
  observationalRadiusM: number;
  snappedSegmentId: number;
  snappedLixelId: number;
  snappedXM: number;
  snappedYM: number;
  snappedLon: number;
  snappedLat: number;
  linearOffsetM: number;
  snapDistanceM: number;
  snapProbabilityScore: number;
  snapCandidatesJson: SnapCandidate[];
  incidentTimestampUtc: string;
  reportedTimestampUtc: string;
  reportingLagMinutes: number;
  categoryCode: string;
  severityCode: string;
  vehicleCount: number;
  pedestrianCount: number;
  emergencyResponsePresent: boolean;
  weatherCondition: string;
  lightingCondition: string;
  roadSurface: string;
  narrative: string;
  verificationStatus: string;
  credibilityScore: number;
  witnessCount: number;
  isSynthetic: boolean;
  isFalseAlarm: boolean;
}

export interface SpatialBBoxMetric {
  minXM: number;
  minYM: number;
  maxXM: number;
  maxYM: number;
}

interface VectorCartographicCanvasProps {
  theme: "dark" | "light";
  layerMode: CartographicLayerMode;
  onChangeLayerMode: (mode: CartographicLayerMode) => void;
  nodes: RoadNodeItem[];
  segments: RoadSegmentItem[];
  lixels: EnrichedLixelItem[];
  accidents: AccidentItem[];
  filteredAccidents: AccidentItem[];
  dbscanClusters: Array<{
    clusterId: number;
    incidentCount: number;
    convexHullGeo: [number, number][];
  }>;
  selectedLixelId: number | null;
  onSelectLixel: (lixel: EnrichedLixelItem | null) => void;
  selectedSegmentId: number | null;
  onSelectSegment: (segmentId: number | null) => void;
  selectedAccidentId: number | null;
  onSelectAccident: (accident: AccidentItem | null) => void;
  spatialBBox: SpatialBBoxMetric | null;
  onChangeSpatialBBox: (bbox: SpatialBBoxMetric | null) => void;
  citizenPinMode: boolean;
  onToggleCitizenPinMode: () => void;
  citizenDraftPin: {
    xM: number;
    yM: number;
    observationalRadiusM: number;
    snapCandidates?: SnapCandidate[];
  } | null;
  onPlaceCitizenPin: (xM: number, yM: number) => void;
}

/**
 * Perceptual Colorblind-Safe Ramp (Inferno / Viridis / Diverging RdBu)
 */
function interpolatePerceptualSequential(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.25) {
    return "#1e293b"; // Low baseline slate
  }
  if (c < 0.5) {
    return "#0284c7"; // Cyan-Blue
  }
  if (c < 0.72) {
    return "#10b981"; // Emerald-Teal
  }
  if (c < 0.88) {
    return "#f59e0b"; // Amber
  }
  return "#f43f5e"; // High-intensity Crimson-Rose
}

function interpolateDivergingDiff(diff: number, maxAbs: number): string {
  if (maxAbs <= 1e-6) return "#64748b";
  const norm = Math.max(-1, Math.min(1, diff / maxAbs));
  if (norm > 0.45) return "#ef4444"; // Severe Planar Overestimation (Red)
  if (norm > 0.15) return "#fb923c"; // Moderate Planar Overestimation (Orange)
  if (norm < -0.45) return "#38bdf8"; // Network Channelization Concentration (Cyan)
  if (norm < -0.15) return "#60a5fa"; // Mild Network Concentration
  return "#475569"; // Near-zero distortion
}

const CLUSTER_PALETTE = [
  "#ec4899",
  "#a855f7",
  "#06b6d4",
  "#10b981",
  "#eab308",
  "#f97316",
  "#3b82f6",
];

const SEVERITY_COLORS: Record<string, string> = {
  fatal: "#f43f5e",
  severe_injury: "#f97316",
  minor_injury: "#facc15",
  pdo: "#38bdf8",
};

export default function VectorCartographicCanvas({
  theme,
  layerMode,
  onChangeLayerMode,
  nodes,
  segments,
  lixels,
  filteredAccidents,
  dbscanClusters,
  selectedLixelId,
  onSelectLixel,
  selectedSegmentId,
  onSelectSegment,
  selectedAccidentId,
  onSelectAccident,
  spatialBBox,
  onChangeSpatialBBox,
  citizenPinMode,
  onToggleCitizenPinMode,
  citizenDraftPin,
  onPlaceCitizenPin,
}: VectorCartographicCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Viewport state in Metric EPSG:32618 coordinates
  const [viewBox, setViewBox] = useState({
    minX: 583150,
    minY: 4511150,
    width: 2700,
    height: 2150,
  });

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  const [bboxBrushMode, setBboxBrushMode] = useState(false);
  const [dragBoxStart, setDragBoxStart] = useState<{ xM: number; yM: number } | null>(
    null
  );
  const [dragBoxCurr, setDragBoxCurr] = useState<{ xM: number; yM: number } | null>(
    null
  );

  // Overlay toggles
  const [showRawVgiVectors, setShowRawVgiVectors] = useState(true);
  const [showIntersectionNodes, setShowIntersectionNodes] = useState(true);
  const [showIncidentPoints, setShowIncidentPoints] = useState(true);
  const [clusterGlyphMode, setClusterGlyphMode] = useState(false);

  // Live cursor coordinate readout in Dual CRS
  const [cursorMetric, setCursorMetric] = useState<[number, number]>([
    584500, 4512200,
  ]);

  // Convert SVG client event to Metric EPSG:32618 (xM, yM)
  // Note: SVG Y goes top-down, whereas Northing Y_M goes bottom-up!
  const clientToMetric = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current;
    if (!svg) return [584500, 4512200];
    const rect = svg.getBoundingClientRect();
    const relX = (clientX - rect.left) / Math.max(1, rect.width);
    const relY = (clientY - rect.top) / Math.max(1, rect.height);
    const xM = Number((viewBox.minX + relX * viewBox.width).toFixed(1));
    const yM = Number(
      (viewBox.minY + (1 - relY) * viewBox.height).toFixed(1)
    );
    return [xM, yM];
  };

  // Convert Metric (xM, yM) to SVG canvas coordinates (svgX, svgY)
  const metricToSvgY = (yM: number): number => {
    const totalTop = STUDY_MAX_Y_M + STUDY_ORIGIN_Y_M;
    return totalTop - yM;
  };

  // Normalization ranges for active layer
  const statsBounds = useMemo(() => {
    const maxNkde = Math.max(...lixels.map((l) => l.nkdeValue), 0.1);
    const maxPlanar = Math.max(...lixels.map((l) => l.planarKdeValue), 0.1);
    const maxAbsDiff = Math.max(
      ...lixels.map((l) => Math.abs(l.kdeDiffValue)),
      0.1
    );
    const maxEb = Math.max(...lixels.map((l) => l.ebExpectedRate), 0.1);
    const maxLambda = Math.max(...lixels.map((l) => l.trueIntensityLambda), 0.1);
    return { maxNkde, maxPlanar, maxAbsDiff, maxEb, maxLambda };
  }, [lixels]);

  const getLixelColor = (lx: EnrichedLixelItem): string => {
    switch (layerMode) {
      case "nkde":
        return interpolatePerceptualSequential(
          lx.nkdeValue / statsBounds.maxNkde
        );
      case "planar_kde":
        return interpolatePerceptualSequential(
          lx.planarKdeValue / statsBounds.maxPlanar
        );
      case "kde_diff":
        return interpolateDivergingDiff(
          lx.kdeDiffValue,
          statsBounds.maxAbsDiff
        );
      case "gi_star":
        if (lx.giStarClusterType === "Hotspot 99% (p < 0.01)") return "#f43f5e";
        if (lx.giStarClusterType === "Hotspot 95% (p < 0.05)") return "#fb923c";
        if (lx.giStarClusterType === "High Density (Non-Significant)")
          return "#eab308";
        if (lx.giStarClusterType === "Coldspot 99% (p < 0.01)") return "#0284c7";
        if (lx.giStarClusterType === "Coldspot 95% (p < 0.05)") return "#38bdf8";
        return theme === "dark" ? "#334155" : "#cbd5e1";
      case "dbscan":
        if (lx.dbscanClusterId <= 0)
          return theme === "dark" ? "#334155" : "#cbd5e1";
        return CLUSTER_PALETTE[
          (lx.dbscanClusterId - 1) % CLUSTER_PALETTE.length
        ];
      case "eb_psi":
        return interpolatePerceptualSequential(
          lx.ebExpectedRate / statsBounds.maxEb
        );
      case "bivariate_risk_uncertainty":
        return (
          lx.bivariateColorHex ||
          BIVARIATE_RISK_UNCERTAINTY_PALETTE[lx.bivariateClass] ||
          "#008080"
        );
      case "ground_truth_lambda":
        return interpolatePerceptualSequential(
          lx.trueIntensityLambda / statsBounds.maxLambda
        );
    }
  };

  // Zoom-dependent spatial cluster glyphs
  const spatialClusters = useMemo(() => {
    if (!clusterGlyphMode) return [];
    const cellSizeM = Math.max(180, Math.round(viewBox.width / 8));
    const buckets = new Map<
      string,
      {
        xSum: number;
        ySum: number;
        count: number;
        fatalOrSevere: number;
        unverified: number;
      }
    >();

    for (const acc of filteredAccidents) {
      const gx = Math.floor(acc.snappedXM / cellSizeM);
      const gy = Math.floor(acc.snappedYM / cellSizeM);
      const key = `${gx}_${gy}`;
      const b = buckets.get(key) ?? {
        xSum: 0,
        ySum: 0,
        count: 0,
        fatalOrSevere: 0,
        unverified: 0,
      };
      b.xSum += acc.snappedXM;
      b.ySum += acc.snappedYM;
      b.count += 1;
      if (acc.severityCode === "fatal" || acc.severityCode === "severe_injury") {
        b.fatalOrSevere += 1;
      }
      if (acc.verificationStatus === "unverified_raw_vgi") {
        b.unverified += 1;
      }
      buckets.set(key, b);
    }

    return Array.from(buckets.entries()).map(([key, b]) => ({
      key,
      xM: b.xSum / b.count,
      yM: b.ySum / b.count,
      count: b.count,
      fatalOrSevere: b.fatalOrSevere,
      unverified: b.unverified,
    }));
  }, [filteredAccidents, clusterGlyphMode, viewBox.width]);

  const handleZoom = (factor: number) => {
    setViewBox((prev) => {
      const newW = Math.max(650, Math.min(3800, prev.width * factor));
      const newH = Math.max(520, Math.min(3000, prev.height * factor));
      const cx = prev.minX + prev.width / 2;
      const cy = prev.minY + prev.height / 2;
      return {
        minX: cx - newW / 2,
        minY: cy - newH / 2,
        width: newW,
        height: newH,
      };
    });
  };

  const handleResetExtent = () => {
    setViewBox({
      minX: 583150,
      minY: 4511150,
      width: 2700,
      height: 2150,
    });
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const [xM, yM] = clientToMetric(e.clientX, e.clientY);

    if (citizenPinMode) {
      onPlaceCitizenPin(xM, yM);
      return;
    }

    if (bboxBrushMode) {
      setDragBoxStart({ xM, yM });
      setDragBoxCurr({ xM, yM });
      return;
    }

    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const [xM, yM] = clientToMetric(e.clientX, e.clientY);
    setCursorMetric([xM, yM]);

    if (bboxBrushMode && dragBoxStart) {
      setDragBoxCurr({ xM, yM });
      return;
    }

    if (isPanning && panStart && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const dxM = ((e.clientX - panStart.x) / Math.max(1, rect.width)) * viewBox.width;
      const dyM = ((e.clientY - panStart.y) / Math.max(1, rect.height)) * viewBox.height;
      setViewBox((prev) => ({
        ...prev,
        minX: prev.minX - dxM,
        minY: prev.minY + dyM,
      }));
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    if (bboxBrushMode && dragBoxStart && dragBoxCurr) {
      const minXM = Math.min(dragBoxStart.xM, dragBoxCurr.xM);
      const maxXM = Math.max(dragBoxStart.xM, dragBoxCurr.xM);
      const minYM = Math.min(dragBoxStart.yM, dragBoxCurr.yM);
      const maxYM = Math.max(dragBoxStart.yM, dragBoxCurr.yM);
      if (maxXM - minXM > 35 && maxYM - minYM > 35) {
        onChangeSpatialBBox({ minXM, minYM, maxXM, maxYM });
      }
      setDragBoxStart(null);
      setDragBoxCurr(null);
      setBboxBrushMode(false);
    }
    setIsPanning(false);
    setPanStart(null);
  };

  const cursorGeo = metricToGeo(cursorMetric[0], cursorMetric[1]);

  // SVG viewBox mapped to flipped Y
  const svgViewMinX = viewBox.minX;
  const svgViewMinY = metricToSvgY(viewBox.minY + viewBox.height);

  const layerModes: Array<{ id: CartographicLayerMode; label: string; short: string }> = [
    { id: "nkde", label: "Network KDE (NKDE)", short: "1D Graph Kernel" },
    { id: "planar_kde", label: "Planar 2D KDE", short: "Euclidean Baseline" },
    { id: "kde_diff", label: "Planar Distortion (ΔKDE)", short: "Planar - Network Bias" },
    { id: "gi_star", label: "Network Getis-Ord Gi*", short: "FDR Autocorrelation" },
    { id: "dbscan", label: "Network DBSCAN", short: "Graph Subclusters" },
    { id: "eb_psi", label: "Empirical Bayes (EB)", short: "RTM-Smoothed Rate" },
    {
      id: "bivariate_risk_uncertainty",
      label: "Bivariate Risk × Uncertainty",
      short: "3×3 Epistemic Matrix",
    },
    {
      id: "ground_truth_lambda",
      label: "True Point-Process λ(s,t)",
      short: "Benchmark Surface",
    },
  ];

  return (
    <div className="relative flex flex-col w-full h-full select-none overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      {/* Top Cartographic Layer Switcher & Tool Strip */}
      <div className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-slate-900/95 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1.5 flex items-center gap-1 font-semibold uppercase tracking-wider text-teal-400">
            <Layers className="h-3.5 w-3.5" /> Lixel Surface:
          </span>
          {layerModes.map((m) => (
            <button
              key={m.id}
              onClick={() => onChangeLayerMode(m.id)}
              title={`${m.label} (${m.short})`}
              className={`rounded px-2 py-1 font-medium transition ${
                layerMode === m.id
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/50 shadow-sm"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Interactive Map Tools */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              setBboxBrushMode((v) => !v);
              if (citizenPinMode) onToggleCitizenPinMode();
            }}
            className={`flex items-center gap-1 rounded px-2 py-1 font-medium border transition ${
              bboxBrushMode
                ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                : "bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
            title="Drag a spatial bounding box on the map to filter all statistical charts"
          >
            <BoxSelect className="h-3.5 w-3.5" />
            {bboxBrushMode ? "Drag Box Now..." : "Spatial BBox Filter"}
          </button>

          {spatialBBox && (
            <button
              onClick={() => onChangeSpatialBBox(null)}
              className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-amber-300 hover:bg-amber-500/30"
            >
              Clear BBox
            </button>
          )}

          <button
            onClick={onToggleCitizenPinMode}
            className={`flex items-center gap-1 rounded px-2.5 py-1 font-medium border transition ${
              citizenPinMode
                ? "bg-rose-500/25 text-rose-200 border-rose-500/60 animate-pulse"
                : "bg-slate-800/80 text-slate-300 border-slate-700 hover:bg-slate-800"
            }`}
            title="Click anywhere on the map to place a Citizen VGI Incident Pin & run real-time topological map-matching"
          >
            <MapPin className="h-3.5 w-3.5 text-rose-400" />
            {citizenPinMode ? "Click Map to Drop Pin..." : "Pin VGI Incident"}
          </button>
        </div>
      </div>

      {/* Secondary Vector Overlay Toggles Bar */}
      <div className="z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/70 bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-300">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showIncidentPoints}
              onChange={(e) => setShowIncidentPoints(e.target.checked)}
              className="accent-teal-400 rounded"
            />
            <span>Incident Points ({filteredAccidents.length})</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showRawVgiVectors}
              onChange={(e) => setShowRawVgiVectors(e.target.checked)}
              className="accent-teal-400 rounded"
            />
            <span className="flex items-center gap-1">
              <GitCommit className="h-3 w-3 text-amber-400" /> Raw→Snapped VGI Drift Vectors & Uncertainty Circles
            </span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showIntersectionNodes}
              onChange={(e) => setShowIntersectionNodes(e.target.checked)}
              className="accent-teal-400 rounded"
            />
            <span>Topological Nodes ({nodes.length})</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={clusterGlyphMode}
              onChange={(e) => setClusterGlyphMode(e.target.checked)}
              className="accent-teal-400 rounded"
            />
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3 text-sky-400" /> Multi-Scale Cluster Glyphs
            </span>
          </label>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleZoom(0.78)}
            className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700"
            title="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleZoom(1.25)}
            className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700"
            title="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleResetExtent}
            className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700 flex items-center gap-1"
            title="Reset Extent"
          >
            <Maximize2 className="h-3 w-3" /> Fit Study Grid
          </button>
        </div>
      </div>

      {/* Main Vector SVG Cartographic Viewport */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`${svgViewMinX} ${svgViewMinY} ${viewBox.width} ${viewBox.height}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={`w-full h-full ${
            citizenPinMode
              ? "cursor-crosshair"
              : bboxBrushMode
              ? "cursor-cell"
              : isPanning
              ? "cursor-grabbing"
              : "cursor-grab"
          } ${theme === "dark" ? "bg-[#070b14]" : "bg-slate-100"}`}
        >
          <defs>
            <pattern
              id="utmGridPattern"
              width="250"
              height="250"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 250 0 L 0 0 0 250"
                fill="none"
                stroke={theme === "dark" ? "#1e293b" : "#cbd5e1"}
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
            </pattern>
          </defs>

          {/* 250m Metric UTM Coordinate Grid (EPSG:32618) */}
          <rect
            x={STUDY_ORIGIN_X_M - 1000}
            y={metricToSvgY(STUDY_MAX_Y_M + 1000)}
            width="6000"
            height="6000"
            fill="url(#utmGridPattern)"
          />

          {/* N-DBSCAN Convex Hull Polygons when in DBSCAN or Gi* mode */}
          {(layerMode === "dbscan" || layerMode === "gi_star") &&
            dbscanClusters.map((cl) => {
              if (cl.convexHullGeo.length < 3) return null;
              const color =
                CLUSTER_PALETTE[(cl.clusterId - 1) % CLUSTER_PALETTE.length];
              // Convert hull geo coords to metric for unified rendering
              const pointsStr = cl.convexHullGeo
                .map(([lon, lat]) => {
                  const xM =
                    STUDY_ORIGIN_X_M + (lon - -74.0165) * 84326.2;
                  const yM =
                    STUDY_ORIGIN_Y_M + (lat - 40.746) * 111048.5;
                  return `${xM.toFixed(1)},${metricToSvgY(yM).toFixed(1)}`;
                })
                .join(" ");
              return (
                <g key={`hull_${cl.clusterId}`}>
                  <polygon
                    points={pointsStr}
                    fill={color}
                    fillOpacity={0.14}
                    stroke={color}
                    strokeWidth={3}
                    strokeDasharray="8 4"
                  />
                </g>
              );
            })}

          {/* Base Road Segment Casings (shows road hierarchy & overpass bridge deck) */}
          {segments.map((seg) => {
            const pts = seg.coordsMetricJson
              .map(([x, y]) => `${x},${metricToSvgY(y)}`)
              .join(" ");
            const isSelected = selectedSegmentId === seg.id;
            const strokeW =
              seg.roadClass === "motorway"
                ? 22
                : seg.roadClass === "arterial"
                ? 16
                : seg.roadClass === "collector"
                ? 12
                : 9;

            return (
              <g key={`seg_casing_${seg.id}`}>
                {seg.isOverpass && (
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={strokeW + 8}
                    strokeOpacity={0.35}
                    strokeDasharray="14 8"
                  />
                )}
                <polyline
                  points={pts}
                  fill="none"
                  stroke={
                    isSelected
                      ? "#2dd4bf"
                      : theme === "dark"
                      ? "#0f172a"
                      : "#94a3b8"
                  }
                  strokeWidth={isSelected ? strokeW + 7 : strokeW}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

          {/* Dynamic Lixels Layer (Linear Referencing System units) */}
          {lixels.map((lx) => {
            const pts = lx.coordsMetricJson
              .map(([x, y]) => `${x},${metricToSvgY(y)}`)
              .join(" ");
            const color = getLixelColor(lx);
            const isSelected = selectedLixelId === lx.id;
            const isSegSelected = selectedSegmentId === lx.segmentId;

            return (
              <g
                key={`lx_${lx.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (citizenPinMode) return;
                  onSelectLixel(lx);
                  onSelectSegment(lx.segmentId);
                }}
                className="cursor-pointer transition-opacity hover:opacity-90"
              >
                <polyline
                  points={pts}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSelected ? 17 : isSegSelected ? 13 : 9.5}
                  strokeLinecap="butt"
                  strokeLinejoin="round"
                />
                {isSelected && (
                  <circle
                    cx={lx.centerXM}
                    cy={metricToSvgY(lx.centerYM)}
                    r={16}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={3.5}
                  />
                )}
              </g>
            );
          })}

          {/* Segment Name Labels along major corridors */}
          {segments
            .filter(
              (s, i) =>
                s.isOverpass || s.roadClass === "arterial" || i % 4 === 0
            )
            .map((seg) => {
              const midIdx = Math.floor(seg.coordsMetricJson.length / 2);
              const [mx, my] = seg.coordsMetricJson[midIdx];
              return (
                <text
                  key={`lbl_${seg.id}`}
                  x={mx}
                  y={metricToSvgY(my) - 12}
                  textAnchor="middle"
                  fill={seg.isOverpass ? "#fcd34d" : "#94a3b8"}
                  fontSize="18"
                  fontWeight="600"
                  className="pointer-events-none select-none"
                  style={{
                    paintOrder: "stroke",
                    stroke: theme === "dark" ? "#020617" : "#ffffff",
                    strokeWidth: "4px",
                  }}
                >
                  {seg.segmentCode}: {seg.name}
                </text>
              );
            })}

          {/* Topological Intersection Nodes */}
          {showIntersectionNodes &&
            nodes.map((nd) => {
              const sy = metricToSvgY(nd.yM);
              return (
                <g key={`node_${nd.id}`} className="pointer-events-none">
                  <circle
                    cx={nd.xM}
                    cy={sy}
                    r={nd.isSignalized ? 10 : 7}
                    fill={nd.isSignalized ? "#0f172a" : "#1e293b"}
                    stroke={nd.degree >= 4 ? "#2dd4bf" : "#64748b"}
                    strokeWidth={2.5}
                  />
                  <text
                    x={nd.xM + 12}
                    y={sy + 4}
                    fill="#cbd5e1"
                    fontSize="15"
                    fontFamily="monospace"
                    style={{
                      paintOrder: "stroke",
                      stroke: "#020617",
                      strokeWidth: "3px",
                    }}
                  >
                    {nd.nodeCode}(d={nd.degree})
                  </text>
                </g>
              );
            })}

          {/* Raw VGI Coordinate -> Network-Snapped LRS Displacement Vectors & Uncertainty Circles */}
          {showIncidentPoints &&
            showRawVgiVectors &&
            !clusterGlyphMode &&
            filteredAccidents.map((acc) => {
              const rawSvgY = metricToSvgY(acc.rawYM);
              const snapSvgY = metricToSvgY(acc.snappedYM);
              const isSelected = selectedAccidentId === acc.id;
              return (
                <g key={`vgi_vec_${acc.id}`} className="pointer-events-none">
                  {isSelected && (
                    <circle
                      cx={acc.rawXM}
                      cy={rawSvgY}
                      r={acc.observationalRadiusM}
                      fill="#f59e0b"
                      fillOpacity={0.12}
                      stroke="#f59e0b"
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                    />
                  )}
                  <line
                    x1={acc.rawXM}
                    y1={rawSvgY}
                    x2={acc.snappedXM}
                    y2={snapSvgY}
                    stroke={
                      acc.verificationStatus === "unverified_raw_vgi"
                        ? "#f59e0b"
                        : "#38bdf8"
                    }
                    strokeWidth={isSelected ? 3 : 1.6}
                    strokeDasharray="3 3"
                    strokeOpacity={isSelected ? 0.95 : 0.65}
                  />
                  {/* Raw VGI unverified GPS ping dot */}
                  <circle
                    cx={acc.rawXM}
                    cy={rawSvgY}
                    r={isSelected ? 5 : 3}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.6}
                  />
                </g>
              );
            })}

          {/* Individual Network-Snapped Incident Points */}
          {showIncidentPoints &&
            !clusterGlyphMode &&
            filteredAccidents.map((acc) => {
              const snapSvgY = metricToSvgY(acc.snappedYM);
              const sevColor = SEVERITY_COLORS[acc.severityCode] ?? "#38bdf8";
              const isSelected = selectedAccidentId === acc.id;
              const isUnverified =
                acc.verificationStatus === "unverified_raw_vgi";
              const radius =
                acc.severityCode === "fatal"
                  ? 10.5
                  : acc.severityCode === "severe_injury"
                  ? 8.5
                  : 6.8;

              return (
                <g
                  key={`inc_pt_${acc.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (citizenPinMode) return;
                    onSelectAccident(acc);
                  }}
                  className="cursor-pointer"
                >
                  {isSelected && (
                    <circle
                      cx={acc.snappedXM}
                      cy={snapSvgY}
                      r={radius + 8}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={3}
                    />
                  )}
                  <circle
                    cx={acc.snappedXM}
                    cy={snapSvgY}
                    r={radius}
                    fill={sevColor}
                    fillOpacity={isUnverified ? 0.55 : 0.92}
                    stroke={isUnverified ? "#fde047" : "#020617"}
                    strokeWidth={isUnverified ? 2.4 : 2.0}
                    strokeDasharray={isUnverified ? "3 2" : undefined}
                  />
                  {acc.witnessCount > 1 && (
                    <text
                      x={acc.snappedXM}
                      y={snapSvgY - radius - 4}
                      textAnchor="middle"
                      fill="#fde047"
                      fontSize="14"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      ×{acc.witnessCount}w
                    </text>
                  )}
                </g>
              );
            })}

          {/* Multi-Scale Cluster Glyphs Mode */}
          {showIncidentPoints &&
            clusterGlyphMode &&
            spatialClusters.map((cl) => {
              const sy = metricToSvgY(cl.yM);
              const r = Math.min(44, 16 + Math.sqrt(cl.count) * 6);
              return (
                <g key={cl.key}>
                  <circle
                    cx={cl.xM}
                    cy={sy}
                    r={r + 5}
                    fill="#f43f5e"
                    fillOpacity={cl.fatalOrSevere > 0 ? 0.25 : 0}
                  />
                  <circle
                    cx={cl.xM}
                    cy={sy}
                    r={r}
                    fill="#0f172a"
                    stroke={cl.fatalOrSevere > 0 ? "#f43f5e" : "#2dd4bf"}
                    strokeWidth={3.5}
                  />
                  <text
                    x={cl.xM}
                    y={sy + 5}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize="17"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {cl.count}
                  </text>
                </g>
              );
            })}

          {/* Active Citizen Reporter Pin + Observational Radius + Candidate Topological Snaps */}
          {citizenDraftPin && (
            <g>
              <circle
                cx={citizenDraftPin.xM}
                cy={metricToSvgY(citizenDraftPin.yM)}
                r={citizenDraftPin.observationalRadiusM}
                fill="#f43f5e"
                fillOpacity={0.18}
                stroke="#f43f5e"
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
              {citizenDraftPin.snapCandidates?.map((cand, idx) => (
                <g key={`cand_snap_${cand.segmentId}_${idx}`}>
                  <line
                    x1={citizenDraftPin.xM}
                    y1={metricToSvgY(citizenDraftPin.yM)}
                    x2={cand.snappedXM}
                    y2={metricToSvgY(cand.snappedYM)}
                    stroke={idx === 0 ? "#2dd4bf" : "#94a3b8"}
                    strokeWidth={idx === 0 ? 4 : 2}
                    strokeDasharray={idx === 0 ? undefined : "4 4"}
                  />
                  <circle
                    cx={cand.snappedXM}
                    cy={metricToSvgY(cand.snappedYM)}
                    r={idx === 0 ? 9 : 6}
                    fill={idx === 0 ? "#2dd4bf" : "#64748b"}
                    stroke="#020617"
                    strokeWidth={2}
                  />
                </g>
              ))}
              <circle
                cx={citizenDraftPin.xM}
                cy={metricToSvgY(citizenDraftPin.yM)}
                r={10}
                fill="#f43f5e"
                stroke="#ffffff"
                strokeWidth={3}
              />
            </g>
          )}

          {/* Active or Dragging Spatial Bounding Box Filter */}
          {spatialBBox && (
            <rect
              x={spatialBBox.minXM}
              y={metricToSvgY(spatialBBox.maxYM)}
              width={spatialBBox.maxXM - spatialBBox.minXM}
              height={spatialBBox.maxYM - spatialBBox.minYM}
              fill="#f59e0b"
              fillOpacity={0.1}
              stroke="#f59e0b"
              strokeWidth={3}
              strokeDasharray="10 5"
            />
          )}
          {dragBoxStart && dragBoxCurr && (
            <rect
              x={Math.min(dragBoxStart.xM, dragBoxCurr.xM)}
              y={metricToSvgY(Math.max(dragBoxStart.yM, dragBoxCurr.yM))}
              width={Math.abs(dragBoxCurr.xM - dragBoxStart.xM)}
              height={Math.abs(dragBoxCurr.yM - dragBoxStart.yM)}
              fill="#38bdf8"
              fillOpacity={0.15}
              stroke="#38bdf8"
              strokeWidth={3}
              strokeDasharray="6 4"
            />
          )}
        </svg>

        {/* Floating Cartographic Legend (Bottom-Left) */}
        <div className=" absolute bottom-9 left-3 z-10 max-w-xs rounded-md border border-slate-800 bg-slate-900/95 p-2.5 text-[11px] text-slate-200 shadow-xl backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between gap-2 font-semibold text-teal-300">
            <span>
              {layerModes.find((m) => m.id === layerMode)?.label} Legend
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              EPSG:32618
            </span>
          </div>

          {layerMode === "bivariate_risk_uncertainty" ? (
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-3 gap-1 border border-slate-700 p-1 rounded bg-slate-950">
                {["L-H", "M-H", "H-H", "L-M", "M-M", "H-M", "L-L", "M-L", "H-L"].map(
                  (code) => (
                    <div
                      key={code}
                      className="h-4 w-6 rounded-xs flex items-center justify-center text-[8px] font-mono text-white"
                      style={{
                        backgroundColor:
                          BIVARIATE_RISK_UNCERTAINTY_PALETTE[code],
                      }}
                      title={`Risk-Uncertainty Class: ${code}`}
                    >
                      {code}
                    </div>
                  )
                )}
              </div>
              <div className="text-[10px] text-slate-300 leading-tight space-y-0.5">
                <div>→ X-Axis: Composite Risk (L → M → H)</div>
                <div>↑ Y-Axis: Epistemic Uncertainty (L → H)</div>
                <div className="text-amber-300">
                  H-L = High Risk, High Certainty
                </div>
              </div>
            </div>
          ) : layerMode === "gi_star" ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-xs bg-[#f43f5e]" />
                <span>Hotspot 99% (p&lt;0.01)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-xs bg-[#fb923c]" />
                <span>Hotspot 95% (p&lt;0.05)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-xs bg-[#eab308]" />
                <span>High Density (NS)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-4 rounded-xs bg-[#0284c7]" />
                <span>Coldspot 99% (p&lt;0.01)</span>
              </div>
            </div>
          ) : layerMode === "kde_diff" ? (
            <div className="space-y-1 text-[10px]">
              <div className="h-2.5 w-full rounded bg-gradient-to-r from-sky-400 via-slate-600 to-red-500" />
              <div className="flex justify-between text-slate-400 font-mono">
                <span>Network Channelized</span>
                <span>0</span>
                <span className="text-red-400">+Planar Overest.</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-[10px]">
              <div className="h-2.5 w-full rounded bg-gradient-to-r from-slate-800 via-sky-600 via-emerald-500 via-amber-500 to-rose-500" />
              <div className="flex justify-between text-slate-400 font-mono">
                <span>Low (0.0)</span>
                <span>Moderate</span>
                <span className="text-rose-400">Peak Intensity</span>
              </div>
            </div>
          )}

          {/* Severity Point Legend */}
          <div className="mt-2 pt-1.5 border-t border-slate-800 flex flex-wrap items-center gap-2.5 text-[10px]">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 inline-block" />{" "}
              Fatal (K)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500 inline-block" />{" "}
              Severe (A)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400 inline-block" />{" "}
              Minor (B/C)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400 inline-block" />{" "}
              PDO (O)
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <AlertTriangle className="h-2.5 w-2.5" /> Dashed = Raw VGI
            </span>
          </div>
        </div>

        {/* Bottom Status Bar: Dual-CRS Readout + Scale Bar */}
        <div className="absolute bottom-0 inset-x-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-950/95 px-3 py-1 text-[11px] font-mono text-slate-300">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-teal-400">
              <Compass className="h-3.5 w-3.5" />
              Projected Metric [EPSG:32618]:{" "}
              <strong>
                {cursorMetric[0].toFixed(1)}m E, {cursorMetric[1].toFixed(1)}m N
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-sky-300">
              Geographic [EPSG:4326]:{" "}
              <strong>
                {cursorGeo[0].toFixed(5)}° W, {cursorGeo[1].toFixed(5)}° N
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-16 border-x-2 border-b-2 border-teal-400" />
              <span>250m Metric Scale</span>
            </div>
            <span className="rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[10px] text-amber-300">
              SYNTHETIC GROUND-TRUTH + LIVE VGI
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
