"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Crosshair, Flame, Grid3x3, Layers, MapPin, Network, Route, ShieldAlert, Target, Eye, EyeOff, Play } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { FilterBar } from "@/components/FilterBar";
import { MapLegend } from "@/components/MapLegend";
import EChart, { CHART_AXIS, CHART_TOOLTIP } from "@/components/EChart";
import type { CursorInfo, MapSelection } from "@/components/MapView";
import { Alert, Badge, Button, EmptyState, KeyValue, Panel, ProgressBar, Segmented, Spinner, StatusBadge, cx, inputCls, labelCls } from "@/components/ui";
import { useAnalysis, useApi, useDebounced } from "@/components/hooks";
import { BASEMAPS, decorateAnalysis, GI_LABELS, legendFor, type BasemapId } from "@/components/map-style";
import { ANALYSIS_DEFS, defaultParamValues, type ParamDef } from "@/lib/catalog";
import { apiGet, withQuery } from "@/lib/client-api";
import { ANALYSIS_TYPES, CATEGORY_META, SEVERITY_META, STUDY_AREA, type AnalysisType, type BBox, type GeoFeature, type GeoFeatureCollection, type GeoGeometry } from "@/lib/domain";
import { filtersToParams, type FilterSpec } from "@/lib/filters";
import { lonLatToUtm } from "@/lib/geo";
import { formatInt, formatPct } from "@/lib/format";
import type { AccidentDetail, AccidentListItem, DashboardStats, Paginated, SegmentDetail } from "@/lib/api-types";
import { addDaysIso } from "@/lib/time";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Loading map engine…</div>,
});

type Mode = "points" | "clusters" | "heatmap" | AnalysisType;
type Tab = "selection" | "summary" | "method";

const MODES: { id: Mode; label: string; icon: typeof MapPin; short: string }[] = [
  { id: "points", label: "Points", icon: MapPin, short: "Individual verified incidents" },
  { id: "clusters", label: "Clusters", icon: Layers, short: "Aggregated at small scales" },
  { id: "heatmap", label: "Heatmap", icon: Flame, short: "Severity-weighted intensity" },
  { id: "kde", label: "KDE", icon: Grid3x3, short: "Kernel density surface" },
  { id: "gistar", label: "Gi* hotspots", icon: Target, short: "Significant hot/cold cells" },
  { id: "dbscan", label: "DBSCAN", icon: Network, short: "Density-based clusters" },
  { id: "segment_aggregation", label: "Road segments", icon: Route, short: "Incidents per road segment" },
  { id: "risk", label: "Risk index", icon: ShieldAlert, short: "Relative risk ranking" },
];

const isAnalysis = (m: Mode): m is AnalysisType => (ANALYSIS_TYPES as readonly string[]).includes(m);

