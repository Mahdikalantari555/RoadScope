"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Activity, Download, FlaskConical, Grid3x3, Network, Route, Sigma, Table2, Target, Waypoints, Clock, Play } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { FilterBar } from "@/components/FilterBar";
import { MapLegend } from "@/components/MapLegend";
import EChart, { CHART_AXIS, CHART_TOOLTIP } from "@/components/EChart";
import { Alert, Badge, Button, EmptyState, KeyValue, Panel, PageHeader, ProgressBar, Segmented, Spinner, cx, inputCls, labelCls } from "@/components/ui";
import { useAnalysis, useApi, useDebounced } from "@/components/hooks";
import { decorateAnalysis, legendFor } from "@/components/map-style";
import { ANALYSIS_DEFS, defaultParamValues, type ParamDef } from "@/lib/catalog";
import { apiGet, withQuery } from "@/lib/client-api";
import { ANALYSIS_TYPES, type AnalysisType, type GeoFeatureCollection } from "@/lib/domain";
import { filtersToParams, type FilterSpec } from "@/lib/filters";
import { formatInt } from "@/lib/format";
import type { DashboardStats, DatasetInfo, JobView, AnalysisResultView } from "@/lib/api-types";
import { DOW_LABELS, MONTH_LABELS } from "@/lib/domain";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Loading map…</div>,
});

type Method = AnalysisType | "temporal";

const METHODS: { id: Method; label: string; icon: typeof Grid3x3; hint: string }[] = [
  { id: "kde", label: "Kernel density", icon: Grid3x3, hint: "Smoothed intensity surface" },
  { id: "gistar", label: "Getis-Ord Gi*", icon: Target, hint: "Significant hot & cold cells" },
  { id: "dbscan", label: "DBSCAN", icon: Network, hint: "Density-connected clusters" },
  { id: "segment_aggregation", label: "Segment aggregation", icon: Route, hint: "Snapped counts, rates, Moran's I" },
  { id: "spatial_comparison", label: "Environmental comparison", icon: Waypoints, hint: "Covariates & wet-hour rate ratio" },
  { id: "temporal", label: "Temporal aggregation", icon: Clock, hint: "Hour, weekday and month profiles" },
];

const isAnalysisMethod = (m: Method): m is AnalysisType => (ANALYSIS_TYPES as readonly string[]).includes(m);

function ParamControl({ def, value, onChange }: { def: ParamDef; value: number | string; onChange: (v: number | string) => void }) {
  if (def.kind === "select") {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-[11.5px] text-muted">{def.label}</span>
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
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center justify-between text-[11.5px] text-muted">
        {def.label}
        <span className="font-mono text-fg">
          {Number(value)}
          {def.unit ? ` ${def.unit}` : ""}
        </span>
      </span>
      <input type="range" min={def.min} max={def.max} step={def.step} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--c-accent)]" />
    </label>
  );
}

