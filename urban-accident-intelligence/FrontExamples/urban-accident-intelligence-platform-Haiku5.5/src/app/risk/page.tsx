"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Info, ShieldAlert, Play } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { FilterBar } from "@/components/FilterBar";
import { MapLegend } from "@/components/MapLegend";
import { Alert, Badge, Button, KeyValue, Panel, Segmented, Spinner, Stat, cx, labelCls } from "@/components/ui";
import { useAnalysis, useApi, useDebounced } from "@/components/hooks";
import { decorateAnalysis, legendFor } from "@/components/map-style";
import { ANALYSIS_DEFS, defaultParamValues } from "@/lib/catalog";
import { withQuery } from "@/lib/client-api";
import { STUDY_AREA, type GeoFeature, type GeoFeatureCollection } from "@/lib/domain";
import { filtersToParams, type FilterSpec } from "@/lib/filters";
import { formatInt, formatPct } from "@/lib/format";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Loading map…</div>,
});

const WEIGHTS: { key: string; label: string; what: string }[] = [
  { key: "wCount", label: "Frequency", what: "Recorded incident count on the segment (percentile-normalised)." },
  { key: "wDensity", label: "Density", what: "Incidents per kilometre of road." },
  { key: "wSeverity", label: "Severity", what: "Severity-weighted incidents per kilometre (illustrative weights 1–20)." },
  { key: "wExposure", label: "Exposure", what: "Incidents per million vehicle-kilometres, when traffic counts exist." },
  { key: "wDarkness", label: "Darkness", what: "One minus the lighting score of the segment." },
  { key: "wSpeed", label: "Speed limit", what: "Posted speed limit of the segment." },
];

const HIDDEN = new Set(["color", "opacity", "width", "value"]);

