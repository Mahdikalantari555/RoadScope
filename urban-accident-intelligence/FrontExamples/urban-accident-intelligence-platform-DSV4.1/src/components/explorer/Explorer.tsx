"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CircleDot,
  Download,
  Flame,
  FlaskConical,
  Grid3x3,
  Info,
  Layers,
  MapPin,
  Maximize2,
  Radar,
  ShieldAlert,
  Waypoints,
} from "lucide-react";
import { MapView, type MapMode, type NetworkPayload, type Viewport } from "@/components/map/MapView";
import { BASEMAP_OPTIONS, type BasemapVariant } from "@/components/map/style";
import { EChart } from "@/components/charts/EChart";
import { FilterBar } from "@/components/FilterBar";
import { Callout, Divider, EmptyState, Kpi, LoadingRows, MetricGrid, Panel, SectionLabel, SeverityDot, StatusBadge, ToggleChip } from "@/components/ui";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  formatNumber,
  formatPct,
  useApi,
  type AccidentDetailResponse,
  type AccidentsResponse,
  type AnalysisResponse,
  type FilterState,
  type MetaPayload,
  type NetworkResponse,
  type RiskResponse,
  type StatsResponse,
} from "@/lib/client/api";
import type { AnalysisKind, AnalysisParams } from "@/lib/analysis";
import { DEFAULT_ANALYSIS_PARAMS } from "@/lib/analysis";
import { categoryOption, severityOption } from "@/lib/chartOptions";
import { formatDistance } from "@/lib/geo";

const MODES: { mode: MapMode; label: string; icon: typeof CircleDot; hint: string; analytic: AnalysisKind | "risk" | null }[] = [
  { mode: "points", label: "Incidents", icon: CircleDot, hint: "Individual events, severity-styled", analytic: null },
  { mode: "clusters", label: "Clusters", icon: Boxes, hint: "Zoom-dependent aggregation", analytic: null },
  { mode: "heat", label: "Heatmap", icon: Flame, hint: "Descriptive density", analytic: null },
  { mode: "kde", label: "KDE", icon: Radar, hint: "Gaussian kernel surface", analytic: "kde" },
  { mode: "hotspot", label: "Hotspots", icon: Grid3x3, hint: "Getis-Ord Gi* screen", analytic: "hotspot" },
  { mode: "dbscan", label: "DBSCAN", icon: Waypoints, hint: "Density clusters + noise", analytic: "dbscan" },
  { mode: "segments", label: "Segments", icon: Layers, hint: "Road-segment counts", analytic: "segment" },
  { mode: "risk", label: "Risk", icon: ShieldAlert, hint: "Relative risk index", analytic: "risk" },
  { mode: "environment", label: "Environment", icon: MapPin, hint: "Road / weather context", analytic: "environment" },
];

const SEVERITY_LEGEND = [
  { label: "Fatal", color: "#e5402a" },
  { label: "Serious injury", color: "#f2762e" },
  { label: "Slight injury", color: "#e3b341" },
  { label: "Property damage", color: "#7d8fa3" },
  { label: "Pending report", color: "#e3b341" },
];

