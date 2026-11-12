"use client";
import { create } from "zustand";

export type Scenario = "uniform" | "intersection_clustered" | "rush_hour" | "complex_urban";
export type AnalysisType = "nkde" | "planar_kde" | "compare_kde" | "getis_ord" | "ndbscan" | "eb_risk" | "benchmark";
export type MetricMode = "frequency" | "density" | "epdo" | "eb";

export interface SimulationConfig {
  seed: number;
  scenario: Scenario;
  lixelResolutionM: number;
  expectedCrashesPerYear: number;
  vgiPositionalNoiseSigmaM: number;
  vgiDuplicateRate: number;
  vgiFalseAlarmRate: number;
}

export interface AnalysisConfig {
  type: AnalysisType;
  bandwidth: number;
  kernel: "gaussian" | "epanechnikov" | "quartic";
  minPts: number;
  eps: number;
  metric: MetricMode;
}

export interface AnalysisResult {
  runtimeMs: number;
  eventCount: number;
  lixelCount: number;
  bandwidthM: number;
  kernel: string;
  nkde?: number[];
  pkde?: number[];
  diff?: number[];
  counts?: number[];
  giStar?: number[];
  zScore?: number[];
  pValue?: number[];
  clusterType?: Array<"hot" | "cold" | "nonsig">;
  clusterCount?: number;
  clusterSizes?: number[];
  ebResults?: Array<{
    segmentId: number;
    observed: number;
    spfExpected: number;
    ebEstimate: number;
    psi: number;
    weight: number;
    rawRatePerMvk: number;
  }>;
  clusters?: Array<{ clusterId: number; size: number; hull: GeoJSON.Polygon }>;
  metrics?: { pai: number; rri: number; rmse: number; topFraction: number };
  metricsAt5?: { pai: number; rri: number; rmse: number };
  metricsAt20?: { pai: number; rri: number; rmse: number };
  lixelMeta?: Array<{
    id: number;
    lon: number;
    lat: number;
    roadClass: string | null;
    groundTruthLambda: number | null;
    coordinates: [number, number][];
  }>;
}

export interface Summary {
  totals: { verified: number; rawVgi: number; falseAlarms: number; total: number };
  bySeverity: Array<{ code: string; label: string; color: string; count: number }>;
  byHour: Array<{ hour: number; count: number }>;
  byDow: Array<{ dow: number; count: number }>;
  byWeather: Array<{ label: string; count: number }>;
  byLighting: Array<{ label: string; count: number }>;
  byRoadClass: Array<{ label: string; count: number; totalKm: number }>;
  lagHistogram: Array<{ bucket: number; count: number }>;
  snapHistogram: Array<{ bucket: number; count: number }>;
  dataset: { scenario: string; seed: number } | null;
}

interface AppState {
  // Simulation
  simConfig: SimulationConfig;
  setSimConfig: (patch: Partial<SimulationConfig>) => void;
  isSimulating: boolean;
  simStats: {
    nodes?: number; segments?: number; lixels?: number; accidents?: number;
    totalKm?: number; scenarioName?: string;
  } | null;
  setSimulating: (v: boolean) => void;
  setSimStats: (s: AppState["simStats"]) => void;
  runSimulation: () => Promise<void>;

  // Analysis
  analysisConfig: AnalysisConfig;
  setAnalysisConfig: (patch: Partial<AnalysisConfig>) => void;
  isAnalyzing: boolean;
  analysisResult: AnalysisResult | null;
  runAnalysis: () => Promise<void>;

  // Layers
  showSegments: boolean;
  showNodes: boolean;
  showLixels: boolean;
  showAccidents: boolean;
  showHotspots: boolean;
  showClusters: boolean;
  toggleLayer: (k: keyof Pick<AppState, "showSegments" | "showNodes" | "showLixels" | "showAccidents" | "showHotspots" | "showClusters">) => void;

  // Accident filter
  accidentStatusFilter: string[];
  accidentSeverityFilter: string[];
  setAccidentFilter: (patch: { statuses?: string[]; severities?: string[] }) => void;

  // Summary
  summary: Summary | null;
  loadSummary: () => Promise<void>;

  // Report modal
  reportModalOpen: boolean;
  reportModalCoord: { lon: number; lat: number } | null;
  openReportModal: (coord: { lon: number; lat: number }) => void;
  closeReportModal: () => void;

  // Cross-filter
  selectionBounds: [[number, number], [number, number]] | null;
  setSelectionBounds: (b: [[number, number], [number, number]] | null) => void;
  hoveredSegment: number | null;
  setHoveredSegment: (id: number | null) => void;

  // Activity tab
  activeTab: "simulation" | "analysis" | "risk" | "stewardship" | "benchmark";
  setActiveTab: (t: AppState["activeTab"]) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  simConfig: {
    seed: 42,
    scenario: "complex_urban",
    lixelResolutionM: 50,
    expectedCrashesPerYear: 800,
    vgiPositionalNoiseSigmaM: 18,
    vgiDuplicateRate: 0.35,
    vgiFalseAlarmRate: 0.08,
  },
  setSimConfig: (patch) => set(s => ({ simConfig: { ...s.simConfig, ...patch } })),
  isSimulating: false,
  simStats: null,
  setSimulating: v => set({ isSimulating: v }),
  setSimStats: s => set({ simStats: s }),
  runSimulation: async () => {
    set({ isSimulating: true });
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(get().simConfig),
      });
      const json = await res.json();
      if (json.ok) {
        set({ simStats: json.stats });
        await get().loadSummary();
      } else {
        console.error("sim error:", json.error);
      }
    } finally {
      set({ isSimulating: false });
    }
  },

  analysisConfig: {
    type: "compare_kde",
    bandwidth: 250,
    kernel: "gaussian",
    minPts: 4,
    eps: 150,
    metric: "frequency",
  },
  setAnalysisConfig: patch => set(s => ({ analysisConfig: { ...s.analysisConfig, ...patch } })),
  isAnalyzing: false,
  analysisResult: null,
  runAnalysis: async () => {
    set({ isAnalyzing: true, analysisResult: null });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(get().analysisConfig),
      });
      const json = await res.json();
      if (json.ok) {
        set({ analysisResult: json as AnalysisResult });
      } else {
        console.error("analysis error:", json.error);
      }
    } finally {
      set({ isAnalyzing: false });
    }
  },

  showSegments: true,
  showNodes: false,
  showLixels: false,
  showAccidents: true,
  showHotspots: false,
  showClusters: true,
  toggleLayer: (k) => set(s => ({ [k]: !s[k] } as Partial<AppState>)),

  accidentStatusFilter: ["synthetic_ground_truth"],
  accidentSeverityFilter: [],
  setAccidentFilter: ({ statuses, severities }) => set(s => ({
    accidentStatusFilter: statuses ?? s.accidentStatusFilter,
    accidentSeverityFilter: severities ?? s.accidentSeverityFilter,
  })),

  summary: null,
  loadSummary: async () => {
    try {
      const res = await fetch("/api/summary");
      const json = await res.json();
      set({ summary: json });
    } catch (e) { console.error(e); }
  },

  reportModalOpen: false,
  reportModalCoord: null,
  openReportModal: (coord) => set({ reportModalOpen: true, reportModalCoord: coord }),
  closeReportModal: () => set({ reportModalOpen: false, reportModalCoord: null }),

  selectionBounds: null,
  setSelectionBounds: b => set({ selectionBounds: b }),
  hoveredSegment: null,
  setHoveredSegment: id => set({ hoveredSegment: id }),

  activeTab: "simulation",
  setActiveTab: t => set({ activeTab: t }),
}));