function geometryBBox(g: GeoGeometry | null | undefined): BBox | null {
  if (!g) return null;
  const pts: [number, number][] = g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates.flat();
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}` };
}

const HIDDEN_PROPS = new Set(["color", "opacity", "width", "memberIds", "value"]);

export default function ExplorerPage() {
  const { filters, setFilters, isAdmin, meta } = useApp();
  const [mode, setMode] = useState<Mode>("points");
  const [params, setParams] = useState<Record<string, number | string>>({});
  const [basemap, setBasemap] = useState<BasemapId>("dark");
  const [showAccidents, setShowAccidents] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [opacity, setOpacity] = useState(0.8);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [tab, setTab] = useState<Tab>("selection");
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const [highlight, setHighlight] = useState<AccidentListItem[] | null>(null);
  const [fit, setFit] = useState<{ bbox: BBox; nonce: number } | null>(null);
  const [focus, setFocus] = useState<{ lon: number; lat: number; zoom: number; nonce: number } | null>(null);
  const [incidentsBusy, setIncidentsBusy] = useState(false);
  const analysis = useAnalysis();

  const qs = useMemo(() => filtersToParams(filters).toString(), [filters]);
  const debouncedQs = useDebounced(qs, 250);
  const points = useApi<GeoFeatureCollection>(withQuery("/accidents/geojson", debouncedQs));
  const roads = useApi<GeoFeatureCollection>(withQuery("/segments", debouncedQs));
  const timeline = useApi<DashboardStats>(withQuery("/dashboard", debouncedQs));
  const bboxKey = bbox ? bbox.map((v) => v.toFixed(5)).join(",") : "";
  const debouncedBbox = useDebounced(bboxKey, 400);
  const summaryQs = new URLSearchParams(debouncedQs);
  if (debouncedBbox) summaryQs.set("bbox", debouncedBbox);
  const summary = useApi<DashboardStats>(withQuery("/dashboard", summaryQs));

  const analysisMode = isAnalysis(mode) ? mode : null;
  const runKey = analysisMode ? JSON.stringify({ mode: analysisMode, params, filters }) : null;
  const debouncedRunKey = useDebounced(runKey, 450);
  const runAnalysis = analysis.run;
  useEffect(() => {
    if (!debouncedRunKey) return;
    const k = JSON.parse(debouncedRunKey) as { mode: AnalysisType; params: Record<string, number | string>; filters: FilterSpec };
    void runAnalysis(k.mode, k.params, k.filters);
  }, [debouncedRunKey, runAnalysis]);

  const result = analysisMode && analysis.job?.analysisType === analysisMode ? analysis.job.result : null;
  const analysisFc = useMemo(() => (result && analysisMode ? decorateAnalysis(analysisMode, result.featureCollection) : null), [result, analysisMode]);
  const highlightFc = useMemo<GeoFeatureCollection | null>(
    () =>
      highlight
        ? {
            type: "FeatureCollection",
            features: highlight.map((r) => ({
              type: "Feature",
              geometry: { type: "Point", coordinates: [r.lon, r.lat] },
              properties: { id: r.id, severityId: r.severityId, status: r.status, severityWeight: r.severityWeight },
            })),
          }
        : null,
    [highlight],
  );

  const accidentDetail = useApi<AccidentDetail>(selection?.kind === "accident" && selection.id ? `/accidents/${selection.id}` : null);
  const segmentDetail = useApi<SegmentDetail>(selection?.kind === "segment" && selection.id ? withQuery(`/segments/${selection.id}`, debouncedQs) : null);

  const selectedFeature = useMemo<GeoFeature | null>(() => {
    if (!selection) return null;
    if (selection.kind === "segment") {
      const f = roads.data?.features.find((ft) => ft.properties.segmentId === selection.id);
      return f ?? null;
    }
    if (selection.kind === "analysis" && selection.geometry) return { type: "Feature", geometry: selection.geometry, properties: selection.properties };
    return null;
  }, [selection, roads.data]);

  const chooseMode = (m: Mode) => {
    setMode(m);
    setParams(isAnalysis(m) ? defaultParamValues(m) : {});
    analysis.reset();
    setSelection(null);
    setHighlight(null);
  };

  const handleSelect = useCallback((sel: MapSelection | null) => {
    setSelection(sel);
    setHighlight(null);
    if (sel) setTab("selection");
  }, []);

  const showIncidents = async () => {
    const b = geometryBBox(selection?.geometry);
    if (!b) return;
    setIncidentsBusy(true);
    try {
      const p = filtersToParams(filters, b);
      p.set("pageSize", "100");
      const res = await apiGet<Paginated<AccidentListItem>>(withQuery("/accidents", p));
      setHighlight(res.items);
      setFit({ bbox: b, nonce: Date.now() });
    } finally {
      setIncidentsBusy(false);
    }
  };

  const pointsMode = mode === "clusters" || mode === "heatmap" || mode === "points" ? (showAccidents ? mode : "hidden") : showAccidents ? "points" : "hidden";
  const legend = legendFor(analysisMode ?? (mode as "points" | "clusters" | "heatmap"), result?.summary as Record<string, unknown> | undefined);
  const monthly = timeline.data?.monthly ?? [];
  const timelineOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 4, top: 6, bottom: 16, containLabel: true },
      tooltip: { trigger: "axis", ...CHART_TOOLTIP },
      xAxis: { type: "category", data: monthly.map((m) => m.key), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 9, interval: 5 } },
      yAxis: { type: "value", ...CHART_AXIS, splitNumber: 2 },
      series: [{ type: "bar", data: monthly.map((m) => m.count), barMaxWidth: 9, itemStyle: { color: "#2dd4bf", opacity: 0.85 } }],
    }),
    [monthly],
  );
  const summaryData = summary.data;
  const severityOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 4, right: 12, top: 4, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...CHART_TOOLTIP },
      xAxis: { type: "value", ...CHART_AXIS, splitNumber: 2 },
      yAxis: { type: "category", data: (summaryData?.severity ?? []).map((s) => s.label), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 10 } },
      series: [
        {
          type: "bar",
          barMaxWidth: 14,
          data: (summaryData?.severity ?? []).map((s) => ({ value: s.count, itemStyle: { color: s.colorHex } })),
        },
      ],
    }),
    [summaryData],
  );

  const roadsForMap = showRoads ? roads.data : null;
  const selectedProps = selection?.kind === "analysis" ? Object.entries(selection.properties).filter(([k, v]) => !HIDDEN_PROPS.has(k) && v !== null && typeof v !== "object") : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Left: mode, parameters, layers, filters */}
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-line bg-panel p-3 lg:w-[300px] lg:border-r">
        <div>
          <div className={labelCls}>Analytical mode</div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => chooseMode(m.id)}
                  aria-pressed={active}
                  title={m.short}
                  className={cx(
                    "flex h-8 items-center gap-1.5 rounded-md border px-2 text-left text-[12px] transition-colors",
                    active ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:border-faint hover:text-fg",
                  )}
                >
                  <Icon size={13} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{m.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">{MODES.find((m) => m.id === mode)?.short}</p>
        </div>

        {analysisMode ? (
          <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className={labelCls}>Parameters</span>
              <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={() => void runAnalysis(analysisMode, params, filters)} busy={analysis.status === "queued" || analysis.status === "running"}>
                Run
              </Button>
            </div>
            {ANALYSIS_DEFS[analysisMode].params.map((p) => (
              <ParamControl key={p.key} def={p} value={params[p.key] ?? p.default} onChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))} />
            ))}
            {analysis.status !== "idle" ? (
              <div className="flex flex-col gap-1.5 pt-1">
                {analysis.status === "queued" || analysis.status === "running" ? (
                  <>
                    <Spinner label={analysis.job?.progressMessage ?? "Queued"} />
                    <ProgressBar value={analysis.job?.progress ?? 0} />
                  </>
                ) : analysis.status === "failed" ? (
                  <Alert tone="error" title="Analysis could not be completed">
                    {analysis.error}
                  </Alert>
                ) : (
                  <span className="text-[11px] text-muted">
                    {analysis.job?.cached ? "Cached result · " : ""}
                    {analysis.job?.progressMessage}
                  </span>
                )}
              </div>
            ) : null}
            {result ? <ResultSummary summary={result.summary} notes={result.notes} table={result.table} kind={analysisMode} /> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className={labelCls}>Layers</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => setShowAccidents((v) => !v)} aria-pressed={showAccidents} className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-muted hover:text-fg aria-pressed:text-fg">
              {showAccidents ? <Eye size={12} /> : <EyeOff size={12} />} Incidents
            </button>
            <button type="button" onClick={() => setShowRoads((v) => !v)} aria-pressed={showRoads} className="flex h-7 items-center gap-1.5 rounded border border-line px-2 text-[12px] text-muted hover:text-fg aria-pressed:text-fg">
              {showRoads ? <Eye size={12} /> : <EyeOff size={12} />} Road network
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="flex justify-between text-[11px] text-muted">
              Analysis opacity <span className="font-mono">{Math.round(opacity * 100)}%</span>
            </span>
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="accent-[var(--c-accent)]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">Basemap</span>
            <select className={inputCls} value={basemap} onChange={(e) => setBasemap(e.target.value as BasemapId)}>
              {BASEMAPS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-2">
          <span className={labelCls}>Monthly incidents in scope</span>
          <div className="rounded-md border border-line bg-canvas/40 p-1.5">
            {timeline.loading && !timeline.data ? <Spinner /> : <EChart option={timelineOption} height={96} onClick={(p) => {
              if (p.name) setFilters(monthBounds(p.name));
            }} />}
          </div>
          <p className="text-[10.5px] text-faint">Click a month to restrict the period to it.</p>
        </div>

        <div className="border-t border-line pt-3">
          <FilterBar variant="compact" />
        </div>
      </aside>

      {/* Centre: map */}
      <section className="relative min-h-[420px] flex-1 lg:min-h-0">
        <MapView
          basemap={basemap}
          points={points.data}
          pointsMode={pointsMode}
          roads={roadsForMap}
          roadsMode={showRoads ? "base" : "hidden"}
          analysis={analysisFc}
          analysisKind={analysisMode && result ? analysisMode : null}
          analysisOpacity={opacity}
          highlight={highlightFc}
          selectedFeature={selectedFeature}
          fitBbox={fit?.bbox ?? null}
          fitNonce={fit?.nonce ?? 0}
          focus={focus}
          onSelect={handleSelect}
          onViewChange={setBbox}
          onCursor={setCursor}
          className="h-full"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-6rem)] flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-panel/90 px-2 py-1 text-[12px] font-medium shadow backdrop-blur">
            {MODES.find((m) => m.id === mode)?.label}
          </span>
          <span className="rounded-md border border-warn/50 bg-panel/90 px-2 py-1 text-[10.5px] font-semibold tracking-[0.1em] text-warn shadow backdrop-blur">
            SYNTHETIC · {STUDY_AREA.name}
          </span>
          {points.loading ? <span className="rounded-md bg-panel/90 px-2 py-1 text-[11px] text-muted shadow"><Spinner label="Updating incidents" /></span> : null}
          {points.data ? (
            <span className="rounded-md bg-panel/90 px-2 py-1 font-mono text-[11px] text-muted shadow">
              {formatInt(points.data.features.length)} incidents{points.data.features.length >= 20000 ? " (truncated)" : ""}
            </span>
          ) : null}
        </div>
        <div className="absolute bottom-3 left-3 max-h-[calc(100%-1.5rem)] overflow-auto">
          <MapLegend spec={legend} />
        </div>
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-line bg-panel/90 px-2 py-1 font-mono text-[10.5px] leading-tight text-muted shadow backdrop-blur">
          {cursor ? (
            <>
              <div>
                λ {cursor.lon.toFixed(5)}° &nbsp; φ {cursor.lat.toFixed(5)}°
              </div>
              <div>
                E {formatInt(cursor.x)} &nbsp; N {formatInt(cursor.y)} <span className="text-faint">EPSG:32633</span>
              </div>
              <div className="text-faint">zoom {cursor.zoom.toFixed(2)}</div>
            </>
          ) : (
            <div>Move the pointer over the map for coordinates</div>
          )}
        </div>
      </section>

      {/* Right: inspector */}
      <aside className="scroll-thin flex w-full shrink-0 flex-col overflow-y-auto border-line bg-panel lg:w-[340px] lg:border-l">
        <div className="sticky top-0 z-10 border-b border-line bg-panel p-2.5">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "selection", label: "Selection" },
              { value: "summary", label: "Area summary" },
              { value: "method", label: "Method" },
            ]}
          />
        </div>

        {tab === "selection" ? (
          <div className="flex flex-col gap-3 p-3">
            {!selection ? (
              <EmptyState icon={<Crosshair size={20} />} title="Nothing selected">
                Click an incident, road segment, or analytical feature to inspect it. Selections update the map outline and the statistics shown here.
              </EmptyState>
            ) : null}

            {selection?.kind === "accident" ? (
              accidentDetail.loading ? (
                <Spinner />
              ) : accidentDetail.error ? (
                <Alert tone="warn" title="Incident not available">
                  {accidentDetail.error}
                </Alert>
              ) : accidentDetail.data ? (
                <AccidentCard detail={accidentDetail.data} isAdmin={isAdmin} timeZone={meta?.study.timeZone ?? STUDY_AREA.timeZone} />
              ) : null
            ) : null}

            {selection?.kind === "segment" ? (
              segmentDetail.loading && !segmentDetail.data ? (
                <Spinner />
              ) : segmentDetail.data ? (
                <SegmentCard detail={segmentDetail.data} onOpen={(id) => setSelection({ kind: "accident", id, lon: 0, lat: 0, properties: {}, geometry: null })} />
              ) : segmentDetail.error ? (
                <Alert tone="warn">{segmentDetail.error}</Alert>
              ) : null
            ) : null}

            {selection?.kind === "analysis" ? (
              <div className="flex flex-col gap-3">
                <Panel title={analysisMode ? ANALYSIS_DEFS[analysisMode].short + " feature" : "Feature"} subtitle="Properties of the selected analytical feature">
                  {selectedProps.length ? (
                    <KeyValue
                      rows={selectedProps.map(([k, v]) => [
                        k === "class" ? "class" : k,
                        k === "class" ? (GI_LABELS[String(v)] ?? String(v)) : typeof v === "number" ? formatInt(v) === String(v) ? String(v) : String(v) : String(v),
                      ])}
                    />
                  ) : (
                    <p className="text-[12px] text-muted">No additional properties.</p>
                  )}
                </Panel>
                {geometryBBox(selection.geometry) ? (
                  <Button variant="secondary" onClick={() => void showIncidents()} busy={incidentsBusy} icon={<Crosshair size={13} />}>
                    Show underlying incidents
                  </Button>
                ) : null}
                {highlight ? (
                  <Panel title={`${highlight.length} incident${highlight.length === 1 ? "" : "s"} in selection`} subtitle="Highlighted on the map; click a row to inspect it" actions={<Button size="sm" variant="ghost" onClick={() => setHighlight(null)}>Clear</Button>}>
                    <ul className="scroll-thin flex max-h-72 flex-col gap-1 overflow-y-auto">
                      {highlight.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelection({ kind: "accident", id: r.id, lon: r.lon, lat: r.lat, properties: {}, geometry: null });
                              setFocus({ lon: r.lon, lat: r.lat, zoom: 15.5, nonce: Date.now() });
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-panel-2"
                          >
                            <span className="truncate">{r.categoryLabel}</span>
                            <span className="shrink-0 font-mono text-[11px] text-muted">{r.occurredAt.slice(0, 16).replace("T", " ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "summary" ? (
          <div className="flex flex-col gap-3 p-3">
            <Panel title="Current map view" subtitle={bbox ? "Statistics for incidents inside the visible extent" : "Waiting for map extent"}>
              {summary.loading && !summaryData ? <Spinner /> : null}
              {summaryData ? (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Mini label="Incidents" value={formatInt(summaryData.scope.records)} />
                    <Mini label="Synthetic share" value={formatPct(summaryData.scope.syntheticShare, 0)} />
                    <Mini label="Median delay" value={summaryData.reportingDelay.medianMin === null ? "—" : `${summaryData.reportingDelay.medianMin} min`} />
                    <Mini label="Top-decile cells" value={formatPct(summaryData.concentration.top10PctShare, 0)} />
                  </div>
                  <div>
                    <div className={cx(labelCls, "mb-1")}>Severity</div>
                    <EChart option={severityOption} height={120} />
                  </div>
                  <div>
                    <div className={cx(labelCls, "mb-1")}>Top categories</div>
                    <ul className="flex flex-col gap-1.5 text-[12px]">
                      {[...summaryData.categories].sort((a, b) => b.count - a.count).map((c) => (
                        <li key={c.code} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORY_META[c.code].colorHex }} />
                            <span className="truncate">{c.label}</span>
                          </span>
                          <span className="font-mono tabular-nums text-muted">{formatInt(c.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className={cx(labelCls, "mb-1")}>Most affected segments in view</div>
                    <ol className="flex flex-col gap-1 text-[12px]">
                      {summaryData.topSegments.slice(0, 6).map((s, i) => (
                        <li key={s.segmentId} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate"><span className="mr-1.5 font-mono text-faint">{i + 1}.</span>{s.name}</span>
                          <span className="shrink-0 font-mono tabular-nums text-muted">{s.count}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : null}
            </Panel>
            <p className="text-[11px] leading-relaxed text-faint">
              Summaries describe recorded incidents within the current filters and map extent. They are descriptive counts and do not indicate risk without exposure data.
            </p>
          </div>
        ) : null}

        {tab === "method" ? (
          <div className="flex flex-col gap-3 p-3">
            {analysisMode ? (
              <>
                <Panel title={ANALYSIS_DEFS[analysisMode].label}>
                  <p className="text-[12.5px] leading-relaxed">{ANALYSIS_DEFS[analysisMode].represents}</p>
                  <div className={cx(labelCls, "mt-3")}>Method</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">{ANALYSIS_DEFS[analysisMode].method}</p>
                  <div className={cx(labelCls, "mt-3")}>Limitations</div>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-muted">
                    {ANALYSIS_DEFS[analysisMode].limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </Panel>
                {result ? (
                  <Panel title="Assumption checks">
                    {result.methodology.assumptions.length === 0 ? (
                      <p className="text-[12px] text-muted">No formal assumptions are required for this method.</p>
                    ) : (
                      <ul className="flex flex-col gap-2 text-[12px]">
                        {result.methodology.assumptions.map((a) => (
                          <li key={a.id} className="flex gap-2">
                            <Badge tone={a.passed ? "ok" : "danger"}>{a.passed ? "passed" : "not met"}</Badge>
                            <span>
                              <span className="font-medium">{a.label}</span>
                              <span className="block text-[11px] text-muted">{a.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                ) : null}
              </>
            ) : (
              <Panel title={MODES.find((m) => m.id === mode)?.label ?? "Layer"}>
                <p className="text-[12.5px] leading-relaxed">
                  {mode === "points" && "Each marker is one recorded incident, coloured by severity. Hollow markers are pending citizen reports (administrators only)."}
                  {mode === "clusters" && "Incidents are grouped at small scales into clusters whose size shows the number of incidents. Zoom in to separate them. Clusters describe counts, not risk."}
                  {mode === "heatmap" && "A kernel-rendered surface of severity-weighted incident density. It is a visual summary of concentration; the colour scale is relative to the current view."}
                </p>
              </Panel>
            )}
            <Panel title="Data provenance">
              <p className="text-[12px] leading-relaxed text-muted">{meta?.study.disclaimer}</p>
              <p className="mt-2 text-[12px] text-muted">Timestamps are stored in UTC; calendar filters use {STUDY_AREA.timeZone}. Coordinates are WGS 84 with EPSG:32633 for metric analysis.</p>
            </Panel>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-canvas/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="font-mono text-[15px] tabular-nums">{value}</div>
    </div>
  );
}

function ParamControl({ def, value, onChange }: { def: ParamDef; value: number | string; onChange: (v: number | string) => void }) {
  if (def.kind === "select") {
    return (
      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[11.5px] text-muted">{def.label}</span>
        <select className={inputCls} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const num = Number(value);
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[11.5px] text-muted">
        {def.label}
        <span className="font-mono text-fg">
          {num}
          {def.unit ? ` ${def.unit}` : ""}
        </span>
      </span>
      <input type="range" min={def.min} max={def.max} step={def.step} value={num} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--c-accent)]" />
    </label>
  );
}

function ResultSummary({ summary, notes, table, kind }: { summary: Record<string, string | number | boolean | null>; notes: string[]; table: Record<string, string | number | boolean | null>[]; kind: AnalysisType }) {
  const rows = Object.entries(summary)
    .filter(([, v]) => v !== null)
    .slice(0, 9)
    .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").toLowerCase(), typeof v === "number" ? (Number.isInteger(v) ? formatInt(v) : String(v)) : String(v)] as [string, string]);
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-line pt-2">
      <span className={labelCls}>Result</span>
      {rows.length ? <KeyValue rows={rows} /> : null}
      {table.length && kind !== "dbscan" ? (
        <div className="scroll-thin max-h-44 overflow-auto rounded border border-line">
          <table className="w-full text-[11px]">
            <tbody>
              {table.slice(0, 8).map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {Object.entries(r)
                    .slice(0, 4)
                    .map(([k, v]) => (
                      <td key={k} className="truncate px-1.5 py-1 align-top">
                        <span className="block text-[9.5px] uppercase text-faint">{k}</span>
                        <span className="font-mono">{v === null ? "—" : String(v)}</span>
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {notes.slice(0, 2).map((n) => (
        <p key={n} className="text-[10.5px] leading-snug text-faint">
          {n}
        </p>
      ))}
    </div>
  );
}

function AccidentCard({ detail, isAdmin, timeZone }: { detail: AccidentDetail; isAdmin: boolean; timeZone: string }) {
  const fmt = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(new Date(iso));
  return (
    <div className="flex flex-col gap-3">
      <Panel
        title={detail.categoryLabel}
        subtitle={`${fmt(detail.occurredAt)} local · ${detail.datasetName}`}
        actions={<StatusBadge status={detail.status} />}
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Badge tone={detail.isSynthetic ? "synthetic" : "neutral"}>{detail.isSynthetic ? "Synthetic" : "Real / citizen"}</Badge>
          <Badge tone="neutral" className="!text-[10.5px]">
            <span className="size-1.5 rounded-full" style={{ background: SEVERITY_META[detail.severityId as 1 | 2 | 3 | 4]?.colorHex }} />
            {detail.severityLabel}
          </Badge>
          {detail.emergencyServices ? <Badge tone="accent">Emergency services</Badge> : null}
          {detail.qualityFlags.map((f) => (
            <Badge key={f} tone="warn">
              {f.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
        <KeyValue
          rows={[
            ["Vehicles / road users", String(detail.vehiclesInvolved)],
            ["Reported after", `${detail.reportingDelayMin} min`],
            ["Nearest segment", detail.nearestSegmentName ?? "—"],
            ["Snap distance", detail.snapDistanceM === null ? "—" : `${detail.snapDistanceM.toFixed(1)} m`],
            ["Location source", detail.locationSource],
            ["Longitude / latitude", `${detail.lon.toFixed(5)}, ${detail.lat.toFixed(5)}`],
          ]}
        />
        {detail.description ? <p className="mt-3 text-[12px] leading-relaxed text-muted">{detail.description}</p> : null}
        {!detail.description && !isAdmin ? <p className="mt-3 text-[11px] text-faint">Narrative text is shown to administrators only, to protect the privacy of those involved.</p> : null}
      </Panel>
      {detail.duplicateCandidate ? (
        <Alert tone="warn" title="Linked to a possible duplicate">
          Record #{detail.duplicateCandidate.id} ({detail.duplicateCandidate.categoryLabel}, {fmt(detail.duplicateCandidate.occurredAt)}).
        </Alert>
      ) : null}
      {detail.attachments.length ? <p className="text-[11.5px] text-muted">{detail.attachments.length} photograph(s) attached.</p> : null}
      <p className="text-[10.5px] text-faint">Analysis coordinates: {lonLatToUtm(detail.lon, detail.lat).map((v) => Math.round(v)).join(", ")} (EPSG:32633)</p>
    </div>
  );
}

function SegmentCard({ detail, onOpen }: { detail: SegmentDetail; onOpen: (id: number) => void }) {
  const s = detail.segment;
  const hourOption: EChartsOption = {
    grid: { left: 2, right: 2, top: 4, bottom: 14, containLabel: true },
    tooltip: { trigger: "axis", ...CHART_TOOLTIP },
    xAxis: { type: "category", data: detail.stats.byHour.map((h) => String(h.hour)), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 9, interval: 3 } },
    yAxis: { type: "value", ...CHART_AXIS, splitNumber: 2 },
    series: [{ type: "bar", data: detail.stats.byHour.map((h) => h.count), barMaxWidth: 7, itemStyle: { color: "#2dd4bf" } }],
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel title={s.name} subtitle={`${s.roadClass} · ${s.speedLimitKmh} km/h · ${s.lanes} lane(s)`}>
        <div className="grid grid-cols-2 gap-2">
          <Mini label="Incidents" value={formatInt(detail.stats.count)} />
          <Mini label="Per km" value={detail.stats.perKm.toFixed(1)} />
          <Mini label="Severity / km" value={detail.stats.severityPerKm.toFixed(1)} />
          <Mini label="Mean severity" value={detail.stats.meanSeverity === null ? "—" : detail.stats.meanSeverity.toFixed(2)} />
        </div>
        <KeyValue
          rows={[
            ["Length", `${s.lengthM} m`],
            ["Lighting score", s.lightingScore.toFixed(2)],
            ["Traffic (AADT)", s.aadt === null ? "not observed" : formatInt(s.aadt)],
          ]}
        />
      </Panel>
      <Panel title="Temporal profile" subtitle="Incidents by local hour">
        <EChart option={hourOption} height={110} />
      </Panel>
      <Panel title="By category">
        <ul className="flex flex-col gap-1.5 text-[12px]">
          {detail.stats.byCategory.map((c) => (
            <li key={c.code} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: CATEGORY_META[c.code].colorHex }} />
                {c.label}
              </span>
              <span className="font-mono tabular-nums text-muted">{c.count}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Recent incidents" subtitle="Click to inspect">
        {detail.recent.length === 0 ? (
          <p className="text-[12px] text-muted">No incidents on this segment for the current filters.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[12px] hover:bg-panel-2">
                  <span className="truncate">{r.categoryLabel}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{r.occurredAt.slice(0, 10)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
