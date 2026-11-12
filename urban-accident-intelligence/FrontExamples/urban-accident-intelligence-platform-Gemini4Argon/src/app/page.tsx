"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import VectorCartographicCanvas, {
  CartographicLayerMode,
  EnrichedLixelItem,
  RoadNodeItem,
  RoadSegmentItem,
  AccidentItem,
  SpatialBBoxMetric,
} from "@/components/VectorCartographicCanvas";
import CoordinatedAnalyticsDock from "@/components/CoordinatedAnalyticsDock";
import MathematicalFormulationModal from "@/components/MathematicalFormulationModal";
import type { SegmentRiskEvaluation } from "@/lib/geo/riskEngine";
import type { SnapCandidate } from "@/db/schema";
import type { ConflationMatchResult } from "@/lib/geo/mapMatching";
import type { BenchmarkEvaluationMetrics } from "@/lib/geo/spatialStats";
import {
  Activity,
  Cpu,
  ShieldCheck,
  MapPin,
  Sliders,
  Sparkles,
  BookOpen,
  Download,
  Sun,
  Moon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  GitMerge,
  RefreshCw,
  Layers,
  Award,
  FileSpreadsheet,
} from "lucide-react";

type WorkspaceTab =
  | "spatial_lab"
  | "citizen_vgi"
  | "steward_qa"
  | "risk_eb"
  | "simulator";

interface PlatformStatePayload {
  activeDataset: {
    id: number;
    code: string;
    name: string;
    isSynthetic: boolean;
    scenarioType: string;
    seed: number;
    sridProjected: number;
    sridGeographic: number;
    lixelSizeM: number;
    description: string;
  } | null;
  nodes: RoadNodeItem[];
  segments: RoadSegmentItem[];
  lixels: EnrichedLixelItem[];
  accidents: AccidentItem[];
  categories: Array<{ code: string; name: string; description: string }>;
  severityLevels: Array<{
    code: string;
    label: string;
    rank: number;
    epdoWeight: number;
    colorHex: string;
  }>;
  segmentRiskPortfolio: SegmentRiskEvaluation[];
  latestJob: {
    id: number;
    jobCode: string;
    jobType: string;
    status: string;
    sridUsed: number;
    sampleSize: number;
    executionTimeMs: number;
    parametersJson: {
      kernel: "gaussian" | "epanechnikov" | "quartic";
      bandwidthM: number;
      useSeverityWeights: boolean;
      equalSplitAttenuation: number;
      giStarCutoffM: number;
      useFdrCorrection: boolean;
      dbscanEpsM: number;
      dbscanMinPts: number;
      includeUnverifiedVgi: boolean;
      weights: {
        ebRiskWeight: number;
        epdoSeverityWeight: number;
        geometricHazardWeight: number;
        environmentalHazardWeight: number;
      };
    };
    summaryMetricsJson: {
      nkdeBenchmark: BenchmarkEvaluationMetrics;
      planarBenchmark: BenchmarkEvaluationMetrics;
      ebBenchmark: BenchmarkEvaluationMetrics;
      maxDistortionLixelCode: string;
      meanPlanarOverestimationPct: number;
      assumptionsPassed: boolean;
      assumptionMessage: string;
      globalMoranI: number;
      globalMoranExpected: number;
      globalMoranZ: number;
      globalMoranPValue: number;
      significantHotspotCount: number;
      significantColdspotCount: number;
      dbscanClusterCount: number;
      dbscanNoiseCount: number;
      dbscanClusters: Array<{
        clusterId: number;
        incidentCount: number;
        lixelCount: number;
        dominantRoadNames: string[];
        meanEpdoSeverity: number;
        networkSpanM: number;
        convexHullGeo: [number, number][];
      }>;
    };
    createdAt: string;
  } | null;
  vgiDiagnostics: {
    meanPositionalDriftM: number;
    meanReportingLagMin: number;
    statusCounts: {
      verified_canonical: number;
      unverified_raw_vgi: number;
      conflated_witness_child: number;
      flagged: number;
      rejected: number;
      syntheticCount: number;
      empiricalVgiCount: number;
    };
    attachmentsCount: number;
  };
  auditLogs: Array<{
    id: number;
    actorRole: string;
    actorName: string;
    actionType: string;
    entityType: string;
    entityId: string;
    detailsJson: Record<string, unknown>;
    createdAt: string;
  }>;
}

