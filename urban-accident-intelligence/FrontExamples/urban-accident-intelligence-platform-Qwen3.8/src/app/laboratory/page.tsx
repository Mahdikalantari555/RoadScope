"use client";

/**
 * Epic 4 — Spatial Analysis Laboratory.
 * Full parameter control, asynchronous execution with progress, methodological
 * transparency (formula + assumptions), ground-truth scoring and open-standard
 * export for every run.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { AssumptionList, Badge, FormulaBlock, Panel, ProgressBar, Select, Slider, Tabs, Toggle } from "@/components/ui";
import { BarList, DataTable, RampLegend, ScatterPlot, CategoricalLegend, fmtCompact } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, fmt, fmtDuration, type GeoCollection } from "@/lib/clientApi";
import { useAnalysisJob } from "@/lib/useJob";
import { lixelChoroplethLayer, networkLayer } from "@/lib/ui";
import { colorFor } from "@/lib/util/colors";

type Tab = "nkde" | "getis" | "dbscan" | "aggregate" | "covariate" | "benchmark";

const METHOD_FOR_TAB: Record<Tab, string> = {
  nkde: "nkde",
  getis: "network_getis_ord",
  dbscan: "n_dbscan",
  aggregate: "lixel_aggregation",
  covariate: "covariate_cross_comparison",
  benchmark: "ground_truth_benchmark",
};

export default function LaboratoryPage() {
  const { dataset, datasetId, role } = useApp();
  const [tab, setTab] = useState<Tab>("nkde");
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [p, setP] = useState({
    bandwidthM: 320,
    kernel: "quartic",
    edgeCorrection: true,
    splitting: true,
    comparePlanar: true,
    weightBy: "count" as "count" | "epdo" | "credibility" | "severity",
    weightMode: "distance_decay" as "distance_decay" | "contiguity",
    contiguityK: 2,
    permutations: 999,
    alpha: 0.05,
    epsilonM: 220,
    minPoints: 4,
    level: "lixel" as "lixel" | "segment",
    timeBin: "week" as "hour" | "day" | "week" | "month",
    includeUnverified: true,
    includeGroundTruth: false,
  });
  const job = useAnalysisJob(datasetId, role);
  const [ramp, setRamp] = useState("inferno");
  const [valueKey, setValueKey] = useState("value");

  useEffect(() => {
    if (!datasetId) return;
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=0`, role)
      .then((r) => setNetwork(r.geojson))
      .catch(() => undefined);
  }, [datasetId, role]);

  const run = useCallback(() => {
    const method = METHOD_FOR_TAB[tab];
    const params: Record<string, unknown> = {
      weightBy: p.weightBy,
      includeUnverified: p.includeUnverified,
      includeGroundTruth: p.includeGroundTruth,
    };
    if (tab === "nkde") Object.assign(params, { bandwidthM: p.bandwidthM, kernel: p.kernel, edgeCorrection: p.edgeCorrection, splitting: p.splitting, comparePlanar: p.comparePlanar });
    if (tab === "getis") Object.assign(params, { bandwidthM: p.bandwidthM, weightMode: p.weightMode, contiguityK: p.contiguityK, permutations: p.permutations, alpha: p.alpha, level: p.level });
    if (tab === "dbscan") Object.assign(params, { epsilonM: p.epsilonM, minPoints: p.minPoints });
    if (tab === "aggregate") Object.assign(params, { level: p.level, timeBin: p.timeBin });
    if (tab === "benchmark") Object.assign(params, { bandwidthM: p.bandwidthM, kernel: p.kernel });
    void job.run(method, params);
  }, [tab, p, job]);

  const result = job.result;
  const features = (result?.features as GeoCollection | undefined) ?? null;

  const overlay = useMemo<MapLayerSpec | null>(() => {
    if (!features) return null;
    if (tab === "getis") {
      const colors: Record<string, string> = { hotspot_p01: "#d81b60", hotspot_p05: "#fb8c00", coldspot_p05: "#42a5f5", coldspot_p01: "#1565c0", not_significant: "#414f63" };
      return {
        id: "getis",
        data: features,
        visible: true,
        zIndex: 6,
        stroke: (props) => colors[props.significanceClass] ?? "#414f63",
        width: (props) => (props.significanceClass === "not_significant" ? 1.3 : 3.4),
        pickable: true,
      };
    }
    if (tab === "dbscan") {
      return {
        id: "dbscan",
        data: features,
        visible: true,
        zIndex: 7,
        stroke: (props) => (props.kind === "cluster_hull" ? colorFor("plasma", 0.85) : props.kind === "cluster_subgraph" ? "#7bd88f" : props.kind === "noise" ? "#6b7a90" : "#8fa3bd"),
        fill: (props) => (props.kind === "cluster_hull" ? "rgba(216,27,96,0.13)" : props.kind === "cluster_member" ? severityDot(props.severityCode) : null),
        radius: (props) => (props.kind === "noise" ? 2 : 3),
        width: (props) => (props.kind === "cluster_subgraph" ? 1.6 : 1.1),
        pickable: true,
      };
    }
    if (tab === "aggregate") {
      return lixelChoroplethLayer(features, { valueKey: p.level === "segment" ? "densityPerKm" : "densityPerKm", ramp, width: 3, id: "agg", label: "Density per km" });
    }
    if (tab === "benchmark") {
      return lixelChoroplethLayer(features, { valueKey: valueKey === "residual" ? "residual" : valueKey, ramp: valueKey === "residual" ? "rdbu" : ramp, width: 3, id: "bench", label: valueKey });
    }
    return lixelChoroplethLayer(features, { valueKey: p.comparePlanar && valueKey === "planarPerM2" ? "planarPerM2" : valueKey === "difference" ? "difference" : "value", ramp: valueKey === "difference" ? "rdbu" : ramp, width: 3, id: "nkde", label: "NKDE" });
  }, [features, tab, ramp, valueKey, p.level, p.comparePlanar]);

  const layers = useMemo<MapLayerSpec[]>(() => [networkLayer(network, "class", overlay ? 0.4 : 0.8), ...(overlay ? [overlay] : [])], [network, overlay]);

  const stats = (result?.stats ?? {}) as any;
  const benchmarkLayers = (stats?.layers ?? []) as any[];

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
      {/* ---------------- parameters ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto">
        <Panel title="Method" subtitle="Network-constrained geocomputation">
          <div className="p-2">
            <Tabs
              active={tab}
              onChange={(t) => setTab(t)}
              tabs={[
                { value: "nkde", label: "NKDE" },
                { value: "getis", label: "Gi*" },
                { value: "dbscan", label: "N-DBSCAN" },
                { value: "aggregate", label: "Aggr." },
                { value: "covariate", label: "Covar." },
                { value: "benchmark", label: "Bench" },
              ]}
            />
            <div className="mt-2 space-y-2">
              {(tab === "nkde" || tab === "getis" || tab === "benchmark") && (
                <Slider label="Network bandwidth h_net" value={p.bandwidthM} min={60} max={1200} step={10} unit="m" onChange={(v) => setP({ ...p, bandwidthM: v })} />
              )}
              {tab === "nkde" && (
                <>
                  <Select label="Kernel function" value={p.kernel} onChange={(v) => setP({ ...p, kernel: v })} options={[
                    { value: "quartic", label: "Quartic (biweight)" },
                    { value: "epanechnikov", label: "Epanechnikov" },
                    { value: "gaussian", label: "Gaussian (3h truncation)" },
                    { value: "triangular", label: "Triangular" },
                    { value: "uniform", label: "Uniform" },
                  ]} />
                  <Toggle label="Okabe equal-splitting at vertices" checked={p.splitting} onChange={(v) => setP({ ...p, splitting: v })} hint="Discontinuous NKDE: kernel mass is divided by (deg−1) when crossing an intersection." />
                  <Toggle label="Boundary (edge) correction c(u)" checked={p.edgeCorrection} onChange={(v) => setP({ ...p, edgeCorrection: v })} />
                  <Toggle label="Planar KDE comparison mode" checked={p.comparePlanar} onChange={(v) => setP({ ...p, comparePlanar: v })} hint="Computes the Euclidean reference surface and the signed difference map." />
                </>
              )}
              {tab === "getis" && (
                <>
                  <Select label="Spatial weights W_net" value={p.weightMode} onChange={(v) => setP({ ...p, weightMode: v })} options={[
                    { value: "distance_decay", label: "Shortest-path decay exp(−d_N/h)" },
                    { value: "contiguity", label: "k-order edge contiguity" },
                  ]} />
                  {p.weightMode === "contiguity" ? (
                    <Slider label="Contiguity order k" value={p.contiguityK} min={1} max={6} step={1} onChange={(v) => setP({ ...p, contiguityK: v })} />
                  ) : (
                    <div className="text-[10px]" style={{ color: "var(--text-mute)" }}>h_net also controls the weights matrix bandwidth.</div>
                  )}
                  <Slider label="Permutations" value={p.permutations} min={99} max={1999} step={100} onChange={(v) => setP({ ...p, permutations: v })} />
                  <Select label="Significance level α (BH-FDR)" value={String(p.alpha)} onChange={(v) => setP({ ...p, alpha: Number(v) })} options={[{ value: "0.01", label: "0.01" }, { value: "0.05", label: "0.05" }, { value: "0.1", label: "0.10" }]} />
                  <Select label="Aggregation level" value={p.level} onChange={(v) => setP({ ...p, level: v })} options={[{ value: "lixel", label: "Lixel" }, { value: "segment", label: "Parent segment" }]} />
                </>
              )}
              {tab === "dbscan" && (
                <>
                  <Slider label="ε (network distance)" value={p.epsilonM} min={50} max={1200} step={10} unit="m" onChange={(v) => setP({ ...p, epsilonM: v })} />
                  <Slider label="MinPts" value={p.minPoints} min={2} max={30} step={1} onChange={(v) => setP({ ...p, minPoints: v })} />
                </>
              )}
              {tab === "aggregate" && (
                <>
                  <Select label="Aggregation level" value={p.level} onChange={(v) => setP({ ...p, level: v })} options={[{ value: "lixel", label: "Lixel" }, { value: "segment", label: "Parent segment" }]} />
                  <Select label="Temporal bin" value={p.timeBin} onChange={(v) => setP({ ...p, timeBin: v })} options={[{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
                </>
              )}
              <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <Select label="Weighting scheme" value={p.weightBy} onChange={(v) => setP({ ...p, weightBy: v })} options={[
                  { value: "count", label: "Unit weight (frequency)" },
                  { value: "epdo", label: "EPDO severity weights" },
                  { value: "credibility", label: "VGI credibility score" },
                  { value: "severity", label: "Severity rank / 3" },
                ]} />
                <div className="mt-1.5">
                  <Toggle label="Include unverified VGI" checked={p.includeUnverified} onChange={(v) => setP({ ...p, includeUnverified: v })} />
                  <Toggle label="Include oracle ground truth" checked={p.includeGroundTruth} onChange={(v) => setP({ ...p, includeGroundTruth: v })} hint="Synthetic datasets only. Mixing oracle and observed data invalidates VGI evaluation." />
                </div>
              </div>
              <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <Select label="Colour ramp (colourblind-safe)" value={ramp} onChange={setRamp} options={["inferno", "viridis", "magma", "plasma", "cividis", "ylorrd", "spectral", "rdbu", "purples"].map((r) => ({ value: r, label: r }))} />
                {tab === "benchmark" && (
                  <div className="mt-1.5">
                    <Select label="Benchmark facet" value={valueKey} onChange={setValueKey} options={[
                      { value: "trueLambda", label: "Oracle Λ(s)" },
                      { value: "realized", label: "Oracle realised counts" },
                      { value: "nkde", label: "NKDE estimate" },
                      { value: "planar", label: "Planar KDE estimate" },
                      { value: "eb", label: "Empirical Bayes estimate" },
                      { value: "raw", label: "Raw lixel counts" },
                      { value: "residual", label: "NKDE − oracle residual" },
                    ]} />
                  </div>
                )}
                {tab === "nkde" && (
                  <div className="mt-1.5">
                    <Select label="Surface facet" value={valueKey} onChange={setValueKey} options={[
                      { value: "value", label: "NKDE (crashes · km⁻¹)" },
                      { value: "planarPerM2", label: "Planar KDE (crashes · m⁻²)" },
                      { value: "difference", label: "Planar − Network (standardised)" },
                    ]} />
                  </div>
                )}
              </div>
              <button type="button" className="btn btn-primary w-full" onClick={run} disabled={job.busy || !datasetId}>
                {job.busy ? `Running ${job.job?.stage ?? ""}…` : `Execute ${METHOD_FOR_TAB[tab]}`}
              </button>
              {job.error && <div className="mono text-[10px]" style={{ color: "var(--danger)" }}>{job.error}</div>}
            </div>
          </div>
        </Panel>

        <Panel title="Execution" subtitle="Asynchronous job with content-hash caching">
          <div className="space-y-2 p-2">
            {job.job && <ProgressBar value={job.job.progress} stage={job.job.stage} />}
            <div className="mono grid grid-cols-2 gap-x-2 text-[10px]">
              <span style={{ color: "var(--text-mute)" }}>job</span><span className="text-right">{job.job?.id?.slice(0, 8) ?? "—"}</span>
              <span style={{ color: "var(--text-mute)" }}>status</span><span className="text-right" style={{ color: job.job?.status === "succeeded" ? "var(--accent-2)" : job.job?.status === "failed" ? "var(--danger)" : "var(--warn)" }}>{job.job?.status ?? "idle"}</span>
              <span style={{ color: "var(--text-mute)" }}>runtime</span><span className="text-right">{fmtDuration(job.job?.durationMs ?? result?.runtimeMs)}</span>
              <span style={{ color: "var(--text-mute)" }}>units</span><span className="text-right">{fmt(result?.unitCount)}</span>
              <span style={{ color: "var(--text-mute)" }}>sample n</span><span className="text-right">{fmt(result?.sampleSize)}</span>
              <span style={{ color: "var(--text-mute)" }}>CRS</span><span className="text-right">EPSG:{result?.srid ?? dataset?.srid}</span>
              <span style={{ color: "var(--text-mute)" }}>result</span><span className="text-right">{result?.id?.slice(0, 8) ?? "—"}</span>
            </div>
            {result && (
              <div className="flex flex-wrap gap-1 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                {["geojson", "csv", "wkt", "json"].map((f) => (
                  <a key={f} className="btn" href={`/api/analysis/results/${result.id}/export?format=${f}`} download>
                    {f === "json" ? "manifest" : f}
                  </a>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Job ledger" subtitle="Provenance of every run" bodyClass="p-0">
          <div className="scroll-thin max-h-[200px] overflow-auto">
            <table className="data">
              <thead><tr><th>method</th><th>state</th><th className="text-right">ms</th></tr></thead>
              <tbody>
                {job.history.map((h) => (
                  <tr key={h.id}>
                    <td className="mono" style={{ color: "var(--text)" }}>{h.method}</td>
                    <td className="mono">{h.status}</td>
                    <td className="mono text-right">{fmtDuration(h.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* ---------------- map ---------------- */}
      <Panel
        title="Result surface"
        subtitle={result ? `${result.method} · ${fmt(features?.features.length ?? 0)} features · CRS84 serialisation` : "Configure parameters and execute a method"}
        right={result && <Badge tone="good">CACHED BY PARAMETER HASH</Badge>}
        className="min-h-0"
        bodyClass="relative min-h-0"
      >
        <MapCanvas
          layers={layers}
          origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
          fitKey={`${datasetId ?? ""}|${tab}|${result?.id ?? ""}`}
          className="h-full min-h-[420px] w-full"
          legend={
            <div className="flex flex-wrap items-end gap-2">
              {tab === "getis" && result && (
                <CategoricalLegend items={[
                  { label: "Hotspot p<0.01", color: "#d81b60", count: 0 },
                  { label: "Hotspot p<0.05", color: "#fb8c00", count: stats?.hotspots ?? 0 },
                  { label: "Not significant", color: "#414f63", count: (stats?.n ?? 0) - (stats?.hotspots ?? 0) - (stats?.coldspots ?? 0) },
                  { label: "Coldspot p<0.05", color: "#42a5f5", count: stats?.coldspots ?? 0 },
                ]} />
              )}
              {(tab === "nkde" || tab === "aggregate" || tab === "benchmark") && result && (
                <RampLegend ramp={valueKey === "difference" || valueKey === "residual" ? "rdbu" : ramp} min={minOf(features, valueKey)} max={maxOf(features, valueKey)} unit={valueKey} />
              )}
            </div>
          }
        />
      </Panel>

      {/* ---------------- results ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto">
        {result?.formulation && (
          <Panel title="Methodological transparency" subtitle="Model, assumptions and execution metadata">
            <div className="space-y-3 p-2.5">
              <FormulaBlock title={result.formulation.title} latex={result.formulation.latex} notes={result.formulation.notes} />
              {Array.isArray(stats?.assumptions) && (
                <div>
                  <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Assumption checks (executed before inference)</div>
                  <AssumptionList items={stats.assumptions} />
                </div>
              )}
            </div>
          </Panel>
        )}

        {result && (
          <Panel title="Statistics" subtitle={`${result.method} · runtime ${fmt(result.runtimeMs)} ms`}>
            <div className="scroll-thin max-h-[320px] overflow-auto p-2 text-[10.5px]">
              <KeyValueTree data={stats} depth={0} />
            </div>
          </Panel>
        )}

        {tab === "nkde" && stats?.comparison && (
          <Panel title="Planar distortion diagnostics" subtitle="Network vs. Euclidean KDE">
            <div className="space-y-2 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Pearson r (net, planar)" value={fmt(stats.comparison.pearson, 4)} />
                <Metric label="Spearman ρ" value={fmt(stats.comparison.spearman, 4)} />
                <Metric label="RMSE (standardised)" value={fmt(stats.comparison.rmseStandardized, 4)} />
                <Metric label="Mean signed Δ" value={fmt(stats.comparison.meanSignedDifference, 4)} />
                <Metric label="Intersection overestimation" value={`${fmt(stats.comparison.intersectionOverestimationPct, 1)} %`} tone="bad" />
                <Metric label="Corridor overestimation" value={`${fmt(stats.comparison.corridorOverestimationPct, 1)} %`} />
                <Metric label="Lixels overestimated" value={fmt(stats.comparison.overestimatedLixels)} />
                <Metric label="Lixels underestimated" value={fmt(stats.comparison.underestimatedLixels)} />
              </div>
              <p className="text-[10.5px] leading-snug" style={{ color: "var(--text-mute)" }}>
                Planar KDE assigns density to Euclidean discs that cross carriageways, verges and grade separations. The intersection
                overestimation figure quantifies exactly that topological bias: within 30 m of a node, the Euclidean surface exceeds the
                network surface by the reported percentage.
              </p>
            </div>
          </Panel>
        )}

        {tab === "getis" && result && (
          <Panel title="Significant clusters" subtitle="FDR-corrected local statistics">
            <div className="space-y-2 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Global Moran's I" value={fmt(stats.globalMoranI, 5)} />
                <Metric label="E[I]" value={fmt(stats.expectedI, 5)} />
                <Metric label="Moran Z" value={fmt(stats.globalMoranZ, 3)} />
                <Metric label="Permutation p" value={fmt(stats.globalMoranP, 4)} />
                <Metric label="Hotspots (FDR)" value={fmt(stats.hotspots)} tone="bad" />
                <Metric label="Coldspots (FDR)" value={fmt(stats.coldspots)} tone="good" />
                <Metric label="Mean |N(i)|" value={fmt(stats.meanNeighbours, 2)} />
                <Metric label="Candidates tested" value={fmt(stats.candidateCount)} />
              </div>
              <ScatterPlot
                points={(features?.features ?? []).slice(0, 1200).map((f) => ({ x: f.properties.crashCount as number, y: f.properties.giStarZ as number, c: f.properties.giStarZ as number, label: `${f.properties.unitId}: N=${f.properties.crashCount}, Z=${f.properties.giStarZ}` }))}
                xLabel="N"
                yLabel="Gi* Z"
                ramp="rdbu"
                colorBy={{ min: -3, max: 3 }}
                diagonal={false}
                size={120}
              />
            </div>
          </Panel>
        )}

        {tab === "dbscan" && stats?.clusters && (
          <Panel title="Micro-scale clusters" subtitle={`${stats.clusterCount} clusters · ${fmt(stats.noiseCount)} noise points`}>
            <div className="p-2">
              <DataTable
                rows={stats.clusters}
                rowKey={(r) => String(r.clusterId)}
                maxHeight={240}
                columns={[
                  { key: "clusterId", label: "#" },
                  { key: "size", label: "n", align: "right" },
                  { key: "weight", label: "w", align: "right", format: (v) => fmt(v, 2) },
                  { key: "dominantSeverity", label: "severity" },
                  { key: "networkSpanM", label: "net span", align: "right", format: (v) => `${fmt(v, 0)} m` },
                  { key: "planarSpanM", label: "eucl span", align: "right", format: (v) => `${fmt(v, 0)} m` },
                  { key: "spanRatio", label: "ratio", align: "right", format: (v) => fmt(v, 2), tone: (v) => (v > 1.4 ? "var(--warn)" : undefined) },
                  { key: "segments", label: "edges", align: "right" },
                ]}
              />
              <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--text-mute)" }}>
                spanRatio ≫ 1 marks clusters that Euclidean DBSCAN would collapse into one blob but which are network-elongated (e.g. two
                carriageways of an arterial separated by a median). Noise points are reported separately rather than absorbed into clusters.
              </p>
            </div>
          </Panel>
        )}

        {tab === "aggregate" && stats && (
          <Panel title="Aggregation output" subtitle={`${stats.unitCount} units · bin=${stats.timeBin}`}>
            <div className="space-y-2 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Units" value={fmt(stats.unitCount)} />
                <Metric label="Incidents used" value={fmt(stats.incidentsUsed)} />
                <Metric label="Total EPDO" value={fmt(stats.totalEpdo, 2)} />
                <Metric label="Zero-count share" value={`${fmt((stats.zeroShare ?? 0) * 100, 1)} %`} />
              </div>
              <BarList
                title="Severity mix"
                items={Object.entries(stats.severityMix ?? {}).map(([k, v]) => ({ key: k, label: k.replace(/_/g, " "), value: v as number }))}
                ramp="plasma"
                valueFormat={(v) => fmt(v, 1)}
              />
            </div>
          </Panel>
        )}

        {tab === "covariate" && stats?.correlations && (
          <Panel title="Covariate cross-comparison" subtitle="Association with linear crash density over uniform lixels">
            <div className="p-2">
              <DataTable
                rows={stats.correlations}
                rowKey={(r) => r.covariate}
                maxHeight={300}
                columns={[
                  { key: "covariate", label: "Covariate" },
                  { key: "pearson", label: "Pearson r", align: "right", format: (v) => fmt(v, 4), tone: (v) => (Math.abs(v) > 0.3 ? "var(--accent)" : undefined) },
                  { key: "spearman", label: "Spearman ρ", align: "right", format: (v) => fmt(v, 4) },
                  { key: "mean", label: "mean", align: "right", format: (v) => fmt(v, 3) },
                ]}
              />
              {stats.binned?.distToNodeM && (
                <div className="mt-2">
                  <BarList title="Density by distance-to-intersection quintile" items={stats.binned.distToNodeM.map((b: any) => ({ key: b.bin, label: `${b.bin} m`, value: b.meanDensity, sub: `n=${b.n}` }))} ramp="ylorrd" valueFormat={(v) => fmt(v, 2)} />
                </div>
              )}
              <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--text-mute)" }}>{stats.note}</p>
            </div>
          </Panel>
        )}

        {tab === "benchmark" && (
          <>
            <Panel title="Ground-truth evaluation" subtitle="PAI · RRI · RMSE against the oracle λ(s,t)">
              <div className="p-2">
                <DataTable
                  rows={benchmarkLayers}
                  rowKey={(r) => r.label}
                  maxHeight={220}
                  columns={[
                    { key: "label", label: "Estimator" },
                    { key: "pai5", label: "PAI(5%)", align: "right", format: (v) => fmt(v, 3), tone: (v) => (v > 4 ? "var(--accent-2)" : undefined) },
                    { key: "pai10", label: "PAI(10%)", align: "right", format: (v) => fmt(v, 3) },
                    { key: "rri10", label: "RRI(10%)", align: "right", format: (v) => fmt(v, 3) },
                    { key: "rmseVsLambda", label: "RMSE", align: "right", format: (v) => fmt(v, 5), tone: (v) => (v < 0.05 ? "var(--accent-2)" : undefined) },
                    { key: "spearmanVsLambda", label: "ρ", align: "right", format: (v) => fmt(v, 4) },
                    { key: "r2", label: "R²", align: "right", format: (v) => fmt(v, 4) },
                  ]}
                />
              </div>
            </Panel>
            {stats?.bandwidthSweep && (
              <Panel title="Bandwidth sensitivity" subtitle="PAI/RRI/RMSE as a function of h_net">
                <div className="p-2">
                  <DataTable
                    rows={stats.bandwidthSweep}
                    rowKey={(r) => String(r.bandwidthM)}
                    maxHeight={180}
                    columns={[
                      { key: "bandwidthM", label: "h (m)", align: "right" },
                      { key: "pai10", label: "PAI(10%)", align: "right", format: (v) => fmt(v, 3) },
                      { key: "rri10", label: "RRI(10%)", align: "right", format: (v) => fmt(v, 3) },
                      { key: "rmseVsLambda", label: "RMSE", align: "right", format: (v) => fmt(v, 5) },
                      { key: "spearman", label: "ρ", align: "right", format: (v) => fmt(v, 4) },
                      { key: "runtimeMs", label: "ms", align: "right" },
                    ]}
                  />
                </div>
              </Panel>
            )}
            {benchmarkLayers[0]?.curve && (
              <Panel title="Capture-rate curve" subtitle="RRI as the ranked-unit share grows">
                <div className="p-2">
                  <BarList
                    items={benchmarkLayers[0].curve.map((c: any) => ({ key: String(c.percentUnits), label: `top ${c.percentUnits}% (${c.units} lixels)`, value: c.rri * 100, sub: `PAI ${fmt(c.pai, 2)}` }))}
                    ramp="viridis"
                    valueFormat={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              </Panel>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function severityDot(code: string): string | null {
  const map: Record<string, string> = { fatal: "#d81b60", serious_injury: "#fb8c00", minor_injury: "#fdd835", property_damage: "#42a5f5", near_miss: "#78909c" };
  return map[code] ?? null;
}

function maxOf(data: GeoCollection | null, key: string): number {
  if (!data) return 1;
  let max = -Infinity;
  for (const f of data.features) {
    const v = Number(f.properties?.[key] ?? 0);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return Number.isFinite(max) && max !== 0 ? max : 1;
}

function minOf(data: GeoCollection | null, key: string): number {
  if (!data) return 0;
  let min = Infinity;
  for (const f of data.features) {
    const v = Number(f.properties?.[key] ?? 0);
    if (Number.isFinite(v) && v < min) min = v;
  }
  return Number.isFinite(min) ? min : 0;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--border)" }}>
      <div className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>{label}</div>
      <div className="mono text-[12.5px]" style={{ color: tone === "good" ? "var(--accent-2)" : tone === "bad" ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function KeyValueTree({ data, depth }: { data: any; depth: number }) {
  if (data === null || data === undefined) return <span style={{ color: "var(--text-mute)" }}>—</span>;
  if (typeof data !== "object") {
    return <span className="mono" style={{ color: "var(--text)" }}>{typeof data === "number" ? fmtCompact(data) : String(data).slice(0, 90)}</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: "var(--text-mute)" }}>[]</span>;
    if (typeof data[0] !== "object") return <span className="mono" style={{ color: "var(--text-dim)" }}>[{data.slice(0, 14).map((v) => (typeof v === "number" ? fmtCompact(v) : String(v))).join(", ")}{data.length > 14 ? ", …" : ""}]</span>;
    return <span style={{ color: "var(--text-mute)" }}>array[{data.length}]</span>;
  }
  return (
    <div className={depth === 0 ? "space-y-1" : "ml-2 space-y-0.5 border-l pl-2"} style={depth === 0 ? undefined : { borderColor: "var(--border)" }}>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-2">
          <span className="mono shrink-0 text-[10px]" style={{ color: "var(--text-mute)" }}>{k}</span>
          <div className="min-w-0 text-right">
            <KeyValueTree data={v} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}

