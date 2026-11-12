"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Gauge, Layers, Scale, ShieldAlert, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { FilterBar } from "@/components/FilterBar";
import { Callout, CoverageBar, Divider, LoadingRows, MetricGrid, Panel, SectionLabel, Spinner, ToggleChip } from "@/components/ui";
import {
  DEFAULT_FILTERS,
  filtersToQuery,
  formatNumber,
  formatPct,
  useApi,
  type FilterState,
  type MetaPayload,
  type NetworkResponse,
  type RiskResponse,
} from "@/lib/client/api";
import type { RiskOptions } from "@/lib/risk";
import { DEFAULT_RISK_OPTIONS } from "@/lib/risk";

const COMPONENTS: { key: keyof RiskOptions["weights"]; label: string; hint: string }[] = [
  { key: "frequency", label: "Accident frequency", hint: "Normalised event count" },
  { key: "severity", label: "Severity weight", hint: "PDO 1 / slight 3 / serious 7 / fatal 12" },
  { key: "density", label: "Accident density", hint: "Events per kilometre" },
  { key: "exposure", label: "Exposure rate", hint: "Events per 100M vehicle-km (AADT)" },
  { key: "environment", label: "Environmental / road", hint: "Wet & dark share, lighting, surface, speed" },
];

export function RiskWorkspace({ initialMeta }: { initialMeta: MetaPayload }) {
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS, status: ["verified"] });
  const [options, setOptions] = useState<RiskOptions>(DEFAULT_RISK_OPTIONS);
  const [applied, setApplied] = useState<RiskOptions>(DEFAULT_RISK_OPTIONS);
  const [selected, setSelected] = useState<RiskResponse["segments"][number] | null>(null);
  const network = useApi<NetworkResponse>("/api/network");
  const query = filtersToQuery(filters);

  useEffect(() => {
    const timer = setTimeout(() => setApplied(options), 260);
    return () => clearTimeout(timer);
  }, [options]);

  const riskUrl = `/api/risk?${query}&frequency=${applied.weights.frequency}&severity=${applied.weights.severity}&density=${applied.weights.density}&exposure=${applied.weights.exposure}&environment=${applied.weights.environment}&useExposure=${applied.useExposure}&stabilityK=${applied.stabilityK}&normalisation=${applied.normalisation}`;
  const risk = useApi<RiskResponse>(riskUrl, [riskUrl]);
  const weightSum = COMPONENTS.reduce((sum, component) => sum + (applied.useExposure || component.key !== "exposure" ? options.weights[component.key] : 0), 0);

  const topSegments = useMemo(() => risk.data?.segments.slice(0, 18) ?? [], [risk.data]);
  const exportQuery = `${query}&frequency=${applied.weights.frequency}&severity=${applied.weights.severity}&density=${applied.weights.density}&exposure=${applied.weights.exposure}&environment=${applied.weights.environment}&useExposure=${applied.useExposure}&stabilityK=${applied.stabilityK}&normalisation=${applied.normalisation}`;

  return (
    <div className="flex min-h-[calc(100vh-48px)] flex-col bg-bg lg:h-[calc(100vh-48px)] lg:flex-row lg:overflow-hidden">
      <aside className="order-2 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:order-1 lg:h-full lg:w-[290px] lg:border-r">
        <Panel title="Risk engine" icon={<ShieldAlert size={12} />}>
          <p className="text-[10.5px] leading-relaxed text-muted">
            A relative, configurable index. Every component is exposed for audit; nothing here is a calibrated crash probability.
          </p>
          <Divider label="weights" />
          <div className="space-y-2">
            {COMPONENTS.map((component) => (
              <label key={component.key} className="block" title={component.hint}>
                <span className="label-caps flex justify-between">
                  <span>{component.label}</span>
                  <span className="mono text-accent">{(options.weights[component.key] * 100).toFixed(0)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.02}
                  value={options.weights[component.key]}
                  disabled={component.key === "exposure" && !options.useExposure}
                  onChange={(event) => setOptions({ ...options, weights: { ...options.weights, [component.key]: Number(event.target.value) } })}
                  className="mt-1 w-full accent-[var(--accent)]"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
            <span>Raw weight sum</span>
            <span className="mono text-ink">{weightSum.toFixed(2)}</span>
          </div>
          <p className="text-[9.5px] leading-relaxed text-faint">Weights are renormalised internally, so absolute values may sum to any positive number.</p>
          <Divider label="options" />
          <div className="space-y-2">
            <label className="block">
              <span className="label-caps mb-1 block">Normalisation</span>
              <select className="select" value={options.normalisation} onChange={(e) => setOptions({ ...options, normalisation: e.target.value as RiskOptions["normalisation"] })}>
                <option value="minmax">Min–max (0–1)</option>
                <option value="rank">Rank percentile</option>
                <option value="zscore">Z-score rescaled</option>
              </select>
            </label>
            <label className="block">
              <span className="label-caps flex justify-between"><span>Stability k</span><span className="mono text-accent">{options.stabilityK}</span></span>
              <input type="range" min={0} max={20} value={options.stabilityK} onChange={(e) => setOptions({ ...options, stabilityK: Number(e.target.value) })} className="mt-1 w-full accent-[var(--accent)]" />
            </label>
            <div className="flex flex-wrap gap-1">
              <ToggleChip active={options.useExposure} onClick={() => setOptions({ ...options, useExposure: !options.useExposure })}>
                Exposure-aware
              </ToggleChip>
              <ToggleChip active={filters.status.includes("reported")} onClick={() => setFilters({ ...filters, status: filters.status.includes("reported") ? ["verified"] : ["verified", "reported"] })}>
                Include pending
              </ToggleChip>
            </div>
            <button type="button" className="btn btn-xs w-full" onClick={() => setOptions(DEFAULT_RISK_OPTIONS)}>
              Restore default weights
            </button>
          </div>
        </Panel>

        <Panel title="Input filters" icon={<SlidersHorizontal size={12} />}>
          <FilterBar filters={filters} onChange={setFilters} meta={initialMeta} compact />
        </Panel>

        <Panel title="Export" icon={<Download size={12} />}>
          <div className="grid grid-cols-2 gap-1">
            <a className="btn btn-xs" href={`/api/export?kind=risk&format=csv&${exportQuery}`} download>
              CSV
            </a>
            <a className="btn btn-xs" href={`/api/export?kind=risk&format=geojson&${exportQuery}`} download>
              GeoJSON
            </a>
          </div>
          <p className="mt-1.5 text-[9.5px] leading-relaxed text-faint">Each export carries a synthetic-data provenance header and a “relative index, not a probability” note.</p>
        </Panel>
      </aside>

      <div className="relative order-1 h-[50vh] min-h-[340px] w-full flex-none lg:order-2 lg:h-full lg:min-h-0 lg:flex-1">
        <MapView
          mode="risk"
          accidents={null}
          segmentValues={risk.data?.features ?? null}
          network={network.data}
          basemap="minimal"
          toggles={{ roads: true, districts: true, water: true, parks: false, intersections: false }}
          legend={[
            { label: "Very low", color: "#164e63" },
            { label: "Low", color: "#0e7490" },
            { label: "Moderate", color: "#22d3ee" },
            { label: "High", color: "#e3b341" },
            { label: "Very high", color: "#e5402a" },
          ]}
          onSelectSegment={(properties) => {
            const segment = risk.data?.segments.find((s) => s.segmentId === properties.segmentId);
            if (segment) setSelected(segment);
          }}
          fitNonce={0}
        />
        {risk.loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[color-mix(in_oklab,var(--bg)_45%,transparent)]">
            <div className="panel px-3 py-2">
              <Spinner label="Scoring network segments…" />
            </div>
          </div>
        )}
      </div>

      <aside className="order-3 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:h-full lg:w-[368px] lg:border-l">
        {risk.data ? (
          <>
            <Panel title="Network summary" icon={<Gauge size={12} />} actions={<span className="badge badge-warn">relative index</span>}>
              <MetricGrid
                metrics={[
                  { label: "Segments scored", value: formatNumber(risk.data.summary.analysedSegments) },
                  { label: "Segments with events", value: formatNumber(risk.data.summary.segmentsWithEvents) },
                  { label: "Network length", value: `${risk.data.summary.networkKm.toFixed(0)} km` },
                  { label: "Events analysed", value: formatNumber(risk.data.summary.eventsAnalysed) },
                  { label: "High-risk (top decile)", value: formatNumber(risk.data.summary.highRiskSegments) },
                  { label: "Median index", value: risk.data.summary.medianRiskIndex.toFixed(1) },
                  { label: "P90 index", value: risk.data.summary.p90RiskIndex.toFixed(1) },
                  { label: "Mean severity density", value: `${risk.data.summary.meanSeverityDensity.toFixed(2)}/km` },
                ]}
              />
              <Divider label="data coverage" />
              <div className="space-y-2">
                <CoverageBar label="Exposure (AADT) availability" value={risk.data.summary.exposureCoverage} hint="Missing exposure falls back to the network mean" />
                <CoverageBar label="Environmental context" value={risk.data.summary.environmentalCoverage} hint="Reported weather/lighting joined to segment events" />
              </div>
            </Panel>

            <Panel title="Ranked segments" icon={<Layers size={12} />}>
              <div className="max-h-[320px] overflow-auto scroll-thin border border-line">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Segment</th>
                      <th className="num">n</th>
                      <th className="num">KSI</th>
                      <th className="num">Index</th>
                      <th className="num">±</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSegments.map((segment) => (
                      <tr key={segment.segmentId} className="cursor-pointer" onClick={() => setSelected(segment)}>
                        <td className="mono">{segment.rank}</td>
                        <td className="max-w-[110px] truncate">{segment.name}</td>
                        <td className="num">{segment.count}</td>
                        <td className="num">{segment.ksi}</td>
                        <td className="num" style={{ color: segment.riskIndex > risk.data!.summary.p90RiskIndex ? "var(--danger)" : undefined }}>
                          {segment.riskIndex.toFixed(1)}
                        </td>
                        <td className="num">{segment.uncertainty.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[9.5px] text-faint">± is a combined reliability/coverage penalty (0 = high confidence). Rank is ordinal within this run.</p>
            </Panel>

            {selected && (
              <Panel
                title="Segment diagnostics"
                icon={<TriangleAlert size={12} />}
                actions={<button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelected(null)}>close</button>}
              >
                <div className="space-y-2">
                  <div>
                    <div className="text-[12px] font-semibold text-ink">{selected.name}</div>
                    <div className="text-[10px] text-faint">
                      {selected.segmentId} · {selected.roadClass} · {selected.district ?? "—"} · {(selected.lengthM / 1000).toFixed(2)} km
                    </div>
                  </div>
                  <MetricGrid
                    metrics={[
                      { label: "Rank", value: `#${selected.rank}` },
                      { label: "Risk index", value: selected.riskIndex.toFixed(1) },
                      { label: "Events", value: selected.count },
                      { label: "KSI", value: selected.ksi },
                      { label: "Density", value: `${selected.densityPerKm.toFixed(2)}/km` },
                      { label: "Severity-weighted", value: selected.severityWeighted.toFixed(1) },
                      { label: "AADT", value: selected.aadt ? formatNumber(selected.aadt) : "n/a" },
                      { label: "Rate /100M veh-km", value: selected.ratePer100mVehKm === null ? "n/a" : selected.ratePer100mVehKm.toFixed(2) },
                      { label: "Wet share", value: formatPct(selected.wetShare, 0) },
                      { label: "Dark share", value: formatPct(selected.darkShare, 0) },
                      { label: "Evidence class", value: selected.evidenceClass },
                      { label: "Stability", value: selected.stability.toFixed(2) },
                    ]}
                  />
                  <SectionLabel>Component contributions (normalised)</SectionLabel>
                  <div className="space-y-1.5">
                    {COMPONENTS.map((component) => {
                      const value = selected.components[component.key];
                      return (
                        <div key={component.key}>
                          <div className="mb-0.5 flex justify-between text-[10px]">
                            <span className="text-muted">{component.label}</span>
                            <span className="mono text-ink">{value.toFixed(2)}</span>
                          </div>
                          <div className="progress">
                            <span style={{ width: `${Math.min(100, value * 100)}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Panel>
            )}

            <Panel title="Methodology" icon={<Scale size={12} />}>
              <div className="space-y-2">
                {risk.data.methodology.map((item) => (
                  <div key={item.title}>
                    <div className="text-[10.5px] font-semibold text-ink">{item.title}</div>
                    <p className="text-[10px] leading-relaxed text-muted">{item.detail}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Callout tone="warn" title="Limitations & responsible use">
              <ul className="list-disc space-y-1 pl-3.5">
                {risk.data.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Callout>
          </>
        ) : (
          <Panel title="Network summary" icon={<Gauge size={12} />}>
            <LoadingRows rows={6} />
          </Panel>
        )}
      </aside>
    </div>
  );
}