export default function UrbanAccidentIntelligencePlatform() {
  const [platformData, setPlatformData] = useState<PlatformStatePayload | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [toastBanner, setToastBanner] = useState<{
    type: "success" | "info" | "warning";
    text: string;
  } | null>(null);

  // UI Theme & Modal state (US-6.3)
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("spatial_lab");
  const [layerMode, setLayerMode] = useState<CartographicLayerMode>("nkde");

  // Selected Map Entities
  const [selectedLixel, setSelectedLixel] = useState<EnrichedLixelItem | null>(
    null
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(
    null
  );
  const [selectedAccident, setSelectedAccident] = useState<AccidentItem | null>(
    null
  );

  // Bidirectional CMV Linked-Brushing Filters (US-6.2)
  const [selectedHourRange, setSelectedHourRange] = useState<
    [number, number] | null
  >(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedWeather, setSelectedWeather] = useState<string | null>(null);
  const [spatialBBox, setSpatialBBox] = useState<SpatialBBoxMetric | null>(
    null
  );

  // Tab 1: Spatial Analysis Lab Parameters (Epic 4)
  const [labKernel, setLabKernel] = useState<
    "gaussian" | "epanechnikov" | "quartic"
  >("quartic");
  const [labBandwidthM, setLabBandwidthM] = useState(220);
  const [labUseSeverityWeights, setLabUseSeverityWeights] = useState(true);
  const [labEqualSplitAtten, setLabEqualSplitAtten] = useState(0.65);
  const [labGiCutoffM, setLabGiCutoffM] = useState(260);
  const [labUseFdr, setLabUseFdr] = useState(true);
  const [labDbscanEpsM, setLabDbscanEpsM] = useState(165);
  const [labDbscanMinPts, setLabDbscanMinPts] = useState(3);
  const [labIncludeUnverified, setLabIncludeUnverified] = useState(true);

  // Tab 2: Citizen VGI Reporter State (Epic 2)
  const [citizenPinMode, setCitizenPinMode] = useState(false);
  const [vgiXM, setVgiXM] = useState(584490);
  const [vgiYM, setVgiYM] = useState(4512225);
  const [vgiRadiusM, setVgiRadiusM] = useState(18);
  const [vgiCategory, setVgiCategory] = useState("angle_turning_conflict");
  const [vgiSeverity, setVgiSeverity] = useState("severe_injury");
  const [vgiVehicleCount, setVgiVehicleCount] = useState(2);
  const [vgiPedestrianCount, setVgiPedestrianCount] = useState(0);
  const [vgiWeather, setVgiWeather] = useState("Clear");
  const [vgiLighting, setVgiLighting] = useState("Daylight");
  const [vgiSurface, setVgiSurface] = useState("Dry");
  const [vgiOverpassHint, setVgiOverpassHint] = useState(false);
  const [vgiNarrative, setVgiNarrative] = useState(
    "Multi-vehicle turning conflict observed near signalized junction; lane 2 obstructed."
  );
  const [vgiAttachmentName, setVgiAttachmentName] = useState(
    "dashcam_frame_redacted.jpg"
  );
  const [vgiSnapCandidates, setVgiSnapCandidates] = useState<SnapCandidate[]>(
    []
  );
  const [vgiConflationAlerts, setVgiConflationAlerts] = useState<
    ConflationMatchResult[]
  >([]);

  // Tab 3: Steward QA Filter State (Epic 3)
  const [stewardStatusFilter, setStewardStatusFilter] =
    useState<string>("all");
  const [stewardNotes, setStewardNotes] = useState(
    "Verified orthogonal projection & LRS offset against corridor geometry."
  );
  const [mergeTargetId, setMergeTargetId] = useState<number | "">("");

  // Tab 4: Multi-Criteria Vulnerability Weights (Epic 5)
  const [mcWeights, setMcWeights] = useState({
    ebRiskWeight: 0.40,
    epdoSeverityWeight: 0.30,
    geometricHazardWeight: 0.15,
    environmentalHazardWeight: 0.15,
  });

  // Tab 5: Stochastic Point-Process Simulator Config (Epic 1)
  const [simScenario, setSimScenario] = useState(
    "multi_covariate_complex_urban"
  );
  const [simSeed, setSimSeed] = useState(42);
  const [simLixelSizeM, setSimLixelSizeM] = useState(50);
  const [simDriftStdM, setSimDriftStdM] = useState(14);
  const [simDupBurstRate, setSimDupBurstRate] = useState(0.32);
  const [simFalseAlarmRate, setSimFalseAlarmRate] = useState(0.08);

  const showToast = (
    text: string,
    type: "success" | "info" | "warning" = "success"
  ) => {
    setToastBanner({ text, type });
    setTimeout(() => setToastBanner(null), 5000);
  };

  const fetchInitialPlatformData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/platform");
      const json = await res.json();
      if (json.ok && json.data) {
        setPlatformData(json.data);
        if (json.data.lixels?.length > 0) {
          setSelectedLixel(json.data.lixels[0]);
        }
        if (json.data.accidents?.length > 0) {
          setSelectedAccident(json.data.accidents[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load platform state:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialPlatformData();
  }, [fetchInitialPlatformData]);

  // Trigger real-time map-matching & spatiotemporal network conflation preview when VGI pin moves
  const refreshVgiPreview = useCallback(
    async (
      xM: number,
      yM: number,
      radiusM: number,
      cat: string,
      sev: string,
      overpass: boolean
    ) => {
      try {
        const res = await fetch("/api/vgi/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xM,
            yM,
            observationalRadiusM: radiusM,
            categoryCode: cat,
            severityCode: sev,
            preferGradeSeparatedOverpass: overpass,
          }),
        });
        const json = await res.json();
        if (json.ok && json.data) {
          setVgiSnapCandidates(json.data.snapCandidates || []);
          setVgiConflationAlerts(json.data.conflationCandidates || []);
        }
      } catch (e) {
        console.error("Failed VGI preview:", e);
      }
    },
    []
  );

  useEffect(() => {
    if (activeTab === "citizen_vgi" || citizenPinMode) {
      refreshVgiPreview(
        vgiXM,
        vgiYM,
        vgiRadiusM,
        vgiCategory,
        vgiSeverity,
        vgiOverpassHint
      );
    }
  }, [
    activeTab,
    citizenPinMode,
    vgiXM,
    vgiYM,
    vgiRadiusM,
    vgiCategory,
    vgiSeverity,
    vgiOverpassHint,
    refreshVgiPreview,
  ]);

  // Synchronized CMV Filtered Accidents (excludes rejected/child duplicates from main map analytical view)
  const activeAnalyticalAccidents = useMemo(() => {
    if (!platformData) return [];
    return platformData.accidents.filter(
      (a) =>
        a.verificationStatus !== "rejected" &&
        a.verificationStatus !== "conflated_witness_child"
    );
  }, [platformData]);

  const filteredAccidents = useMemo(() => {
    return activeAnalyticalAccidents.filter((acc) => {
      if (selectedSeverity && acc.severityCode !== selectedSeverity)
        return false;
      if (selectedCategory && acc.categoryCode !== selectedCategory)
        return false;
      if (selectedWeather && acc.weatherCondition !== selectedWeather)
        return false;
      if (selectedSegmentId && acc.snappedSegmentId !== selectedSegmentId)
        return false;
      if (selectedHourRange) {
        const hr = new Date(acc.incidentTimestampUtc).getUTCHours();
        const [startHr, endHr] = selectedHourRange;
        const inRange =
          startHr <= endHr
            ? hr >= startHr && hr <= endHr
            : hr >= startHr || hr <= endHr;
        if (!inRange) return false;
      }
      if (spatialBBox) {
        if (
          acc.snappedXM < spatialBBox.minXM ||
          acc.snappedXM > spatialBBox.maxXM ||
          acc.snappedYM < spatialBBox.minYM ||
          acc.snappedYM > spatialBBox.maxYM
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    activeAnalyticalAccidents,
    selectedSeverity,
    selectedCategory,
    selectedWeather,
    selectedSegmentId,
    selectedHourRange,
    spatialBBox,
  ]);

  const handleResetAllFilters = () => {
    setSelectedHourRange(null);
    setSelectedSeverity(null);
    setSelectedCategory(null);
    setSelectedWeather(null);
    setSelectedSegmentId(null);
    setSpatialBBox(null);
  };

  // Handler: Run Spatial Analysis Laboratory Job (Epic 4)
  const handleRunSpatialLabJob = async () => {
    setBusyMessage(
      `Executing Network Geocomputation (${labKernel.toUpperCase()} h=${labBandwidthM}m, Gi* d=${labGiCutoffM}m, N-DBSCAN ε=${labDbscanEpsM}m)...`
    );
    try {
      const res = await fetch("/api/analysis/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kernel: labKernel,
          bandwidthM: labBandwidthM,
          useSeverityWeights: labUseSeverityWeights,
          equalSplitAttenuation: labEqualSplitAtten,
          giStarCutoffM: labGiCutoffM,
          useFdrCorrection: labUseFdr,
          dbscanEpsM: labDbscanEpsM,
          dbscanMinPts: labDbscanMinPts,
          includeUnverifiedVgi: labIncludeUnverified,
          weights: mcWeights,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        setPlatformData(json.data);
        showToast(
          `Job ${json.data.latestJob?.jobCode} completed in ${json.data.latestJob?.executionTimeMs}ms across ${json.data.lixels?.length} lixels.`
        );
      }
    } finally {
      setBusyMessage(null);
    }
  };

  // Handler: Submit Citizen VGI Report or Corroborate Existing (Epic 2)
  const handleSubmitCitizenVgi = async (
    action: "create_new" | "corroborate_existing",
    targetIncidentId?: number
  ) => {
    setBusyMessage(
      action === "corroborate_existing"
        ? "Recording multi-witness corroboration & updating Bayesian credibility..."
        : "Validating coordinate bounds, stripping EXIF, & topological map-matching..."
    );
    try {
      const res = await fetch("/api/vgi/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          targetIncidentId,
          xM: vgiXM,
          yM: vgiYM,
          observationalRadiusM: vgiRadiusM,
          categoryCode: vgiCategory,
          severityCode: vgiSeverity,
          vehicleCount: vgiVehicleCount,
          pedestrianCount: vgiPedestrianCount,
          weatherCondition: vgiWeather,
          lightingCondition: vgiLighting,
          roadSurface: vgiSurface,
          preferGradeSeparatedOverpass: vgiOverpassHint,
          narrative: vgiNarrative,
          attachmentFileName: vgiAttachmentName,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        setPlatformData(json.data);
        setCitizenPinMode(false);
        showToast(
          json.mode === "corroborated"
            ? `Corroborated incident ${json.incidentCode} (+1 witness trust boost).`
            : `Submitted VGI report ${json.incidentCode} as Unverified / Raw VGI.`
        );
      } else {
        showToast(json.error || "VGI validation failed", "warning");
      }
    } finally {
      setBusyMessage(null);
    }
  };

  // Handler: Data Steward Verification / Snap Override / Conflation Merge (Epic 3)
  const handleStewardAction = async (payload: {
    accidentId: number;
    action?: string;
    newStatus?: string;
    candidateIndex?: number;
    canonicalIncidentId?: number;
    verificationNotes?: string;
  }) => {
    setBusyMessage("Applying Geospatial Data Steward action & updating audit log...");
    try {
      const res = await fetch("/api/steward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        setPlatformData(json.data);
        const updated = json.data.accidents.find(
          (a: AccidentItem) => a.id === payload.accidentId
        );
        if (updated) setSelectedAccident(updated);
        showToast("Steward QA verification & spatial layers updated.");
      }
    } finally {
      setBusyMessage(null);
    }
  };

  // Handler: Recompute Multi-Criteria Vulnerability Portfolio (Epic 5)
  const handleUpdateMcWeights = async (newWeights: typeof mcWeights) => {
    setMcWeights(newWeights);
    const res = await fetch("/api/platform", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weights: newWeights }),
    });
    const json = await res.json();
    if (json.ok && json.data) {
      setPlatformData(json.data);
    }
  };

  // Handler: Run Stochastic Point-Process Simulator (Epic 1)
  const handleRunSimulator = async () => {
    setBusyMessage(
      `Generating Topological Lixels (Δl=${simLixelSizeM}m) & Seeded Cox Point-Process (${simScenario}, Seed=${simSeed})...`
    );
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioType: simScenario,
          seed: simSeed,
          lixelSizeM: simLixelSizeM,
          gaussianDriftStdM: simDriftStdM,
          duplicateBurstRate: simDupBurstRate,
          falseAlarmRate: simFalseAlarmRate,
        }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        setPlatformData(json.data);
        handleResetAllFilters();
        showToast(
          `Generated ${json.data.lixels?.length} lixels (Δl=${simLixelSizeM}m) & ${json.data.accidents?.length} point-process reports.`
        );
      }
    } finally {
      setBusyMessage(null);
    }
  };

  // Handler: Download Open Geospatial GeoJSON or Statistical CSV (US-4.5)
  const handleDownloadGeoJson = (
    layer: "lixels" | "segments" | "incidents"
  ) => {
    window.open(`/api/export/geojson?layer=${layer}`, "_blank");
  };

  const handleDownloadCsvSummary = () => {
    if (!platformData) return;
    const headers = [
      "SegmentCode",
      "Name",
      "RoadClass",
      "LengthM",
      "AADT",
      "ObsCrashCount",
      "LinearDensityPerKm",
      "EPDOIndex",
      "MVKTRate",
      "SPFPrior",
      "EBWeightW",
      "EBExpectedCount",
      "PSIExcessFrequency",
      "RTMShrinkage",
      "VulnerabilityScore",
      "UncertaintyScore",
      "BivariateClass",
    ];
    const rows = platformData.segmentRiskPortfolio.map((r) =>
      [
        r.segmentCode,
        `"${r.name}"`,
        r.roadClass,
        r.lengthM,
        r.aadt,
        r.rawCrashCount,
        r.linearCrashDensityPerKm,
        r.epdoIndex,
        r.mvktCrashRate,
        r.spfPriorExpected,
        r.ebWeightW,
        r.ebExpectedCount,
        r.psiExcessCrashFrequency,
        r.rtmShrinkageCorrection,
        r.compositeVulnerabilityScore,
        r.uncertaintyScore,
        r.bivariateClass,
      ].join(",")
    );
    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `urban_accident_eb_portfolio_${platformData.activeDataset?.code || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !platformData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-200 p-6">
        <div className="flex items-center gap-3 rounded-xl border border-teal-500/40 bg-slate-900 px-6 py-4 shadow-2xl">
          <RefreshCw className="h-5 w-5 animate-spin text-teal-400" />
          <div>
            <div className="text-sm font-bold tracking-wide text-white uppercase">
              Bootstrapping Urban Accident Intelligence Geocomputation Engine...
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Building EPSG:32618 Topological Road Graph, Dynamic Lixels, &amp; Seeded Cox Point-Process Surface
            </div>
          </div>
        </div>
      </div>
    );
  }

  const summary = platformData.latestJob?.summaryMetricsJson;
  const stewardFilteredAccidents = platformData.accidents.filter((acc) =>
    stewardStatusFilter === "all"
      ? true
      : acc.verificationStatus === stewardStatusFilter
  );

  return (
    <div
      className={`min-h-screen flex flex-col ${
        theme === "dark"
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-100 text-slate-900"
      }`}
    >
      {/* Top Geospatial Intelligence Header Bar */}
      <header className="border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 text-teal-400">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-wider uppercase text-white">
                  Urban Accident Intelligence
                </h1>
                <span className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                  {platformData.activeDataset?.isSynthetic
                    ? `SYNTHETIC BENCHMARK (${platformData.activeDataset.code})`
                    : "EMPIRICAL + VGI DATASET"}
                </span>
                <span className="hidden md:inline-block rounded bg-teal-500/15 border border-teal-500/30 px-2 py-0.5 font-mono text-[10px] text-teal-300">
                  Lixel Δl = {platformData.activeDataset?.lixelSizeM}m ({platformData.lixels.length} units)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Network-Constrained Spatiotemporal Geocomputation, Lixel LRS, Topological VGI Conflation &amp; Empirical Bayes Safety Lab
              </p>
            </div>
          </div>

          {/* Right Header KPI & Action Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="hidden xl:flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-1 font-mono text-[11px]">
              <div>
                <span className="text-slate-400">NKDE PAI@10%:</span>{" "}
                <strong className="text-teal-300">
                  {summary?.nkdeBenchmark.paiTop10Pct ?? "—"}
                </strong>
              </div>
              <span className="text-slate-700">|</span>
              <div>
                <span className="text-slate-400">Planar PAI@10%:</span>{" "}
                <strong className="text-amber-300">
                  {summary?.planarBenchmark.paiTop10Pct ?? "—"}
                </strong>
              </div>
              <span className="text-slate-700">|</span>
              <div>
                <span className="text-slate-400">Moran&apos;s I:</span>{" "}
                <strong className="text-sky-300">
                  {summary?.globalMoranI ?? "—"} (z={summary?.globalMoranZ ?? "—"})
                </strong>
              </div>
            </div>

            <button
              onClick={() => setIsFormulaModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-teal-500/40 bg-teal-500/15 px-3 py-1.5 font-semibold text-teal-300 hover:bg-teal-500/25 transition"
            >
              <BookOpen className="h-3.5 w-3.5" /> Equations &amp; OGC Export
            </button>

            <button
              onClick={handleDownloadCsvSummary}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-slate-200 hover:bg-slate-700 transition"
              title="Download Segment Empirical Bayes & Multi-Criteria CSV Table"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-amber-400" /> CSV
            </button>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700"
              title="Toggle Dark Terminal / High-Contrast Publication Theme (US-6.3)"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-300" />
              ) : (
                <Moon className="h-4 w-4 text-sky-300" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification or Busy Geocomputation Banner */}
      {(busyMessage || toastBanner) && (
        <div className="border-b border-slate-800 bg-slate-900 px-4 py-1.5 text-xs flex items-center justify-between">
          {busyMessage ? (
            <div className="flex items-center gap-2 text-teal-300 font-mono">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>{busyMessage}</span>
            </div>
          ) : (
            toastBanner && (
              <div
                className={`flex items-center gap-2 font-medium ${
                  toastBanner.type === "warning"
                    ? "text-amber-300"
                    : "text-emerald-400"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{toastBanner.text}</span>
              </div>
            )
          )}
        </div>
      )}

      {/* Main Split Workspace: Central Multi-Scale Cartographic Canvas (7 cols) + Scientific Persona Workbench (5 cols) */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-3 p-3">
        {/* Left/Center: Multi-Scale Vector Cartographic Canvas (7 cols) */}
        <div className="xl:col-span-7 flex flex-col min-h-[540px]">
          <VectorCartographicCanvas
            theme={theme}
            layerMode={layerMode}
            onChangeLayerMode={setLayerMode}
            nodes={platformData.nodes}
            segments={platformData.segments}
            lixels={platformData.lixels}
            accidents={platformData.accidents}
            filteredAccidents={filteredAccidents}
            dbscanClusters={summary?.dbscanClusters ?? []}
            selectedLixelId={selectedLixel?.id ?? null}
            onSelectLixel={(lx) => setSelectedLixel(lx)}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={(sid) => setSelectedSegmentId(sid)}
            selectedAccidentId={selectedAccident?.id ?? null}
            onSelectAccident={(acc) => setSelectedAccident(acc)}
            spatialBBox={spatialBBox}
            onChangeSpatialBBox={setSpatialBBox}
            citizenPinMode={citizenPinMode}
            onToggleCitizenPinMode={() => {
              setCitizenPinMode((v) => !v);
              if (!citizenPinMode) setActiveTab("citizen_vgi");
            }}
            citizenDraftPin={
              activeTab === "citizen_vgi" || citizenPinMode
                ? {
                    xM: vgiXM,
                    yM: vgiYM,
                    observationalRadiusM: vgiRadiusM,
                    snapCandidates: vgiSnapCandidates,
                  }
                : null
            }
            onPlaceCitizenPin={(xM, yM) => {
              setVgiXM(xM);
              setVgiYM(yM);
              setActiveTab("citizen_vgi");
            }}
          />
        </div>

        {/* Right: 5-Tab Scientific Persona Workbench (5 cols) */}
        <div className="xl:col-span-5 flex flex-col rounded-lg border border-slate-800 bg-slate-900/95 overflow-hidden">
          {/* 5 Persona Module Navigation Tabs */}
          <div className="grid grid-cols-5 border-b border-slate-800 bg-slate-950 text-[11px] font-semibold">
            {[
              {
                id: "spatial_lab",
                label: "1. Spatial Lab",
                sub: "NKDE / Gi* / DBSCAN",
                icon: Cpu,
              },
              {
                id: "citizen_vgi",
                label: "2. Citizen VGI",
                sub: "Pin & Conflation",
                icon: MapPin,
              },
              {
                id: "steward_qa",
                label: "3. Steward QA",
                sub: `Triage (${platformData.vgiDiagnostics.statusCounts.unverified_raw_vgi})`,
                icon: ShieldCheck,
              },
              {
                id: "risk_eb",
                label: "4. EB & Risk",
                sub: "SPF / PSI / Biv.",
                icon: Sliders,
              },
              {
                id: "simulator",
                label: "5. Simulator",
                sub: "Cox Process λ",
                icon: Sparkles,
              },
            ].map((t) => {
              const Icon = t.icon;
              const isAct = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id as WorkspaceTab)}
                  className={`flex flex-col items-center justify-center py-2 px-1 border-b-2 transition ${
                    isAct
                      ? "border-teal-400 bg-slate-900 text-teal-300"
                      : "border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t.label}</span>
                  </div>
                  <span className="text-[9px] font-normal text-slate-400 truncate max-w-full">
                    {t.sub}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Tab Body Content */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs text-slate-200 max-h-[520px]">
            {/* ==================== TAB 1: SPATIAL ANALYSIS LAB (EPIC 4 & US-1.4) ==================== */}
            {activeTab === "spatial_lab" && (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="font-bold text-sm text-white flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-teal-400" /> Network vs. Planar Geocomputation Lab
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Configure shortest-path network kernels, topological weights W<sub>net</sub>, &amp; benchmark against true &lambda;(s,t)
                    </p>
                  </div>
                  <button
                    onClick={handleRunSpatialLabJob}
                    className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 shadow transition"
                  >
                    Run Geocomputation
                  </button>
                </div>

                {/* Parameter Controls Grid */}
                <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      1D Network Kernel K(u)
                    </label>
                    <select
                      value={labKernel}
                      onChange={(e) =>
                        setLabKernel(
                          e.target.value as
                            | "gaussian"
                            | "epanechnikov"
                            | "quartic"
                        )
                      }
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      <option value="quartic">Quartic (Biweight)</option>
                      <option value="epanechnikov">Epanechnikov (Optimal)</option>
                      <option value="gaussian">Gaussian Normal</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      Network Bandwidth h<sub>net</sub>:{" "}
                      <span className="font-mono text-teal-300">{labBandwidthM}m</span>
                    </label>
                    <input
                      type="range"
                      min={60}
                      max={480}
                      step={20}
                      value={labBandwidthM}
                      onChange={(e) => setLabBandwidthM(Number(e.target.value))}
                      className="mt-1.5 w-full accent-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      Node-Degree Split &eta;:{" "}
                      <span className="font-mono text-teal-300">
                        {labEqualSplitAtten.toFixed(2)}
                      </span>
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={labEqualSplitAtten}
                      onChange={(e) =>
                        setLabEqualSplitAtten(Number(e.target.value))
                      }
                      className="mt-1.5 w-full accent-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      Getis-Ord W<sub>net</sub> Cutoff:{" "}
                      <span className="font-mono text-teal-300">{labGiCutoffM}m</span>
                    </label>
                    <input
                      type="range"
                      min={100}
                      max={500}
                      step={20}
                      value={labGiCutoffM}
                      onChange={(e) => setLabGiCutoffM(Number(e.target.value))}
                      className="mt-1.5 w-full accent-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      N-DBSCAN Graph &epsilon;<sub>net</sub>:{" "}
                      <span className="font-mono text-teal-300">{labDbscanEpsM}m</span>
                    </label>
                    <input
                      type="range"
                      min={60}
                      max={350}
                      step={15}
                      value={labDbscanEpsM}
                      onChange={(e) => setLabDbscanEpsM(Number(e.target.value))}
                      className="mt-1.5 w-full accent-teal-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      N-DBSCAN MinPts:{" "}
                      <span className="font-mono text-teal-300">{labDbscanMinPts}</span>
                    </label>
                    <input
                      type="range"
                      min={2}
                      max={8}
                      step={1}
                      value={labDbscanMinPts}
                      onChange={(e) =>
                        setLabDbscanMinPts(Number(e.target.value))
                      }
                      className="mt-1.5 w-full accent-teal-400"
                    />
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center gap-4 pt-1 border-t border-slate-800/80 text-[11px]">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={labUseSeverityWeights}
                        onChange={(e) =>
                          setLabUseSeverityWeights(e.target.checked)
                        }
                        className="accent-teal-400"
                      />
                      <span>EPDO Severity Weighting</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={labUseFdr}
                        onChange={(e) => setLabUseFdr(e.target.checked)}
                        className="accent-teal-400"
                      />
                      <span>Benjamini-Hochberg FDR Correction</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={labIncludeUnverified}
                        onChange={(e) =>
                          setLabIncludeUnverified(e.target.checked)
                        }
                        className="accent-teal-400"
                      />
                      <span>Credibility-Weighted Raw VGI</span>
                    </label>
                  </div>
                </div>

                {/* US-1.4 Ground-Truth Algorithmic Benchmark Evaluation Table */}
                {summary && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-bold text-amber-300">
                        <Award className="h-4 w-4" /> Ground-Truth Benchmark vs. True &lambda;(e,m,t) (US-1.4)
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        Planar Bias: +{summary.meanPlanarOverestimationPct}%
                      </span>
                    </div>

                    <table className="w-full text-left border-collapse font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                          <th className="py-1">Method</th>
                          <th className="py-1 text-right" title="Prediction Accuracy Index (Top 10% Network Length)">
                            PAI@10%
                          </th>
                          <th className="py-1 text-right" title="Recapture Rate Index (Top 15% Network Length)">
                            RRI@15%
                          </th>
                          <th className="py-1 text-right" title="Normalized Root Mean Square Error vs True Lambda">
                            RMSE (&darr;)
                          </th>
                          <th className="py-1 text-right" title="Correlation with Ground-Truth Intensity">
                            Corr r (&uarr;)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        <tr className="text-teal-300 font-semibold">
                          <td className="py-1 font-sans">1D Network KDE (NKDE)</td>
                          <td className="py-1 text-right">
                            {summary.nkdeBenchmark.paiTop10Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.nkdeBenchmark.rriTop15Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.nkdeBenchmark.rmseVsTrueLambda}
                          </td>
                          <td className="py-1 text-right">
                            {summary.nkdeBenchmark.pearsonCorrelation}
                          </td>
                        </tr>
                        <tr className="text-amber-300">
                          <td className="py-1 font-sans">2D Planar KDE (Euclidean)</td>
                          <td className="py-1 text-right">
                            {summary.planarBenchmark.paiTop10Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.planarBenchmark.rriTop15Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.planarBenchmark.rmseVsTrueLambda}
                          </td>
                          <td className="py-1 text-right">
                            {summary.planarBenchmark.pearsonCorrelation}
                          </td>
                        </tr>
                        <tr className="text-sky-300">
                          <td className="py-1 font-sans">Empirical Bayes (EB)</td>
                          <td className="py-1 text-right">
                            {summary.ebBenchmark.paiTop10Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.ebBenchmark.rriTop15Pct}
                          </td>
                          <td className="py-1 text-right">
                            {summary.ebBenchmark.rmseVsTrueLambda}
                          </td>
                          <td className="py-1 text-right">
                            {summary.ebBenchmark.pearsonCorrelation}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* Assumption Check & Autocorrelation Summary */}
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 text-[10px] space-y-1 text-slate-300">
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-400 font-medium">
                          ✓ {summary.assumptionMessage}
                        </span>
                      </div>
                      <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-slate-400">
                        <span>
                          Gi* Significant Hotspots:{" "}
                          <strong className="text-rose-400">
                            {summary.significantHotspotCount} lixels
                          </strong>
                        </span>
                        <span>
                          N-DBSCAN Clusters:{" "}
                          <strong className="text-purple-400">
                            {summary.dbscanClusterCount} subgraphs
                          </strong>
                        </span>
                        <span>
                          Peak Planar Bias:{" "}
                          <strong className="text-amber-300">
                            {summary.maxDistortionLixelCode}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Selected Lixel Micro-Inspector */}
                {selectedLixel && (
                  <div className="rounded-lg border border-teal-500/30 bg-slate-950/90 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-bold text-teal-300 flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" /> Selected Lixel Telemetry:{" "}
                        <span className="font-mono text-white">
                          {selectedLixel.lixelCode}
                        </span>
                      </span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        LRS m=[{selectedLixel.mStartM}m, {selectedLixel.mEndM}m]
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          Network NKDE
                        </span>
                        <strong className="text-teal-300">
                          {selectedLixel.nkdeValue.toFixed(3)}
                        </strong>
                      </div>
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          Planar 2D KDE
                        </span>
                        <strong className="text-amber-300">
                          {selectedLixel.planarKdeValue.toFixed(3)}
                        </strong>
                      </div>
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          Planar Bias &Delta;
                        </span>
                        <strong
                          className={
                            selectedLixel.kdeDiffValue > 0
                              ? "text-rose-400"
                              : "text-sky-300"
                          }
                        >
                          {selectedLixel.kdeDiffValue > 0 ? "+" : ""}
                          {selectedLixel.kdeDiffValue.toFixed(3)}
                        </strong>
                      </div>
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          Gi* Z / p_FDR
                        </span>
                        <strong className="text-white">
                          z={selectedLixel.giStarZ.toFixed(2)} (p=
                          {selectedLixel.giStarFdrPValue.toFixed(3)})
                        </strong>
                      </div>
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          Gi* Classification
                        </span>
                        <strong className="text-rose-300 text-[10px]">
                          {selectedLixel.giStarClusterType}
                        </strong>
                      </div>
                      <div className="rounded bg-slate-900 p-1.5">
                        <span className="text-[9px] text-slate-400 block">
                          True &lambda;(e,m)
                        </span>
                        <strong className="text-emerald-400">
                          {selectedLixel.trueIntensityLambda.toFixed(3)}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== TAB 2: CITIZEN VGI REPORTER (EPIC 2) ==================== */}
            {activeTab === "citizen_vgi" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="font-bold text-sm text-white flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-rose-400" /> Uncertainty-Aware Citizen VGI Acquisition
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Preserves raw observation coordinate + probabilistic topological snap candidates
                    </p>
                  </div>
                  <button
                    onClick={() => setCitizenPinMode((v) => !v)}
                    className={`rounded px-2.5 py-1 text-xs font-semibold border transition ${
                      citizenPinMode
                        ? "bg-rose-500/25 border-rose-500 text-rose-200"
                        : "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    {citizenPinMode ? "Click Map Now..." : "Pick on Map"}
                  </button>
                </div>

                {/* Coordinate & Observational Uncertainty Inputs */}
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Raw Easting X (m)
                    </label>
                    <input
                      type="number"
                      value={vgiXM}
                      onChange={(e) => setVgiXM(Number(e.target.value))}
                      className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Raw Northing Y (m)
                    </label>
                    <input
                      type="number"
                      value={vgiYM}
                      onChange={(e) => setVgiYM(Number(e.target.value))}
                      className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Uncertainty r<sub>obs</sub>:{" "}
                      <strong className="text-rose-400">{vgiRadiusM}m</strong>
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={75}
                      value={vgiRadiusM}
                      onChange={(e) => setVgiRadiusM(Number(e.target.value))}
                      className="mt-2 w-full accent-rose-500"
                    />
                  </div>
                </div>

                {/* US-3.1 Live Probabilistic Topological Snap Candidates */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-teal-300">
                      Topological Candidate Road Snaps P(e<sub>k</sub> | p<sub>raw</sub>)
                    </span>
                    <label className="flex items-center gap-1 text-[10px] text-amber-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vgiOverpassHint}
                        onChange={(e) => setVgiOverpassHint(e.target.checked)}
                        className="accent-amber-400"
                      />
                      <span>On Elevated Overpass Deck</span>
                    </label>
                  </div>
                  <div className="space-y-1">
                    {vgiSnapCandidates.slice(0, 3).map((cand, idx) => (
                      <div
                        key={`${cand.segmentId}_${idx}`}
                        className={`flex items-center justify-between rounded px-2 py-1 text-[11px] font-mono ${
                          idx === 0
                            ? "bg-teal-500/15 border border-teal-500/40 text-teal-200"
                            : "bg-slate-900 text-slate-400"
                        }`}
                      >
                        <span className="truncate font-sans">
                          <strong className="font-mono">
                            #{idx + 1} {cand.segmentCode}
                          </strong>{" "}
                          {cand.segmentName} ({cand.roadClass})
                        </span>
                        <span>
                          d<sub>&perp;</sub>={cand.orthogonalDistM}m · m=
                          {cand.linearOffsetM}m ·{" "}
                          <strong className="text-white">
                            P={(cand.probabilityScore * 100).toFixed(1)}%
                          </strong>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* US-2.3 Real-Time Spatiotemporal Network Conflation Alert */}
                {vgiConflationAlerts.length > 0 && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-950/25 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" /> Spatiotemporal Network Conflation Alert (US-2.3)
                      </span>
                      <span className="font-mono text-[10px]">
                        {vgiConflationAlerts.length} Nearby Active
                      </span>
                    </div>
                    {vgiConflationAlerts.slice(0, 2).map((al) => (
                      <div
                        key={al.incidentId}
                        className="flex items-center justify-between gap-2 rounded bg-slate-950/90 p-2 text-[11px]"
                      >
                        <div>
                          <div className="font-semibold text-white">
                            {al.incidentCode} ({al.categoryCode.replace(/_/g, " ")})
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">
                            &Delta;d<sub>net</sub>={al.networkDistanceM}m (Euc:{" "}
                            {al.euclideanDistanceM}m) · &Delta;t={al.timeDeltaMinutes}m ·
                            Witnesses={al.witnessCount}
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleSubmitCitizenVgi(
                              "corroborate_existing",
                              al.incidentId
                            )
                          }
                          className="shrink-0 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400"
                        >
                          Corroborate (+1 Witness)
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Structured Incident Attribution Form (US-2.2) */}
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Accident Taxonomy
                    </label>
                    <select
                      value={vgiCategory}
                      onChange={(e) => setVgiCategory(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      {platformData.categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      KABCO Severity Level
                    </label>
                    <select
                      value={vgiSeverity}
                      onChange={(e) => setVgiSeverity(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    >
                      {platformData.severityLevels.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.label} (EPDO={s.epdoWeight})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Vehicles / Pedestrians
                    </label>
                    <div className="mt-0.5 flex gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={vgiVehicleCount}
                        onChange={(e) =>
                          setVgiVehicleCount(Number(e.target.value))
                        }
                        className="w-1/2 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white"
                        title="Vehicle Count"
                      />
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={vgiPedestrianCount}
                        onChange={(e) =>
                          setVgiPedestrianCount(Number(e.target.value))
                        }
                        className="w-1/2 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white"
                        title="Pedestrian Count"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400">
                      Weather / Road Surface
                    </label>
                    <div className="mt-0.5 flex gap-1.5">
                      <select
                        value={vgiWeather}
                        onChange={(e) => setVgiWeather(e.target.value)}
                        className="w-1/2 rounded border border-slate-700 bg-slate-900 px-1 py-1 text-xs text-white"
                      >
                        <option>Clear</option>
                        <option>Rain</option>
                        <option>Overcast</option>
                        <option>Fog</option>
                      </select>
                      <select
                        value={vgiSurface}
                        onChange={(e) => setVgiSurface(e.target.value)}
                        className="w-1/2 rounded border border-slate-700 bg-slate-900 px-1 py-1 text-xs text-white"
                      >
                        <option>Dry</option>
                        <option>Wet</option>
                        <option>Damp</option>
                      </select>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] text-slate-400">
                      Observation Narrative &amp; EXIF-Scrubbed Evidence Attachment
                    </label>
                    <input
                      type="text"
                      value={vgiNarrative}
                      onChange={(e) => setVgiNarrative(e.target.value)}
                      className="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-emerald-400">
                        ✓ EXIF Strip &amp; Bounds Guard Active ({vgiAttachmentName})
                      </span>
                      <button
                        onClick={() => handleSubmitCitizenVgi("create_new")}
                        className="rounded bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 shadow transition"
                      >
                        Submit Distinct VGI Report
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== TAB 3: STEWARD QA & CONFLATION WORKSPACE (EPIC 3) ==================== */}
            {activeTab === "steward_qa" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="font-bold text-sm text-white flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-teal-400" /> VGI Quality Assurance &amp; Stewardship
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Topological snap override, duplicate conflation &amp; immutable audit log
                    </p>
                  </div>
                </div>

                {/* Macro VGI Quality Diagnostics (US-3.3) */}
                <div className="grid grid-cols-4 gap-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 font-mono text-[11px]">
                  <div>
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Mean Drift d<sub>&perp;</sub>
                    </span>
                    <strong className="text-amber-300">
                      {platformData.vgiDiagnostics.meanPositionalDriftM}m
                    </strong>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Mean Lag &Delta;t
                    </span>
                    <strong className="text-sky-300">
                      {platformData.vgiDiagnostics.meanReportingLagMin} min
                    </strong>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Raw Unverified
                    </span>
                    <strong className="text-rose-400">
                      {
                        platformData.vgiDiagnostics.statusCounts
                          .unverified_raw_vgi
                      }
                    </strong>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-400 block font-sans">
                      Synth / Empir.
                    </span>
                    <strong className="text-teal-300">
                      {platformData.vgiDiagnostics.statusCounts.syntheticCount} /{" "}
                      {
                        platformData.vgiDiagnostics.statusCounts
                          .empiricalVgiCount
                      }
                    </strong>
                  </div>
                </div>

                {/* Status Filter Pills */}
                <div className="flex flex-wrap gap-1 text-[10px]">
                  {[
                    { id: "all", label: "All Reports" },
                    { id: "unverified_raw_vgi", label: "Unverified Raw VGI" },
                    { id: "flagged", label: "Flagged" },
                    { id: "verified_canonical", label: "Verified Canonical" },
                    { id: "conflated_witness_child", label: "Conflated Child" },
                    { id: "rejected", label: "Rejected" },
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setStewardStatusFilter(st.id)}
                      className={`rounded px-2 py-0.5 font-medium transition ${
                        stewardStatusFilter === st.id
                          ? "bg-teal-500/25 text-teal-300 border border-teal-500/50"
                          : "bg-slate-950 text-slate-400 hover:bg-slate-800 border border-slate-800"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>

                {/* Triage Queue List */}
                <div className="max-h-36 overflow-y-auto space-y-1 rounded border border-slate-800 bg-slate-950/60 p-1.5">
                  {stewardFilteredAccidents.slice(0, 25).map((acc) => {
                    const isSel = selectedAccident?.id === acc.id;
                    return (
                      <button
                        key={acc.id}
                        onClick={() => setSelectedAccident(acc)}
                        className={`w-full flex items-center justify-between rounded px-2 py-1 text-left text-[11px] transition ${
                          isSel
                            ? "bg-teal-500/20 border border-teal-500/50 text-white"
                            : "hover:bg-slate-900 text-slate-300"
                        }`}
                      >
                        <div className="truncate">
                          <span className="font-mono font-semibold text-teal-300">
                            {acc.incidentCode}
                          </span>{" "}
                          · {acc.categoryCode.replace(/_/g, " ")} (
                          {acc.severityCode})
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[10px] shrink-0">
                          <span>C={(acc.credibilityScore * 100).toFixed(0)}%</span>
                          <span
                            className={`rounded px-1.5 py-0.2 ${
                              acc.verificationStatus === "verified_canonical"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : acc.verificationStatus ===
                                  "unverified_raw_vgi"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-rose-500/20 text-rose-300"
                            }`}
                          >
                            {acc.verificationStatus.replace(/_/g, " ")}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Incident Steward Inspector & Actions */}
                {selectedAccident && (
                  <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-teal-300">
                          {selectedAccident.incidentCode}
                        </span>
                        <span className="ml-2 text-[10px] text-slate-400 font-mono">
                          Drift d<sub>&perp;</sub>=
                          {selectedAccident.snapDistanceM}m · LRS m=
                          {selectedAccident.linearOffsetM}m · Witnesses=
                          {selectedAccident.witnessCount}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-amber-300">
                        Credibility:{" "}
                        {(selectedAccident.credibilityScore * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Topological Candidate Snap Override (US-3.1) */}
                    <div>
                      <div className="text-[10px] font-semibold uppercase text-slate-400 mb-1">
                        Topological Edge Snap Reassignment (US-3.1):
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {selectedAccident.snapCandidatesJson
                          ?.slice(0, 4)
                          .map((cand, cIdx) => {
                            const isCurrent =
                              cand.segmentId ===
                              selectedAccident.snappedSegmentId;
                            return (
                              <button
                                key={`${cand.segmentId}_${cIdx}`}
                                onClick={() =>
                                  handleStewardAction({
                                    accidentId: selectedAccident.id,
                                    action: "override_snap_candidate",
                                    candidateIndex: cIdx,
                                  })
                                }
                                className={`rounded px-2 py-1 text-left text-[10px] border transition ${
                                  isCurrent
                                    ? "bg-teal-500/20 border-teal-500 text-teal-200"
                                    : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800"
                                }`}
                              >
                                <div className="font-semibold truncate">
                                  {cand.segmentCode}: {cand.segmentName}
                                </div>
                                <div className="font-mono text-[9px]">
                                  d={cand.orthogonalDistM}m · m=
                                  {cand.linearOffsetM}m · P=
                                  {(cand.probabilityScore * 100).toFixed(0)}%
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    {/* Duplicate Conflation Merge Control (US-3.2) */}
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800">
                      <select
                        value={mergeTargetId}
                        onChange={(e) =>
                          setMergeTargetId(
                            e.target.value ? Number(e.target.value) : ""
                          )
                        }
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-white"
                      >
                        <option value="">
                          Select Canonical Incident to Conflate Into...
                        </option>
                        {platformData.accidents
                          .filter(
                            (a) =>
                              a.id !== selectedAccident.id &&
                              a.verificationStatus === "verified_canonical"
                          )
                          .slice(0, 12)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.incidentCode} (Seg #{a.snappedSegmentId}, m=
                              {a.linearOffsetM}m)
                            </option>
                          ))}
                      </select>
                      <button
                        disabled={!mergeTargetId}
                        onClick={() => {
                          if (!mergeTargetId) return;
                          handleStewardAction({
                            accidentId: selectedAccident.id,
                            action: "merge_duplicate",
                            canonicalIncidentId: Number(mergeTargetId),
                          });
                        }}
                        className="flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
                      >
                        <GitMerge className="h-3 w-3" /> Conflate
                      </button>
                    </div>

                    {/* Verify / Flag / Reject Buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                      <input
                        type="text"
                        value={stewardNotes}
                        onChange={(e) => setStewardNotes(e.target.value)}
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                        placeholder="Verification audit note..."
                      />
                      <button
                        onClick={() =>
                          handleStewardAction({
                            accidentId: selectedAccident.id,
                            newStatus: "verified_canonical",
                            verificationNotes: stewardNotes,
                          })
                        }
                        className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Verify
                      </button>
                      <button
                        onClick={() =>
                          handleStewardAction({
                            accidentId: selectedAccident.id,
                            newStatus: "flagged",
                            verificationNotes: stewardNotes,
                          })
                        }
                        className="flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
                      >
                        <AlertTriangle className="h-3 w-3" /> Flag
                      </button>
                      <button
                        onClick={() =>
                          handleStewardAction({
                            accidentId: selectedAccident.id,
                            newStatus: "rejected",
                            verificationNotes: stewardNotes,
                          })
                        }
                        className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
                      >
                        <XCircle className="h-3 w-3" /> Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== TAB 4: EXPOSURE-AWARE RISK & EMPIRICAL BAYES (EPIC 5) ==================== */}
            {activeTab === "risk_eb" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="font-bold text-sm text-white flex items-center gap-1.5">
                      <Sliders className="h-4 w-4 text-amber-400" /> Empirical Bayes &amp; Multi-Criteria Vulnerability
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      SPF baseline priors, RTM shrinkage, &amp; bivariate epistemic uncertainty (US-5.2–5.4)
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setLayerMode("bivariate_risk_uncertainty")
                    }
                    className="rounded bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30"
                  >
                    Show Bivariate Map
                  </button>
                </div>

                {/* Methodological Guard Note (US-5.3 Acceptance Criterion) */}
                <div className="rounded border border-amber-500/40 bg-amber-950/20 p-2 text-[10px] text-amber-200">
                  <strong>Methodological Guard (US-5.3):</strong> Composite Vulnerability Scores (0–100) are interpretable multi-criteria decision-support indices and are strictly distinguished from calibrated Poisson/EB crash probabilities.
                </div>

                {/* Interactive Sensitivity Sliders */}
                <div className="grid grid-cols-2 gap-2.5 rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                  <div>
                    <label className="flex justify-between text-[10px] text-slate-300">
                      <span>EB Expected Rate Weight</span>
                      <strong className="font-mono text-teal-300">
                        {(mcWeights.ebRiskWeight * 100).toFixed(0)}%
                      </strong>
                    </label>
                    <input
                      type="range"
                      min={0.1}
                      max={0.8}
                      step={0.05}
                      value={mcWeights.ebRiskWeight}
                      onChange={(e) =>
                        handleUpdateMcWeights({
                          ...mcWeights,
                          ebRiskWeight: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full accent-teal-400"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-[10px] text-slate-300">
                      <span>EPDO Severity Weight</span>
                      <strong className="font-mono text-rose-400">
                        {(mcWeights.epdoSeverityWeight * 100).toFixed(0)}%
                      </strong>
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={0.7}
                      step={0.05}
                      value={mcWeights.epdoSeverityWeight}
                      onChange={(e) =>
                        handleUpdateMcWeights({
                          ...mcWeights,
                          epdoSeverityWeight: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full accent-rose-400"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-[10px] text-slate-300">
                      <span>Geometric Hazard (Sinuosity)</span>
                      <strong className="font-mono text-amber-300">
                        {(mcWeights.geometricHazardWeight * 100).toFixed(0)}%
                      </strong>
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.05}
                      value={mcWeights.geometricHazardWeight}
                      onChange={(e) =>
                        handleUpdateMcWeights({
                          ...mcWeights,
                          geometricHazardWeight: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full accent-amber-400"
                    />
                  </div>
                  <div>
                    <label className="flex justify-between text-[10px] text-slate-300">
                      <span>Environmental Friction Weight</span>
                      <strong className="font-mono text-sky-300">
                        {(mcWeights.environmentalHazardWeight * 100).toFixed(0)}%
                      </strong>
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.05}
                      value={mcWeights.environmentalHazardWeight}
                      onChange={(e) =>
                        handleUpdateMcWeights({
                          ...mcWeights,
                          environmentalHazardWeight: Number(e.target.value),
                        })
                      }
                      className="mt-1 w-full accent-sky-400"
                    />
                  </div>
                </div>

                {/* Ranked Corridor Priority Table with 95% CI & RTM Shrinkage */}
                <div className="max-h-56 overflow-y-auto rounded border border-slate-800 bg-slate-950/80 p-2">
                  <table className="w-full text-left border-collapse font-mono text-[10px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="py-1">Rank</th>
                        <th className="py-1">Corridor</th>
                        <th className="py-1 text-right">EB [95% CI]</th>
                        <th className="py-1 text-right">RTM &Delta;</th>
                        <th className="py-1 text-right">Vuln.Idx</th>
                        <th className="py-1 text-right">Unc.U</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {platformData.segmentRiskPortfolio
                        .slice()
                        .sort((a, b) => a.priorityRank - b.priorityRank)
                        .slice(0, 12)
                        .map((sr) => (
                          <tr
                            key={sr.segmentId}
                            onClick={() => setSelectedSegmentId(sr.segmentId)}
                            className="cursor-pointer hover:bg-slate-900"
                          >
                            <td className="py-1 text-teal-400 font-bold">
                              #{sr.priorityRank}
                            </td>
                            <td className="py-1 font-sans truncate max-w-[115px]">
                              {sr.segmentCode} {sr.name}
                            </td>
                            <td className="py-1 text-right text-white">
                              {sr.ebExpectedCount.toFixed(1)} [
                              {sr.confidenceInterval95[0]}–
                              {sr.confidenceInterval95[1]}]
                            </td>
                            <td className="py-1 text-right text-amber-300">
                              {sr.rtmShrinkageCorrection > 0 ? "-" : "+"}
                              {Math.abs(sr.rtmShrinkageCorrection).toFixed(2)}
                            </td>
                            <td className="py-1 text-right font-bold text-rose-400">
                              {sr.compositeVulnerabilityScore}
                            </td>
                            <td className="py-1 text-right">
                              <span
                                className="rounded px-1 py-0.2 text-white text-[9px]"
                                style={{ backgroundColor: sr.bivariateColorHex }}
                              >
                                {(sr.uncertaintyScore * 100).toFixed(0)}% (
                                {sr.bivariateClass})
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ==================== TAB 5: STOCHASTIC POINT-PROCESS SIMULATOR (EPIC 1) ==================== */}
            {activeTab === "simulator" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div>
                    <h2 className="font-bold text-sm text-white flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-purple-400" /> Stochastic Network Point-Process Generator
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      Controlled Inhomogeneous Cox/Poisson Process &lambda;(e,m,t) &amp; dynamic Lixel segmentation
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/80 p-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-400">
                      Ground-Truth Intensity Scenario &lambda;(s, t) (US-1.2)
                    </label>
                    <select
                      value={simScenario}
                      onChange={(e) => setSimScenario(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="multi_covariate_complex_urban">
                        Multi-Covariate Complex Urban Cox Process (Publication Default)
                      </option>
                      <option value="intersection_clustered">
                        Intersection-Clustered Topological Exponential Decay
                      </option>
                      <option value="diurnal_rush_hour_shock">
                        Diurnal Bimodal Commuter Rush-Hour Shock
                      </option>
                      <option value="uniform_baseline">
                        Uniform Homogeneous Linear Poisson Baseline
                      </option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-slate-400">
                        Lixel Resolution &Delta;l (MAUP Control US-1.1)
                      </label>
                      <select
                        value={simLixelSizeM}
                        onChange={(e) =>
                          setSimLixelSizeM(Number(e.target.value))
                        }
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-mono text-teal-300"
                      >
                        <option value={25}>25m Fine Micro-Lixels</option>
                        <option value={50}>50m Standard Urban Lixels</option>
                        <option value={100}>100m Corridor Lixels</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-semibold uppercase text-slate-400">
                        Deterministic PRNG Seed
                      </label>
                      <input
                        type="number"
                        value={simSeed}
                        onChange={(e) => setSimSeed(Number(e.target.value))}
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        GPS Drift &sigma;<sub>pos</sub>:{" "}
                        <strong className="text-amber-300">{simDriftStdM}m</strong>
                      </label>
                      <input
                        type="range"
                        min={4}
                        max={35}
                        value={simDriftStdM}
                        onChange={(e) =>
                          setSimDriftStdM(Number(e.target.value))
                        }
                        className="mt-1 w-full accent-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        Witness Burst:{" "}
                        <strong className="text-teal-300">
                          {(simDupBurstRate * 100).toFixed(0)}%
                        </strong>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={0.7}
                        step={0.04}
                        value={simDupBurstRate}
                        onChange={(e) =>
                          setSimDupBurstRate(Number(e.target.value))
                        }
                        className="mt-1 w-full accent-teal-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400">
                        False Alarms:{" "}
                        <strong className="text-rose-400">
                          {(simFalseAlarmRate * 100).toFixed(0)}%
                        </strong>
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={0.25}
                        step={0.02}
                        value={simFalseAlarmRate}
                        onChange={(e) =>
                          setSimFalseAlarmRate(Number(e.target.value))
                        }
                        className="mt-1 w-full accent-rose-400"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      onClick={() => setLayerMode("ground_truth_lambda")}
                      className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Inspect True &lambda;(s,t) Map
                    </button>
                    <button
                      onClick={handleRunSimulator}
                      className="flex items-center gap-1.5 rounded bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-purple-500 shadow transition"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Realize Seeded Point Process
                    </button>
                  </div>
                </div>

                {/* Recent Immutable Audit Trail */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Immutable Geocomputation &amp; Stewardship Audit Trail
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[10px]">
                    {platformData.auditLogs.slice(0, 8).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between rounded bg-slate-900/90 px-2 py-1 text-slate-300"
                      >
                        <span className="truncate">
                          <strong className="text-teal-300">
                            {log.actionType}
                          </strong>{" "}
                          [{log.entityId}] by {log.actorName}
                        </span>
                        <span className="text-slate-500 text-[9px] shrink-0">
                          {new Date(log.createdAt).toISOString().slice(11, 19)} UTC
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Full-Width Coordinated Multiple Views (CMV) Linked-Brushing Dock (12 cols) */}
        <div className="xl:col-span-12">
          <CoordinatedAnalyticsDock
            allAccidents={activeAnalyticalAccidents}
            filteredAccidents={filteredAccidents}
            segmentRiskPortfolio={platformData.segmentRiskPortfolio}
            selectedHourRange={selectedHourRange}
            onChangeHourRange={setSelectedHourRange}
            selectedSeverity={selectedSeverity}
            onChangeSeverity={setSelectedSeverity}
            selectedCategory={selectedCategory}
            onChangeCategory={setSelectedCategory}
            selectedWeather={selectedWeather}
            onChangeWeather={setSelectedWeather}
            selectedSegmentId={selectedSegmentId}
            onSelectSegment={setSelectedSegmentId}
            spatialBBox={spatialBBox}
            onResetAllFilters={handleResetAllFilters}
          />
        </div>
      </main>

      {/* Formal Mathematical Formulations & Open Geospatial Export Modal */}
      <MathematicalFormulationModal
        isOpen={isFormulaModalOpen}
        onClose={() => setIsFormulaModalOpen(false)}
        latestJob={platformData.latestJob}
        onDownloadGeoJson={handleDownloadGeoJson}
        onDownloadCsvSummary={handleDownloadCsvSummary}
      />
    </div>
  );
}