export function Explorer({ initialMeta }: { initialMeta: MetaPayload }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [mode, setMode] = useState<MapMode>("clusters");
  const [basemap, setBasemap] = useState<BasemapVariant>("night");
  const [toggles, setToggles] = useState({ roads: true, districts: true, water: true, parks: true, heat: true, intersections: true });
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_ANALYSIS_PARAMS);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<Record<string, unknown> | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [tab, setTab] = useState<"insight" | "inspector" | "quality">("insight");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisNonce, setAnalysisNonce] = useState(0);

  const query = filtersToQuery(filters);
  const network = useApi<NetworkResponse>("/api/network");
  const accidents = useApi<AccidentsResponse>(`/api/accidents?format=geojson&${query}`, [query], { keepPrevious: true });
  const stats = useApi<StatsResponse>(`/api/stats?${query}`, [query], { keepPrevious: true });
  const bboxQuery = viewport
    ? `&minLng=${viewport.bbox[0]}&minLat=${viewport.bbox[1]}&maxLng=${viewport.bbox[2]}&maxLat=${viewport.bbox[3]}`
    : "";
  const viewportStats = useApi<StatsResponse>(viewport ? `/api/stats?${query}${bboxQuery}` : null, [query, bboxQuery], { keepPrevious: true });
  const activeMode = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const isRisk = activeMode.analytic === "risk";
  const riskUrl = isRisk ? `/api/risk?${query}` : null;
  const risk = useApi<RiskResponse>(riskUrl, [query, isRisk]);
  const detail = useApi<AccidentDetailResponse>(selected?.publicId ? `/api/accidents/${String(selected.publicId)}` : null, [selected?.publicId]);

  useEffect(() => {
    const stored = window.localStorage.getItem("uai-basemap");
    if (stored === "night" || stored === "day" || stored === "minimal") setBasemap(stored);
    const themeHandler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setBasemap((current) => (current === "minimal" ? current : detail === "light" ? "day" : "night"));
    };
    window.addEventListener("uai-theme-change", themeHandler);
    return () => window.removeEventListener("uai-theme-change", themeHandler);
  }, []);

  useEffect(() => {
    if (!activeMode.analytic || isRisk) {
      setAnalysis(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          kind: activeMode.analytic,
          filters: {
            from: filters.from,
            to: `${filters.to}T23:59:59Z`,
            status: filters.status.join(","),
            category: filters.categories.join(","),
            severity: filters.severities.join(","),
            district: filters.districts.join(","),
            dow: filters.dows.join(","),
            hourFrom: String(filters.hourFrom),
            hourTo: String(filters.hourTo),
          },
          params: {
            bandwidthM: String(params.bandwidthM),
            cellSizeM: String(params.cellSizeM),
            weightBy: params.weightBy,
            epsM: String(params.epsM),
            minPts: String(params.minPts),
            metric: params.metric,
          },
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Analysis failed");
          return (await response.json()) as AnalysisResponse;
        })
        .then((payload) => {
          setAnalysis(payload);
          setAnalysisLoading(false);
        })
        .catch((error: Error) => {
          if (error.name === "AbortError") return;
          setAnalysisError(error.message);
          setAnalysisLoading(false);
        });
    }, 320);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, params.bandwidthM, params.cellSizeM, params.weightBy, params.epsM, params.minPts, params.metric, analysisNonce]);

  const cityBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    const features = network.data?.segments?.features ?? [];
    if (features.length === 0) return null;
    let minLng = 180;
    let minLat = 90;
    let maxLng = -180;
    let maxLat = -90;
    for (const feature of features) {
      if (feature.geometry.type !== "LineString") continue;
      for (const coordinate of feature.geometry.coordinates) {
        minLng = Math.min(minLng, coordinate[0]);
        maxLng = Math.max(maxLng, coordinate[0]);
        minLat = Math.min(minLat, coordinate[1]);
        maxLat = Math.max(maxLat, coordinate[1]);
      }
    }
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }, [network.data]);

  const activeLegend = useMemo(() => {
    if (mode === "kde" && analysis) return analysis.legend.map((l) => ({ label: l.label, color: l.color }));
    if (mode === "hotspot" && analysis) return analysis.legend.map((l) => ({ label: l.label, color: l.color }));
    if (mode === "dbscan") return [{ label: "Cluster hull", color: "#22d3ee" }, { label: "Noise event", color: "#475569" }];
    if (mode === "segments" || mode === "risk")
      return [
        { label: "Very low", color: "#164e63" },
        { label: "Low", color: "#0e7490" },
        { label: "Moderate", color: "#22d3ee" },
        { label: "High", color: "#e3b341" },
        { label: "Very high", color: "#e5402a" },
      ];
    if (mode === "environment") return analysis?.legend ?? SEVERITY_LEGEND;
    if (mode === "heat") return [{ label: "Low density", color: "#0e7490" }, { label: "Moderate", color: "#22d3ee" }, { label: "High", color: "#e3b341" }, { label: "Peak", color: "#e5402a" }];
    return SEVERITY_LEGEND;
  }, [mode, analysis]);

  const networkForMap: NetworkPayload | null = network.data
    ? {
        segments: network.data.segments,
        intersections: network.data.intersections,
        water: network.data.water,
        parks: network.data.parks,
        districts: network.data.districts,
      }
    : null;

  const mapAccidents = mode === "points" || mode === "clusters" || mode === "heat" || mode === "kde" || mode === "temporal" ? accidents.data : null;
  const mapAnalysis = analysis?.features ?? null;
  const mapSegmentValues = isRisk ? risk.data?.features ?? null : null;
  const analysisMetrics = analysis?.metrics ?? (isRisk && risk.data ? riskMetrics(risk.data) : []);
  const analysisTitle = analysis?.title ?? (isRisk ? "Relative risk index by road segment" : activeMode.label);
  const analysisDescription =
    analysis?.description ??
    (isRisk
      ? "Weighted, min-max normalised index blending frequency, severity, density, exposure and environmental components. Ordinal within this network — not a calibrated probability."
      : activeMode.hint);
  const metricSummary = stats.data?.stats;
  const statusCounts = stats.data?.statusCounts ?? {};
  const viewportTotal = viewportStats.data?.stats.total ?? 0;
  const isLoading = accidents.loading || stats.loading;

  const exportHref = (format: "csv" | "geojson") => `/api/export?kind=accidents&format=${format}&${query}`;
  const setBasemapPersisted = (value: BasemapVariant) => {
    setBasemap(value);
    window.localStorage.setItem("uai-basemap", value);
  };

  return (
    <div className="flex min-h-[calc(100vh-48px)] flex-col bg-bg lg:h-[calc(100vh-48px)] lg:flex-row lg:overflow-hidden">
      {/* ---------------------------------------------------------- controls */}
      <aside className="order-2 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:order-1 lg:h-full lg:w-[272px] lg:border-r">
        <Panel title="Analytical layer" icon={<Layers size={12} />} bodyClassName="p-1.5">
          <div className="grid grid-cols-2 gap-1">
            {MODES.map((item) => {
              const Icon = item.icon;
              const active = mode === item.mode;
              return (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => setMode(item.mode)}
                  title={item.hint}
                  className={`flex flex-col gap-0.5 rounded-[3px] border px-2 py-1.5 text-left transition-colors focus-ring ${
                    active ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11.5px] font-medium">
                    <Icon size={12} /> {item.label}
                  </span>
                  <span className="text-[9.5px] leading-tight text-faint">{item.hint}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Filters" icon={<BarChart3 size={12} />}>
          <FilterBar filters={filters} onChange={setFilters} meta={initialMeta} compact />
        </Panel>

        {(activeMode.analytic && !isRisk) || isRisk ? (
          <Panel title="Parameters" icon={<FlaskConical size={12} />}>
            {isRisk ? (
              <div className="space-y-2 text-[11px] text-muted">
                <p>
                  Explorer risk view uses the default transparent weights. Configure weighting, stability and exposure options in the dedicated
                  workspace.
                </p>
                <Link href="/risk" className="btn btn-xs w-full">
                  <ShieldAlert size={11} /> Open risk workspace
                </Link>
              </div>
            ) : (
              <div className="space-y-2.5">
                {(mode === "kde" || mode === "hotspot") && (
                  <label className="block">
                    <span className="label-caps flex justify-between">
                      <span>Bandwidth</span>
                      <span className="mono text-accent">{params.bandwidthM} m</span>
                    </span>
                    <input
                      type="range"
                      min={80}
                      max={700}
                      step={20}
                      value={params.bandwidthM}
                      onChange={(event) => setParams({ ...params, bandwidthM: Number(event.target.value) })}
                      className="mt-1 w-full accent-[var(--accent)]"
                    />
                  </label>
                )}
                {mode === "kde" && (
                  <>
                    <label className="block">
                      <span className="label-caps flex justify-between">
                        <span>Cell size</span>
                        <span className="mono text-accent">{params.cellSizeM} m</span>
                      </span>
                      <input
                        type="range"
                        min={60}
                        max={320}
                        step={20}
                        value={params.cellSizeM}
                        onChange={(event) => setParams({ ...params, cellSizeM: Number(event.target.value) })}
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </label>
                    <label className="block">
                      <span className="label-caps mb-1 block">Weighting</span>
                      <select className="select" value={params.weightBy} onChange={(event) => setParams({ ...params, weightBy: event.target.value as AnalysisParams["weightBy"] })}>
                        <option value="severity">Severity-weighted</option>
                        <option value="count">Unweighted count</option>
                        <option value="casualties">Casualty-weighted</option>
                      </select>
                    </label>
                  </>
                )}
                {mode === "dbscan" && (
                  <>
                    <label className="block">
                      <span className="label-caps flex justify-between">
                        <span>eps</span>
                        <span className="mono text-accent">{params.epsM} m</span>
                      </span>
                      <input
                        type="range"
                        min={60}
                        max={500}
                        step={20}
                        value={params.epsM}
                        onChange={(event) => setParams({ ...params, epsM: Number(event.target.value) })}
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </label>
                    <label className="block">
                      <span className="label-caps flex justify-between">
                        <span>minPts</span>
                        <span className="mono text-accent">{params.minPts}</span>
                      </span>
                      <input
                        type="range"
                        min={2}
                        max={20}
                        step={1}
                        value={params.minPts}
                        onChange={(event) => setParams({ ...params, minPts: Number(event.target.value) })}
                        className="mt-1 w-full accent-[var(--accent)]"
                      />
                    </label>
                  </>
                )}
                {mode === "segments" && (
                  <label className="block">
                    <span className="label-caps mb-1 block">Segment metric</span>
                    <select className="select" value={params.metric} onChange={(event) => setParams({ ...params, metric: event.target.value as AnalysisParams["metric"] })}>
                      <option value="severity">Severity-weighted</option>
                      <option value="count">Accident count</option>
                      <option value="density">Events per km</option>
                      <option value="ksi">KSI count</option>
                    </select>
                  </label>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="btn btn-xs" onClick={() => setAnalysisNonce((n) => n + 1)}>
                    Re-run analysis
                  </button>
                  {analysisLoading && <span className="text-[10px] text-accent">computing…</span>}
                </div>
                {analysisError && <div className="text-[10.5px] text-danger">{analysisError}</div>}
              </div>
            )}
          </Panel>
        ) : null}

        <Panel title="Map layers & basemap" icon={<Maximize2 size={12} />}>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {[
                { key: "roads", label: "Roads" },
                { key: "districts", label: "Districts" },
                { key: "water", label: "Water" },
                { key: "parks", label: "Parks" },
                { key: "intersections", label: "Junctions" },
              ].map((layer) => (
                <ToggleChip
                  key={layer.key}
                  active={Boolean(toggles[layer.key as keyof typeof toggles])}
                  onClick={() => setToggles({ ...toggles, [layer.key]: !toggles[layer.key as keyof typeof toggles] })}
                >
                  {layer.label}
                </ToggleChip>
              ))}
            </div>
            <label className="block">
              <span className="label-caps mb-1 block">Basemap</span>
              <select className="select" value={basemap} onChange={(event) => setBasemapPersisted(event.target.value as BasemapVariant)}>
                {BASEMAP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-1">
              <button type="button" className="btn btn-xs flex-1" onClick={() => setFitNonce((n) => n + 1)}>
                <Maximize2 size={11} /> Fit study area
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setSelected(null);
                  setSelectedSegment(null);
                  setFilters({ ...DEFAULT_FILTERS });
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Export" icon={<Download size={12} />}>
          <div className="grid grid-cols-2 gap-1">
            <a className="btn btn-xs" href={exportHref("geojson")} download>
              GeoJSON
            </a>
            <a className="btn btn-xs" href={exportHref("csv")} download>
              CSV
            </a>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
            Exports include the synthetic-data provenance header. {accidents.data?.meta.truncated ? "Map payload truncated at 8,000 records." : ""}
          </p>
          <Divider />
          <div className="flex items-center gap-1.5 text-[10px] text-faint">
            <Info size={11} /> Coordinates: WGS 84 · timestamps UTC
          </div>
        </Panel>
      </aside>

      {/* --------------------------------------------------------------- map */}
      <div className="relative order-1 h-[52vh] min-h-[360px] w-full flex-none lg:order-2 lg:h-full lg:min-h-0 lg:flex-1">
        <MapView
          mode={mode}
          accidents={mapAccidents}
          analysis={mapAnalysis}
          segmentValues={mapSegmentValues}
          network={networkForMap}
          basemap={basemap}
          toggles={toggles}
          selectedPublicId={selected?.publicId ? String(selected.publicId) : null}
          fitBounds={cityBounds}
          fitNonce={fitNonce}
          legend={activeLegend}
          onSelectAccident={(props) => {
            setSelected(props);
            setTab("inspector");
          }}
          onSelectSegment={(props) => setSelectedSegment(props)}
          onViewportChange={setViewport}
          showEmptyHint={!isLoading && (accidents.data?.features.length ?? 0) === 0 ? "No incidents match the current filter" : null}
        />
        <div className="pointer-events-none absolute right-2 top-12 flex flex-col items-end gap-1">
          <div className="panel pointer-events-auto flex items-center gap-2 px-2 py-1">
            <span className="label-caps">In view</span>
            <span className="mono text-[11px] text-accent">{formatNumber(viewportTotal)}</span>
            <span className="text-[10px] text-faint">events</span>
          </div>
          {(analysis || risk.data) && (
            <div className="panel pointer-events-auto px-2 py-1 text-[10px] text-faint">
              {analysis ? `${analysis.features.features.length} features · ${Math.round(analysis.durationMs)} ms` : `${risk.data?.features.features.length ?? 0} segments scored`}
            </div>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------- insights */}
      <aside className="order-3 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:h-full lg:w-[330px] lg:border-l">
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="Records in filter" value={isLoading ? "…" : formatNumber(metricSummary?.total ?? 0)} detail={`${formatNumber(statusCounts.verified ?? 0)} verified`} tone="accent" />
          <Kpi label="KSI incidents" value={isLoading ? "…" : formatNumber(metricSummary?.ksi ?? 0)} detail={`${formatNumber(metricSummary?.fatalities ?? 0)} fatalities`} tone="danger" />
          <Kpi label="Pending review" value={formatNumber(statusCounts.reported ?? 0)} detail="Unverified citizen reports" tone="warn" />
          <Kpi label="Network coverage" value={formatPct(metricSummary?.completeness.segment ?? 0, 1)} detail="Events matched to a segment" />
        </div>

        <div className="flex gap-1">
          {(["insight", "inspector", "quality"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 rounded-[3px] border px-2 py-1 text-[11px] capitalize focus-ring ${
                tab === value ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {tab === "insight" && (
          <>
            <Panel title={analysisTitle} icon={<Radar size={12} />} actions={<span className="badge">{mode}</span>}>
              {analysisLoading && !analysis && !risk.data ? (
                <LoadingRows rows={4} />
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] leading-relaxed text-muted">{analysisDescription}</p>
                  {analysisMetrics.length > 0 && <MetricGrid metrics={analysisMetrics.slice(0, 4)} columns={2} />}
                  {analysis && (
                    <>
                      <div className="space-y-1">
                        <SectionLabel>Legend</SectionLabel>
                        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                          {analysis.legend.map((entry) => (
                            <div key={entry.label} className="flex items-center gap-1.5 text-[10px] text-muted">
                              <span className="legend-swatch" style={{ background: entry.color }} />
                              <span className="truncate">{entry.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {analysis.tables[0] && (
                        <div>
                          <SectionLabel>{analysis.tables[0].title}</SectionLabel>
                          <div className="max-h-[160px] overflow-auto scroll-thin border border-line">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  {analysis.tables[0].columns.map((column) => (
                                    <th key={column.key} className={column.align === "right" ? "num" : ""}>
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {analysis.tables[0].rows.slice(0, 8).map((row, index) => (
                                  <tr key={index}>
                                    {analysis.tables[0].columns.map((column) => (
                                      <td key={column.key} className={column.align === "right" ? "num" : ""}>
                                        {String(row[column.key] ?? "")}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      <Callout tone="info" title="Method constraints">
                        <ul className="list-disc space-y-0.5 pl-3.5">
                          {analysis.assumptions.slice(0, 3).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </Callout>
                      <div className="text-[10px] text-faint">
                        Sample {analysis.sampleSize} · stored {analysis.storedFeatures} features · job #{analysis.jobId} ·{" "}
                        <a className="link" href={`/api/export?kind=analysis&format=geojson&jobId=${analysis.jobId}`} download>
                          download result
                        </a>
                      </div>
                    </>
                  )}
                  {isRisk && risk.data && (
                    <div className="space-y-1.5">
                      <MetricGrid
                        metrics={[
                          { label: "Segments scored", value: formatNumber(risk.data.summary.analysedSegments) },
                          { label: "Network", value: `${risk.data.summary.networkKm.toFixed(0)} km` },
                          { label: "Exposure coverage", value: formatPct(risk.data.summary.exposureCoverage, 0) },
                          { label: "Median index", value: risk.data.summary.medianRiskIndex.toFixed(1) },
                        ]}
                      />
                      <SectionLabel>Top ranked segments</SectionLabel>
                      <div className="space-y-1">
                        {risk.data.segments.slice(0, 6).map((segment) => (
                          <div key={segment.segmentId} className="flex items-center gap-2 text-[10.5px]">
                            <span className="mono w-5 text-faint">{segment.rank}</span>
                            <span className="min-w-0 flex-1 truncate text-muted">{segment.name}</span>
                            <span className="mono text-accent">{segment.riskIndex.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                      <Link href="/risk" className="btn btn-xs w-full">
                        Configure risk weights
                      </Link>
                    </div>
                  )}
                  {!activeMode.analytic && metricSummary && (
                    <div className="space-y-2">
                      <EChart option={severityOption(metricSummary)} height={132} />
                      <EChart option={categoryOption(metricSummary)} height={148} />
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Map-driven summary" icon={<MapPin size={12} />}>
              <p className="mb-2 text-[10.5px] leading-relaxed text-faint">
                Recomputed from the current viewport: {viewport ? `${viewport.bbox[1].toFixed(3)}…${viewport.bbox[3].toFixed(3)} N, ${viewport.bbox[0].toFixed(3)}…${viewport.bbox[2].toFixed(3)} E` : "pan the map"}.
              </p>
              {viewportStats.loading ? (
                <LoadingRows rows={3} />
              ) : viewportStats.data ? (
                <div className="space-y-2">
                  <MetricGrid
                    metrics={[
                      { label: "Events in view", value: formatNumber(viewportStats.data.stats.total) },
                      { label: "KSI in view", value: formatNumber(viewportStats.data.stats.ksi) },
                      { label: "Top district", value: viewportStats.data.stats.byDistrict[0]?.label ?? "—" },
                      { label: "Casualties", value: formatNumber(viewportStats.data.stats.casualties) },
                    ]}
                  />
                  <div>
                    <SectionLabel>Busiest segments in view</SectionLabel>
                    {viewportStats.data.stats.topSegments.slice(0, 3).map((segment) => (
                      <div key={segment.segmentId} className="flex items-center gap-2 border-b border-line/60 py-1 text-[10.5px] last:border-0">
                        <span className="min-w-0 flex-1 truncate text-muted">{segment.name}</span>
                        <span className="mono text-faint">n={segment.count}</span>
                        <span className="mono text-accent">{segment.densityPerKm.toFixed(1)}/km</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[9.5px] text-faint">Totals respect verification filters; pending reports are shown separately in the KPI strip.</p>
                </div>
              ) : (
                <div className="text-[11px] text-faint">Pan or zoom the map to query the current extent.</div>
              )}
            </Panel>
          </>
        )}

        {tab === "inspector" && (
          <>
            <Panel title="Feature inspector" icon={<CircleDot size={12} />} actions={selected ? <StatusBadge status={String(selected.status ?? "")} /> : null}>
              {!selected && !selectedSegment && (
                <EmptyState
                  title="Nothing selected"
                  message="Click an accident, hotspot location or road segment on the map. Hotspots open the underlying incident; segments show aggregated statistics."
                  icon={<CircleDot size={22} />}
                />
              )}
              {selected && detail.loading && <LoadingRows rows={5} />}
              {selected && detail.data && (
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="mono text-[12.5px] font-semibold text-ink">{detail.data.accident.publicId}</div>
                      <div className="text-[10.5px] text-faint">
                        {detail.data.accident.categoryCode.replace(/_/g, " ")} · severity {detail.data.accident.severityCode}
                      </div>
                    </div>
                    <SeverityDot severity={detail.data.accident.severityCode} />
                  </div>
                  <p className="border-l-2 border-line pl-2 text-[11px] leading-relaxed text-muted">{detail.data.accident.description}</p>
                  <MetricGrid
                    metrics={[
                      { label: "Occurred (UTC)", value: detail.data.accident.occurredAt.slice(0, 16).replace("T", " ") },
                      { label: "Reported", value: detail.data.accident.reportedAt.slice(0, 16).replace("T", " ") },
                      { label: "District", value: detail.data.accident.district ?? "—" },
                      { label: "Segment", value: detail.data.accident.roadSegmentId ?? "unmatched" },
                      { label: "Casualties", value: detail.data.accident.casualties },
                      { label: "Positional ±", value: `${detail.data.accident.positionalUncertaintyM.toFixed(0)} m` },
                      { label: "Weather", value: detail.data.accident.weather ?? "unknown" },
                      { label: "Lighting", value: detail.data.accident.lighting ?? "unknown" },
                    ]}
                  />
                  <div className="text-[10px] text-faint">
                    Located via {detail.data.accident.locationMethod.replace(/_/g, " ")} · dataset {detail.data.accident.datasetName ?? "—"}
                  </div>
                  {detail.data.accident.attachments.length > 0 && (
                    <div>
                      <SectionLabel>Attached evidence</SectionLabel>
                      <div className="grid grid-cols-2 gap-1.5">
                        {detail.data.accident.attachments.map((attachment) => (
                          <a key={attachment.id} href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer" className="overflow-hidden rounded border border-line">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/attachments/${attachment.id}`} alt={attachment.filename} className="h-20 w-full object-cover" />
                            <div className="truncate bg-panel2 px-1 py-0.5 text-[9px] text-faint">{attachment.filename}</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {detail.data.accident.qualityFlags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {detail.data.accident.qualityFlags.map((flag) => (
                        <span key={flag} className="badge badge-warn">
                          {flag.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                  {detail.data.neighbours.length > 0 && (
                    <div>
                      <SectionLabel>Nearby records</SectionLabel>
                      {detail.data.neighbours.map((neighbour) => (
                        <div key={neighbour.publicId} className="flex justify-between text-[10.5px] text-muted">
                          <span className="mono">{neighbour.publicId}</span>
                          <span className="mono text-faint">{formatDistance(neighbour.distanceM)} · {neighbour.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <Link href={`/track?publicId=${detail.data.accident.publicId}`} className="btn btn-xs flex-1">
                      Status timeline
                    </Link>
                    <a
                      className="btn btn-xs"
                      href={`https://www.openstreetmap.org/?mlat=${detail.data.accident.lat}&mlon=${detail.data.accident.lng}#map=17/${detail.data.accident.lat}/${detail.data.accident.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      External map
                    </a>
                  </div>
                  <Callout tone="warn" title="Unverified ≠ confirmed">
                    A pending crowdsourced report is a claim, not a confirmed collision record. Treat coordinates within ±
                    {detail.data.accident.positionalUncertaintyM.toFixed(0)} m.
                  </Callout>
                </div>
              )}
            </Panel>
            {selectedSegment && (
              <Panel title="Road segment" icon={<Layers size={12} />}>
                <div className="space-y-2">
                  <div className="text-[12px] font-medium text-ink">{String(selectedSegment.name ?? selectedSegment.segmentId)}</div>
                  <MetricGrid
                    metrics={[
                      { label: "Segment", value: String(selectedSegment.segmentId ?? "—") },
                      { label: "Class", value: String(selectedSegment.roadClass ?? "—") },
                      { label: "Events", value: String(selectedSegment.count ?? "—") },
                      { label: "KSI", value: String(selectedSegment.ksi ?? "—") },
                      { label: "Per km", value: String(selectedSegment.densityPerKm ?? "—") },
                      { label: "AADT", value: selectedSegment.aadt ? formatNumber(Number(selectedSegment.aadt)) : "n/a" },
                      { label: "Risk index", value: selectedSegment.riskIndex ? Number(selectedSegment.riskIndex).toFixed(1) : "—" },
                      { label: "Rank", value: String(selectedSegment.rank ?? "—") },
                    ]}
                  />
                  <Link href={`/lab`} className="btn btn-xs w-full">
                    Run segment statistics in the lab
                  </Link>
                </div>
              </Panel>
            )}
          </>
        )}

        {tab === "quality" && metricSummary && (
          <>
            <Panel title="Data quality indicators" icon={<CheckCircle2 size={12} />}>
              <div className="space-y-2">
                {[
                  { label: "Verified share", value: metricSummary.completeness.verified },
                  { label: "Environmental context", value: metricSummary.completeness.weather },
                  { label: "Matched to road segment", value: metricSummary.completeness.segment },
                  { label: "Descriptions present", value: metricSummary.completeness.description },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-0.5 flex justify-between text-[10.5px]">
                      <span className="text-muted">{item.label}</span>
                      <span className="mono text-ink">{formatPct(item.value)}</span>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${item.value * 100}%` }} />
                    </div>
                  </div>
                ))}
                <Divider label="uncertainty" />
                <MetricGrid
                  metrics={[
                    { label: "Median positional", value: `${metricSummary.uncertainty.medianM.toFixed(1)} m` },
                    { label: "P90 positional", value: `${metricSummary.uncertainty.p90M.toFixed(1)} m` },
                    { label: "> 30 m share", value: formatPct(metricSummary.uncertainty.shareOver30m) },
                    { label: "Median report delay", value: `${metricSummary.delay.medianH.toFixed(1)} h` },
                    { label: "Delay ≤ 24 h", value: formatPct(metricSummary.delay.within24h) },
                    { label: "Spatial Gini", value: metricSummary.concentration.gini.toFixed(3) },
                  ]}
                />
                <Callout tone="info" title="Interpretation">
                  Spatial inequality (Gini) and top-segment shares are descriptive. Reporting coverage is uneven, so absence of reports is not
                  absence of collisions.
                </Callout>
              </div>
            </Panel>
            <Panel title="Synthetic data provenance" icon={<Info size={12} />}>
              <div className="space-y-1.5 text-[10.5px] leading-relaxed text-muted">
                <div className="flex justify-between"><span>Generator</span><span className="mono text-ink">v1.0 · seed 20260117</span></div>
                <div className="flex justify-between"><span>Scenario</span><span className="mono text-ink">mixed urban</span></div>
                <div className="flex justify-between"><span>Datasets</span><span className="mono text-ink">{initialMeta.datasets.length}</span></div>
                <div className="flex justify-between"><span>Segments</span><span className="mono text-ink">{formatNumber(initialMeta.segments)}</span></div>
                <div className="flex justify-between"><span>Intersections</span><span className="mono text-ink">{formatNumber(initialMeta.intersections)}</span></div>
                <p className="pt-1 text-[10px] text-faint">
                  The study area, road network, incidents, weather and traffic observations are entirely synthetic and must be cited as such. See{" "}
                  <Link className="link" href="/about">
                    methods
                  </Link>
                  .
                </p>
              </div>
            </Panel>
          </>
        )}
      </aside>
    </div>
  );
}

function riskMetrics(risk: RiskResponse): { label: string; value: string; detail?: string }[] {
  return [
    { label: "Segments scored", value: formatNumber(risk.summary.analysedSegments) },
    { label: "Events analysed", value: formatNumber(risk.summary.eventsAnalysed) },
    { label: "High-risk segments", value: formatNumber(risk.summary.highRiskSegments), detail: "top decile" },
    { label: "Exposure coverage", value: formatPct(risk.summary.exposureCoverage, 0) },
    { label: "Median index", value: risk.summary.medianRiskIndex.toFixed(1) },
    { label: "P90 index", value: risk.summary.p90RiskIndex.toFixed(1) },
  ];
}
