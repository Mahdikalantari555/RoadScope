"use client";

import { useEffect, useState } from "react";
import { Beaker, Download, FlaskConical, History, Info, Play, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { FilterBar } from "@/components/FilterBar";
import { Callout, Divider, LoadingRows, MetricGrid, Panel, SectionLabel, Spinner, ToggleChip } from "@/components/ui";
import {
  ANALYSIS_KINDS,
  DEFAULT_FILTERS,
  filtersToQuery,
  formatNumber,
  useApi,
  type AnalysisResponse,
  type FilterState,
  type MetaPayload,
  type NetworkResponse,
} from "@/lib/client/api";
import { DEFAULT_ANALYSIS_PARAMS, type AnalysisKind, type AnalysisParams } from "@/lib/analysis";

type JobRow = {
  id: number;
  kind: string;
  status: string;
  createdAt: string;
  durationMs: number | null;
  featureCount: number;
  params: { analysis?: AnalysisParams; sampleSize?: number };
  summary: { title?: string } | null;
  createdBy: string | null;
};

export function LabWorkspace({ initialMeta, role }: { initialMeta: MetaPayload; role: string }) {
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS, status: ["verified"] });
  const [kind, setKind] = useState<AnalysisKind>("kde");
  const [params, setParams] = useState<AnalysisParams>(DEFAULT_ANALYSIS_PARAMS);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sharePending, setSharePending] = useState(false);
  const network = useApi<NetworkResponse>("/api/network");
  const jobs = useApi<{ jobs: JobRow[] }>("/api/analysis", [nonce]);
  const query = filtersToQuery(filters);

  useEffect(() => {
    const controller = new AbortController();
    setRunning(true);
    setError(null);
    fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        kind,
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
        setRunning(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setRunning(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, nonce]);

  const selectedKind = ANALYSIS_KINDS.find((k) => k.kind === kind) ?? ANALYSIS_KINDS[0];
  const legend = analysis?.legend.map((entry) => ({ label: entry.label, color: entry.color })) ?? [];

  return (
    <div className="flex min-h-[calc(100vh-48px)] flex-col bg-bg lg:h-[calc(100vh-48px)] lg:flex-row lg:overflow-hidden">
      <aside className="order-2 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:order-1 lg:h-full lg:w-[286px] lg:border-r">
        <Panel title="Analysis methods" icon={<FlaskConical size={12} />} bodyClassName="p-1.5">
          <div className="space-y-1">
            {ANALYSIS_KINDS.map((option) => (
              <button
                key={option.kind}
                type="button"
                onClick={() => setKind(option.kind)}
                className={`w-full rounded-[3px] border px-2 py-1.5 text-left transition-colors focus-ring ${
                  kind === option.kind ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-line bg-panel text-muted hover:text-ink"
                }`}
              >
                <span className="block text-[11.5px] font-medium">{option.label}</span>
                <span className="block text-[9.5px] leading-tight text-faint">{option.description}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Parameters" icon={<SlidersHorizontal size={12} />}>
          <div className="space-y-2.5">
            {selectedKind.params.includes("bandwidthM") && (
              <label className="block">
                <span className="label-caps flex justify-between"><span>Bandwidth / distance band</span><span className="mono text-accent">{params.bandwidthM} m</span></span>
                <input type="range" min={80} max={800} step={20} value={params.bandwidthM} onChange={(e) => setParams({ ...params, bandwidthM: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
              </label>
            )}
            {selectedKind.params.includes("cellSizeM") && (
              <label className="block">
                <span className="label-caps flex justify-between"><span>Lattice cell size</span><span className="mono text-accent">{params.cellSizeM} m</span></span>
                <input type="range" min={60} max={320} step={20} value={params.cellSizeM} onChange={(e) => setParams({ ...params, cellSizeM: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
              </label>
            )}
            {selectedKind.params.includes("weightBy") && (
              <label className="block">
                <span className="label-caps mb-1 block">Weighting</span>
                <select className="select" value={params.weightBy} onChange={(e) => setParams({ ...params, weightBy: e.target.value as AnalysisParams["weightBy"] })}>
                  <option value="severity">Severity-weighted</option>
                  <option value="count">Unweighted count</option>
                  <option value="casualties">Casualty-weighted</option>
                </select>
              </label>
            )}
            {selectedKind.params.includes("epsM") && (
              <label className="block">
                <span className="label-caps flex justify-between"><span>DBSCAN eps</span><span className="mono text-accent">{params.epsM} m</span></span>
                <input type="range" min={60} max={500} step={20} value={params.epsM} onChange={(e) => setParams({ ...params, epsM: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
              </label>
            )}
            {selectedKind.params.includes("minPts") && (
              <label className="block">
                <span className="label-caps flex justify-between"><span>Minimum points</span><span className="mono text-accent">{params.minPts}</span></span>
                <input type="range" min={2} max={20} value={params.minPts} onChange={(e) => setParams({ ...params, minPts: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
              </label>
            )}
            {selectedKind.params.includes("metric") && (
              <label className="block">
                <span className="label-caps mb-1 block">Segment metric</span>
                <select className="select" value={params.metric} onChange={(e) => setParams({ ...params, metric: e.target.value as AnalysisParams["metric"] })}>
                  <option value="severity">Severity-weighted</option>
                  <option value="count">Count</option>
                  <option value="density">Density per km</option>
                  <option value="ksi">KSI</option>
                </select>
              </label>
            )}
            <div className="flex items-center gap-1">
              <button type="button" className="btn btn-primary btn-xs flex-1" onClick={() => setNonce((n) => n + 1)} disabled={running}>
                <Play size={11} /> {running ? "Running…" : "Run analysis"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              <ToggleChip active={filters.status.includes("verified")} onClick={() => setFilters({ ...filters, status: filters.status.includes("verified") ? filters.status.filter((s) => s !== "verified") : [...filters.status, "verified"] })}>
                Verified
              </ToggleChip>
              <ToggleChip active={filters.status.includes("reported")} onClick={() => setFilters({ ...filters, status: filters.status.includes("reported") ? filters.status.filter((s) => s !== "reported") : [...filters.status, "reported"] })}>
                Include pending
              </ToggleChip>
            </div>
            <p className="text-[9.5px] leading-relaxed text-faint">Changing filters requires re-running the analysis so that provenance is explicit.</p>
          </div>
        </Panel>

        <Panel title="Input selection" icon={<Beaker size={12} />}>
          <FilterBar filters={filters} onChange={setFilters} meta={initialMeta} compact />
        </Panel>

        <Panel title="Recent jobs" icon={<History size={12} />}>
          {jobs.loading && <LoadingRows rows={3} height={20} />}
          <div className="space-y-1">
            {(jobs.data?.jobs ?? []).slice(0, 6).map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="mono text-faint">#{job.id}</span>
                <span className="min-w-0 flex-1 truncate text-muted capitalize">{job.kind}</span>
                <span className="mono text-faint">{job.featureCount} f</span>
                <a className="link" href={`/api/export?kind=analysis&format=geojson&jobId=${job.id}`} download title="Download GeoJSON">
                  <Download size={10} />
                </a>
              </div>
            ))}
          </div>
        </Panel>
      </aside>

      <div className="relative order-1 h-[50vh] min-h-[340px] w-full flex-none lg:order-2 lg:h-full lg:min-h-0 lg:flex-1">
        <MapView
          mode={kind === "segment" ? "segments" : kind === "dbscan" ? "dbscan" : kind === "hotspot" ? "hotspot" : kind === "environment" ? "environment" : kind === "temporal" ? "temporal" : "kde"}
          accidents={kind === "temporal" || kind === "kde" ? (analysis?.kind === "temporal" ? analysis.features : null) : null}
          analysis={analysis?.features ?? null}
          network={network.data}
          basemap="minimal"
          toggles={{ roads: true, districts: true, water: true, parks: true, intersections: false }}
          legend={legend}
          fitNonce={0}
          onSelectAccident={() => undefined}
        />
        {running && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_oklab,var(--bg)_55%,transparent)]">
            <div className="panel flex items-center gap-2 px-3 py-2 text-[11px] text-accent">
              <Spinner label="Computing spatial statistics…" />
            </div>
          </div>
        )}
        {error && (
          <div className="absolute bottom-2 left-2 right-2">
            <Callout tone="danger" title="Analysis error">{error}</Callout>
          </div>
        )}
      </div>

      <aside className="order-3 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:h-full lg:w-[360px] lg:border-l">
        <Panel title="Result" icon={<Info size={12} />} actions={<span className="badge badge-accent">{role}</span>}>
          {!analysis ? (
            <LoadingRows rows={5} />
          ) : (
            <div className="space-y-2">
              <div>
                <div className="text-[12.5px] font-semibold text-ink">{analysis.title}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{analysis.description}</p>
              </div>
              <MetricGrid metrics={analysis.metrics.slice(0, 6)} columns={2} />
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-faint">
                <span>job #{analysis.jobId}</span>
                <span>· {analysis.sampleSize} input events</span>
                <span>· {analysis.features.features.length} features</span>
                <span>· {Math.round(analysis.durationMs)} ms</span>
              </div>
              <div className="flex gap-1">
                <a className="btn btn-xs flex-1" href={`/api/export?kind=analysis&format=geojson&jobId=${analysis.jobId}`} download>
                  <Download size={11} /> GeoJSON
                </a>
                <a className="btn btn-xs" href={`/api/export?kind=analysis&format=csv&jobId=${analysis.jobId}`} download>
                  CSV
                </a>
              </div>
              {analysis.truncated && (
                <Callout tone="warn" title="Storage truncated">
                  Only {analysis.storedFeatures} of {analysis.features.features.length} features were persisted for export; the map shows the full
                  result.
                </Callout>
              )}
              <Divider label="legend" />
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {analysis.legend.map((entry) => (
                  <div key={entry.label} className="flex items-center gap-1.5 text-[10px] text-muted">
                    <span className="legend-swatch" style={{ background: entry.color }} />
                    <span className="truncate">{entry.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {analysis && (
          <>
            <Panel title="Methodological explanation" icon={<TriangleAlert size={12} />}>
              <div className="space-y-2">
                <SectionLabel>Assumptions</SectionLabel>
                <ul className="list-disc space-y-1 pl-3.5 text-[10.5px] leading-relaxed text-muted">
                  {analysis.assumptions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <SectionLabel>Limitations</SectionLabel>
                <ul className="list-disc space-y-1 pl-3.5 text-[10.5px] leading-relaxed text-muted">
                  {analysis.limitations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="text-[9.5px] leading-relaxed text-faint">
                  Descriptive concentration (KDE, heat) is not statistical significance. Getis-Ord Gi* is a location-specific screen with multiple
                  testing implications; it is not a causal attribution.
                </p>
              </div>
            </Panel>

            {analysis.tables.map((table) => (
              <Panel key={table.title} title={table.title} icon={<History size={12} />}>
                <div className="max-h-[280px] overflow-auto scroll-thin border border-line">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {table.columns.map((column) => (
                          <th key={column.key} className={column.align === "right" ? "num" : ""}>
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, index) => (
                        <tr key={index}>
                          {table.columns.map((column) => (
                            <td key={column.key} className={column.align === "right" ? "num" : ""}>
                              {String(row[column.key] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {table.note && <p className="mt-1 text-[9.5px] text-faint">{table.note}</p>}
              </Panel>
            ))}

            <Panel title="Reproducibility" icon={<Info size={12} />}>
              <div className="space-y-1 text-[10px] text-muted">
                <div className="flex justify-between"><span>Input filters</span><span className="mono text-ink">{query.slice(0, 26)}…</span></div>
                <div className="flex justify-between"><span>Sample size</span><span className="mono text-ink">{formatNumber(analysis.sampleSize)}</span></div>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={sharePending} onChange={(e) => setSharePending(e.target.checked)} />
                  <span className="text-[10px]">Include job metadata in an exported appendix</span>
                </label>
                {sharePending && (
                  <pre className="mt-1 max-h-[130px] overflow-auto rounded border border-line bg-panel p-1.5 font-mono text-[9px] leading-relaxed text-faint">
{JSON.stringify({ jobId: analysis.jobId, kind: analysis.kind, params: analysis.params, input: JSON.parse(JSON.stringify(filters)), sample: analysis.sampleSize, features: analysis.features.features.length }, null, 2)}
                  </pre>
                )}
              </div>
            </Panel>
          </>
        )}
      </aside>
    </div>
  );
}