export default function LabPage() {
  const { filters, setFilters } = useApp();
  const [method, setMethod] = useState<Method>("kde");
  const [params, setParams] = useState<Record<string, number | string>>(() => defaultParamValues("kde"));
  const [selectedDs, setSelectedDs] = useState<number[] | null>(null);
  const [tab, setTab] = useState<"results" | "method" | "data">("results");
  const analysis = useAnalysis();
  const datasets = useApi<{ items: DatasetInfo[] }>("/datasets");
  const history = useApi<{ items: JobView[] }>("/analysis/jobs?limit=10");
  const qs = useMemo(() => filtersToParams(filters).toString(), [filters]);
  const temporal = useApi<DashboardStats>(method === "temporal" ? withQuery("/dashboard", qs) : null);

  const analysisMethod = isAnalysisMethod(method) ? method : null;
  const runKey = analysisMethod ? JSON.stringify({ method: analysisMethod, params, filters }) : null;
  const debouncedKey = useDebounced(runKey, 450);
  const runAnalysis = analysis.run;
  useEffect(() => {
    if (!debouncedKey) return;
    const k = JSON.parse(debouncedKey) as { method: AnalysisType; params: Record<string, number | string>; filters: FilterSpec };
    void runAnalysis(k.method, k.params, k.filters);
  }, [debouncedKey, runAnalysis]);

  const jobDone = analysis.status === "completed" || analysis.status === "failed";
  useEffect(() => {
    if (jobDone) history.reload();
    // Only refresh history when a job reaches a terminal state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.job?.id, analysis.status]);

  const result: AnalysisResultView | null = analysisMethod && analysis.job?.analysisType === analysisMethod ? analysis.job.result : null;
  const fc = useMemo<GeoFeatureCollection | null>(() => (result && analysisMethod ? decorateAnalysis(analysisMethod, result.featureCollection) : null), [result, analysisMethod]);

  const chooseMethod = (m: Method) => {
    setMethod(m);
    setParams(isAnalysisMethod(m) ? defaultParamValues(m) : {});
    analysis.reset();
  };

  const toggleDataset = (id: number, active: DatasetInfo[]) => {
    const current = selectedDs ?? active.map((d) => d.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    const everyActive = active.every((d) => next.includes(d.id)) && next.length === active.length;
    setSelectedDs(everyActive ? null : next);
    setFilters({ datasetIds: everyActive || next.length === 0 ? null : next });
  };

  const monthlyOption = useMemo<EChartsOption>(() => {
    const m = temporal.data?.monthly ?? [];
    return {
      grid: { left: 4, right: 4, top: 8, bottom: 16, containLabel: true },
      tooltip: { trigger: "axis", ...CHART_TOOLTIP },
      xAxis: { type: "category", data: m.map((x) => x.key), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 9, interval: 2 } },
      yAxis: { type: "value", ...CHART_AXIS },
      series: [{ type: "bar", data: m.map((x) => x.count), barMaxWidth: 12, itemStyle: { color: "#2dd4bf", opacity: 0.85 } }],
    };
  }, [temporal.data]);

  const simpleBar = (labels: string[], values: number[], color: string): EChartsOption => ({
    grid: { left: 4, right: 4, top: 8, bottom: 16, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...CHART_TOOLTIP },
    xAxis: { type: "category", data: labels, ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 9, interval: 0 } },
    yAxis: { type: "value", ...CHART_AXIS },
    series: [{ type: "bar", data: values, barMaxWidth: 16, itemStyle: { color, borderRadius: [2, 2, 0, 0] } }],
  });
  const hourOption = useMemo(() => simpleBar((temporal.data?.hourly ?? []).map((h) => String(h.hour)), (temporal.data?.hourly ?? []).map((h) => h.count), "#2dd4bf"), [temporal.data]);
  const dowOption = useMemo(() => simpleBar(DOW_LABELS.map((x) => x), (temporal.data?.dayOfWeek ?? []).map((x) => x.count), "#60a5fa"), [temporal.data]);
  const moyOption = useMemo(() => simpleBar(MONTH_LABELS.map((x) => x), (temporal.data?.monthOfYear ?? []).map((x) => x.count), "#a78bfa"), [temporal.data]);

  const strataOption = useMemo<EChartsOption | null>(() => {
    if (!result || result.kind !== "spatial_comparison") return null;
    const rows = result.table.filter((r) => r.section === "Lighting strata");
    return simpleBar(rows.map((r) => String(r.label)), rows.map((r) => Number(r.value ?? 0)), "#fb923c");
  }, [result]);

  const activeDatasets = (datasets.data?.items ?? []).filter((d) => d.isActive);
  const legend = legendFor(analysisMethod ?? "points", result?.summary as Record<string, unknown> | undefined);
  const exportBase = analysis.job?.status === "completed" ? `/api/analysis/jobs/${analysis.job.id}/export` : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-line bg-panel p-3.5 xl:w-[330px] xl:border-r">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-accent/15 text-accent">
            <FlaskConical size={15} />
          </span>
          <div>
            <h1 className="text-[14px] font-semibold tracking-tight">Spatial analysis laboratory</h1>
            <p className="text-[11px] text-muted">Configure a method, choose inputs, and inspect the outputs.</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Method</span>
          <div className="grid gap-1">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const on = method === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => chooseMethod(m.id)}
                  className={cx("flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors", on ? "border-accent/60 bg-accent/10" : "border-line hover:border-faint")}
                >
                  <Icon size={14} className={on ? "text-accent" : "text-muted"} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-medium">{m.label}</span>
                    <span className="block text-[11px] text-muted">{m.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Input layers · datasets</span>
          {datasets.loading && !datasets.data ? <Spinner /> : null}
          <ul className="flex flex-col gap-1">
            {(datasets.data?.items ?? []).map((d) => {
              const on = d.isActive && (selectedDs === null || selectedDs.includes(d.id));
              return (
                <li key={d.id}>
                  <label className={cx("flex items-start gap-2 rounded-md border px-2 py-1.5 text-[12px]", d.isActive ? "border-line" : "border-line opacity-60")}>
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[var(--c-accent)]"
                      checked={on}
                      disabled={!d.isActive}
                      onChange={() => toggleDataset(d.id, activeDatasets)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-medium">{d.name}</span>
                        <Badge tone={d.kind === "real_import" ? "neutral" : "synthetic"}>{d.kind === "real_import" ? "Real" : d.kind === "citizen" ? "Citizen sim" : "Synthetic"}</Badge>
                      </span>
                      <span className="text-[10.5px] text-muted">
                        {d.isActive ? "Active" : "Inactive — enable on Datasets page"} · {formatInt(d.recordCount)} records
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-[10.5px] text-faint">Only verified records enter the analyses unless the review status is widened in the filters.</p>
        </div>

        {analysisMethod ? (
          <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/40 p-2.5">
            <div className="flex items-center justify-between">
              <span className={labelCls}>Parameters</span>
              <Button size="sm" variant="primary" icon={<Play size={12} />} busy={analysis.status === "queued" || analysis.status === "running"} onClick={() => void runAnalysis(analysisMethod, params, filters)}>
                Run
              </Button>
            </div>
            {ANALYSIS_DEFS[analysisMethod].params.length === 0 ? <p className="text-[11.5px] text-muted">No tunable parameters.</p> : null}
            {ANALYSIS_DEFS[analysisMethod].params.map((p) => (
              <ParamControl key={p.key} def={p} value={params[p.key] ?? p.default} onChange={(v) => setParams((prev) => ({ ...prev, [p.key]: v }))} />
            ))}
            <p className="text-[10.5px] text-faint">Parameter changes re-run the analysis automatically. Identical requests are served from the cache.</p>
          </div>
        ) : null}

        <div className="border-t border-line pt-3">
          <FilterBar variant="compact" />
        </div>
      </aside>

      <section className="relative min-h-[420px] flex-1 lg:min-h-[480px] xl:min-h-0">
        <MapView
          basemap="dark"
          points={null}
          pointsMode="hidden"
          roads={null}
          roadsMode="base"
          analysis={fc}
          analysisKind={analysisMethod && result ? analysisMethod : null}
          analysisOpacity={0.8}
          className="h-full"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-panel/90 px-2 py-1 text-[12px] font-medium shadow">
            {METHODS.find((m) => m.id === method)?.label}
          </span>
          {analysis.status === "queued" || analysis.status === "running" ? (
            <span className="rounded-md bg-panel/90 px-2 py-1 text-[11px] shadow">
              <Spinner label={analysis.job?.progressMessage ?? "Queued"} />
            </span>
          ) : null}
          {result ? (
            <span className="rounded-md bg-panel/90 px-2 py-1 font-mono text-[10.5px] text-muted shadow">{analysis.job?.cached ? "cached · " : ""}{analysis.job?.id.slice(0, 8)}</span>
          ) : null}
        </div>
        {analysisMethod && result ? (
          <div className="absolute bottom-3 left-3 max-h-[calc(100%-1.5rem)] overflow-auto">
            <MapLegend spec={legend} />
          </div>
        ) : null}
        {analysisMethod && !result && analysis.status === "idle" ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 px-6 text-center text-[12px] text-muted">
            Configure inputs on the left; the analysis runs automatically.
          </div>
        ) : null}
        {analysis.status === "failed" && analysis.error ? (
          <div className="absolute inset-x-3 bottom-3 max-w-xl">
            <Alert tone="error" title="Analysis failed">
              {analysis.error}
            </Alert>
          </div>
        ) : null}
      </section>

      <aside className="scroll-thin flex w-full shrink-0 flex-col overflow-y-auto border-line bg-panel xl:w-[390px] xl:border-l">
        <div className="sticky top-0 z-10 border-b border-line bg-panel p-2.5">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "results", label: "Results" },
              { value: "method", label: "Method" },
              { value: "data", label: "History" },
            ]}
          />
        </div>

        {tab === "results" ? (
          <div className="flex flex-col gap-3 p-3">
            {method === "temporal" ? (
              temporal.loading && !temporal.data ? (
                <Spinner />
              ) : temporal.data ? (
                <>
                  <Panel title="Temporal aggregation" subtitle={`${formatInt(temporal.data.scope.records)} incidents in scope · local time`}>
                    <p className="text-[11.5px] leading-relaxed text-muted">
                      Counts are aggregated by local hour, weekday, and calendar month. Profiles are descriptive; differences in traffic volume by time are not removed.
                    </p>
                  </Panel>
                  <Panel title="Hour of day"><EChart option={hourOption} height={150} /></Panel>
                  <Panel title="Day of week"><EChart option={dowOption} height={150} /></Panel>
                  <Panel title="Month of year (pooled)"><EChart option={moyOption} height={150} /></Panel>
                  <Panel title="Monthly series"><EChart option={monthlyOption} height={150} /></Panel>
                </>
              ) : null
            ) : null}

            {analysisMethod && analysis.status === "idle" ? (
              <EmptyState icon={<Sigma size={20} />} title="No analysis yet">
                Select a method and inputs; results appear here with their methodology.
              </EmptyState>
            ) : null}

            {analysisMethod && (analysis.status === "queued" || analysis.status === "running") ? (
              <Panel title="Running">
                <div className="flex flex-col gap-2">
                  <Spinner label={analysis.job?.progressMessage ?? "Queued"} />
                  <ProgressBar value={analysis.job?.progress ?? 0} />
                </div>
              </Panel>
            ) : null}

            {result ? (
              <>
                <Panel title="Headline statistics" actions={exportBase ? <ExportButtons base={exportBase} /> : null}>
                  <KeyValue
                    rows={Object.entries(result.summary)
                      .filter(([, v]) => v !== null)
                      .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), typeof v === "number" ? (Number.isInteger(v) ? formatInt(v) : String(v)) : String(v)] as [string, string])}
                  />
                </Panel>
                {strataOption ? <Panel title="Incidents per km by lighting quartile"><EChart option={strataOption} height={150} /></Panel> : null}
                {result.table.length ? (
                  <Panel title="Ranked output" subtitle={`${result.table.length} rows shown`}>
                    <div className="scroll-thin max-h-72 overflow-auto rounded border border-line">
                      <table className="w-full text-[11.5px]">
                        <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-[0.06em] text-muted">
                          <tr>
                            {Object.keys(result.table[0]!).map((k) => (
                              <th key={k} className="px-1.5 py-1 font-medium">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {result.table.map((r, i) => (
                            <tr key={i} className="border-t border-line">
                              {Object.values(r).map((v, j) => (
                                <td key={j} className="whitespace-nowrap px-1.5 py-1 font-mono tabular-nums">
                                  {v === null ? "—" : String(v)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                ) : null}
                {result.notes.length ? (
                  <Panel title="Interpretation notes">
                    <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[11.5px] leading-relaxed text-muted">
                      {result.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </Panel>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {tab === "method" ? (
          <div className="flex flex-col gap-3 p-3">
            {result ? (
              <Panel title={result.methodology.title}>
                <p className="text-[12.5px] leading-relaxed">{result.methodology.represents}</p>
                <div className={cx(labelCls, "mt-3")}>Method</div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{result.methodology.method}</p>
                {result.methodology.assumptions.length ? (
                  <>
                    <div className={cx(labelCls, "mt-3")}>Assumption checks</div>
                    <ul className="mt-1 flex flex-col gap-2 text-[12px]">
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
                  </>
                ) : null}
                <div className={cx(labelCls, "mt-3")}>Limitations</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-muted">
                  {result.methodology.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Panel>
            ) : analysisMethod ? (
              <Panel title={ANALYSIS_DEFS[analysisMethod].label}>
                <p className="text-[12.5px] leading-relaxed">{ANALYSIS_DEFS[analysisMethod].represents}</p>
                <div className={cx(labelCls, "mt-3")}>Method</div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{ANALYSIS_DEFS[analysisMethod].method}</p>
                <div className={cx(labelCls, "mt-3")}>Limitations</div>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-muted">
                  {ANALYSIS_DEFS[analysisMethod].limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Panel>
            ) : (
              <Panel title="Temporal aggregation">
                <p className="text-[12.5px] leading-relaxed">Counts incidents by local hour, weekday, and month. It is a descriptive profile and makes no inference.</p>
              </Panel>
            )}
            <Alert tone="info" title="Scope of inference">
              Results summarise recorded synthetic incidents. Methods identify concentration and association, not causation, and not risk without exposure data.
            </Alert>
          </div>
        ) : null}

        {tab === "data" ? (
          <div className="flex flex-col gap-3 p-3">
            <Panel title="Analysis history" subtitle="Most recent jobs; select one to reload its result" actions={<Activity size={13} className="text-muted" />}>
              {history.loading && !history.data ? <Spinner /> : null}
              <ul className="flex flex-col gap-1">
                {(history.data?.items ?? []).map((j) => (
                  <li key={j.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        const full = await apiGet<JobView>(`/analysis/jobs/${j.id}`);
                        chooseMethod(full.analysisType);
                        analysis.show(full);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-panel-2"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{ANALYSIS_DEFS[j.analysisType].short}</span>
                        <span className="ml-2 text-[10.5px] text-muted">{j.createdAt.slice(11, 16)} UTC</span>
                      </span>
                      <Badge tone={j.status === "completed" ? "ok" : j.status === "failed" ? "danger" : "warn"}>{j.status}</Badge>
                    </button>
                  </li>
                ))}
                {history.data?.items.length === 0 ? <li className="text-[12px] text-muted">No analyses have been run yet.</li> : null}
              </ul>
            </Panel>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function ExportButtons({ base }: { base: string }) {
  return (
    <div className="flex gap-1.5">
      <a href={`${base}?format=geojson`} download className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-[11.5px] text-fg hover:border-faint">
        <Download size={12} /> GeoJSON
      </a>
      <a href={`${base}?format=csv`} download className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-[11.5px] text-fg hover:border-faint">
        <Table2 size={12} /> CSV
      </a>
    </div>
  );
}