export default function RiskPage() {
  const { filters } = useApp();
  const [params, setParams] = useState<Record<string, number | string>>(() => defaultParamValues("risk"));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const analysis = useAnalysis();
  const qs = useMemo(() => filtersToParams(filters).toString(), [filters]);
  const roads = useApi<GeoFeatureCollection>(withQuery("/segments", qs));

  const runKey = JSON.stringify({ params, filters });
  const debouncedKey = useDebounced(runKey, 500);
  const runAnalysis = analysis.run;
  useEffect(() => {
    const k = JSON.parse(debouncedKey) as { params: Record<string, number | string>; filters: FilterSpec };
    void runAnalysis("risk", k.params, k.filters);
  }, [debouncedKey, runAnalysis]);

  const result = analysis.job?.analysisType === "risk" ? analysis.job.result : null;
  const fc = useMemo<GeoFeatureCollection | null>(() => (result ? decorateAnalysis("risk", result.featureCollection) : null), [result]);
  const selectedFeature = useMemo<GeoFeature | null>(() => fc?.features.find((f) => f.properties.segmentId === selectedId) ?? null, [fc, selectedId]);
  const weightSum = WEIGHTS.reduce((s, w) => s + Number(params[w.key] ?? 0), 0);
  const normalization = String(params.normalization ?? "percentile");

  const selectedRow = result?.table.find((r) => r.segment === (selectedFeature?.properties.name as string | undefined));
  const selProps = selectedFeature ? Object.entries(selectedFeature.properties).filter(([k, v]) => !HIDDEN.has(k) && v !== null && typeof v !== "object") : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-line bg-panel p-3.5 xl:w-[330px] xl:border-r">
        <div className="flex items-start gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-warn/15 text-warn">
            <ShieldAlert size={15} />
          </span>
          <div>
            <h1 className="text-[14px] font-semibold tracking-tight">Risk assessment workspace</h1>
            <p className="text-[11px] leading-relaxed text-muted">A transparent, configurable ranking of road segments.</p>
          </div>
        </div>

        <Alert tone="warn" title="Relative index — not a probability">
          Scores rank segments within this dataset. They are not calibrated accident probabilities and have not been validated against independent outcomes.
        </Alert>

        <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas/40 p-2.5">
          <div className="flex items-center justify-between">
            <span className={labelCls}>Indicator weights</span>
            <span className="font-mono text-[11px] text-muted">Σ {weightSum.toFixed(2)}</span>
          </div>
          {WEIGHTS.map((w) => (
            <label key={w.key} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-[11.5px]">
                <span className="text-fg">{w.label}</span>
                <span className="font-mono text-muted">{Number(params[w.key]).toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={Number(params[w.key])}
                onChange={(e) => setParams((p) => ({ ...p, [w.key]: Number(e.target.value) }))}
                className="accent-[var(--c-accent)]"
                aria-label={`${w.label} weight`}
              />
              <span className="text-[10.5px] text-faint">{w.what}</span>
            </label>
          ))}
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>Normalisation</span>
            <Segmented
              size="sm"
              value={normalization}
              options={[
                { value: "percentile", label: "Percentile rank" },
                { value: "minmax", label: "Min–max" },
              ]}
              onChange={(v) => setParams((p) => ({ ...p, normalization: v }))}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-faint">Scores are weighted means over indicators with data.</span>
            <Button size="sm" variant="primary" icon={<Play size={12} />} busy={analysis.status === "queued" || analysis.status === "running"} onClick={() => void runAnalysis("risk", params, filters)}>
              Recompute
            </Button>
          </div>
          {weightSum <= 0 ? <Alert tone="error">At least one weight must be greater than zero.</Alert> : null}
        </div>

        <Panel title="How to read the index" subtitle="Distinguish three different quantities">
          <dl className="flex flex-col gap-2.5 text-[11.5px] leading-relaxed">
            <div>
              <dt className="font-semibold text-fg">Accident frequency</dt>
              <dd className="text-muted">How many incidents were recorded on a segment in the selected period.</dd>
            </div>
            <div>
              <dt className="font-semibold text-fg">Relative risk index</dt>
              <dd className="text-muted">A 0–100 ranking of segments under the chosen weights and normalisation. Changing weights can reorder the ranking.</dd>
            </div>
            <div>
              <dt className="font-semibold text-fg">Probability of occurrence</dt>
              <dd className="text-muted">Not estimated. It would require exposure, a calibrated model, and out-of-sample validation, none of which this index provides.</dd>
            </div>
          </dl>
        </Panel>

        <div className="border-t border-line pt-3">
          <FilterBar variant="compact" />
        </div>
      </aside>

      <section className="relative min-h-[420px] flex-1 lg:min-h-[480px] xl:min-h-0">
        <MapView
          basemap="dark"
          points={null}
          pointsMode="hidden"
          roads={roads.data}
          roadsMode="base"
          analysis={fc}
          analysisKind={result ? "risk" : null}
          analysisOpacity={0.9}
          selectedFeature={selectedFeature}
          onSelect={(sel) => {
            if (sel && sel.kind === "analysis" && typeof sel.properties.segmentId === "number") setSelectedId(sel.properties.segmentId);
            else if (sel && sel.kind === "segment" && sel.id !== null) setSelectedId(sel.id);
          }}
          className="h-full"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-line bg-panel/90 px-2 py-1 text-[12px] font-medium shadow">Relative risk index</span>
          {analysis.status === "queued" || analysis.status === "running" ? (
            <span className="rounded-md bg-panel/90 px-2 py-1 text-[11px] shadow">
              <Spinner label={analysis.job?.progressMessage ?? "Scoring"} />
            </span>
          ) : null}
        </div>
        {result ? (
          <div className="absolute bottom-3 left-3 max-h-[calc(100%-1.5rem)] overflow-auto">
            <MapLegend spec={legendFor("risk")} />
          </div>
        ) : null}
        {analysis.status === "failed" && analysis.error ? (
          <div className="absolute inset-x-3 bottom-3 max-w-xl">
            <Alert tone="error" title="Scoring failed">
              {analysis.error}
            </Alert>
          </div>
        ) : null}
      </section>

      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-line bg-panel p-3 xl:w-[390px] xl:border-l">
        {result ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Segments scored" value={formatInt(Number(result.summary.segments ?? 0))} />
              <Stat label="Mean score" value={String(result.summary.meanScore ?? "—")} tone="accent" hint="0–100 relative index" />
              <Stat label="Mean coverage" value={`${result.summary.meanCoveragePct ?? "—"}%`} hint="Share of weight with data" />
              <Stat label="High uncertainty" value={formatInt(Number(result.summary.highUncertaintySegments ?? 0))} tone="warn" hint="Fewer than 5 incidents" />
            </div>

            {selectedFeature ? (
              <Panel title={String(selectedFeature.properties.name)} subtitle={`Rank #${String(selectedFeature.properties.rank)} · score ${String(selectedFeature.properties.score)}`} actions={<Badge tone={selectedFeature.properties.uncertainty === "high" ? "warn" : "neutral"}>{String(selectedFeature.properties.uncertainty)} uncertainty</Badge>}>
                <KeyValue
                  rows={[
                    ["Incidents (count)", String(selectedFeature.properties.count)],
                    ["95% interval (Poisson)", `${String(selectedFeature.properties.ciLow)} – ${String(selectedFeature.properties.ciHigh)}`],
                    ["Per km", String(selectedFeature.properties.perKm)],
                    ["Severity per km", String(selectedFeature.properties.severityPerKm)],
                    ["Exposure rate (per M veh-km)", selectedFeature.properties.exposureRate === null ? "not available" : String(selectedFeature.properties.exposureRate)],
                    ["Coverage", formatPct(Number(selectedFeature.properties.coverage), 0)],
                    ["Road class", String(selectedFeature.properties.roadClass)],
                  ]}
                />
                {selectedRow ? <p className="mt-2 text-[10.5px] text-faint">Ranked in the top 25 table.</p> : null}
                <details className="mt-2 text-[11px] text-muted">
                  <summary className="cursor-pointer text-fg">All properties</summary>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[10.5px]">
                    {selProps.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-faint">{k}</dt>
                        <dd className="truncate text-right">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </Panel>
            ) : (
              <Alert tone="info" title="Select a segment">
                Click a road on the map or a row below to inspect its indicators, interval, and coverage.
              </Alert>
            )}

            <Panel title="Ranked segments" subtitle={`Top 25 · ${normalization === "percentile" ? "percentile" : "min–max"} normalisation`}>
              <div className="scroll-thin max-h-[420px] overflow-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-[0.06em] text-muted">
                    <tr>
                      <th className="py-1 pr-1 font-medium">#</th>
                      <th className="py-1 pr-1 font-medium">Segment</th>
                      <th className="py-1 pr-1 text-right font-medium">Score</th>
                      <th className="py-1 pr-1 text-right font-medium">n</th>
                      <th className="py-1 text-right font-medium">Cov.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.table.map((r) => {
                      const feature = fc?.features.find((f) => f.properties.name === r.segment);
                      const id = feature ? Number(feature.properties.segmentId) : null;
                      return (
                        <tr key={String(r.rank)} onClick={() => id !== null && setSelectedId(id)} className={cx("cursor-pointer border-t border-line hover:bg-panel-2", id !== null && id === selectedId && "bg-accent/10")}>
                          <td className="py-1 pr-1 font-mono text-faint">{String(r.rank)}</td>
                          <td className="max-w-[160px] truncate py-1 pr-1">{String(r.segment)}</td>
                          <td className="py-1 pr-1 text-right font-mono tabular-nums">{String(r.score)}</td>
                          <td className="py-1 pr-1 text-right font-mono tabular-nums">{String(r.count)}</td>
                          <td className="py-1 text-right font-mono tabular-nums text-muted">{String(r.coveragePct)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Methodology and limits">
              <p className="text-[11.5px] leading-relaxed text-muted">{result.methodology.method}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11.5px] text-muted">
                {result.methodology.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {result.notes.map((n) => (
                <p key={n} className="mt-2 flex gap-1.5 text-[11px] text-faint">
                  <Info size={11} className="mt-0.5 shrink-0" />
                  {n}
                </p>
              ))}
            </Panel>
            <p className="text-[10.5px] text-faint">
              Study area {STUDY_AREA.name}. Method definitions: {ANALYSIS_DEFS.risk.short}. Weights are user-configurable and stored with each analysis job.
            </p>
          </>
        ) : (
          <div className="flex justify-center p-6">
            <Spinner label="Computing the first risk index" />
          </div>
        )}
      </aside>
    </div>
  );
}


