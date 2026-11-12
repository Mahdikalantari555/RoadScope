"use client";

/**
 * Epic 1 — Stochastic network ground-truth simulation and benchmarking.
 * Configures the seeded inhomogeneous network point process, compares lixel
 * resolutions (MAUP), discloses the full generator parameter block and scores
 * every estimator against the oracle λ(s,t).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Field, FormulaBlock, Kpi, Panel, Select, Slider, Toggle } from "@/components/ui";
import { BarList, DataTable, RampLegend, ScatterPlot } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, apiPost, fmt, fmtDuration, type GeoCollection } from "@/lib/clientApi";
import { useAnalysisJob } from "@/lib/useJob";
import { lixelChoroplethLayer, networkLayer } from "@/lib/ui";
import { SCENARIO_LABELS } from "@/lib/sim/intensity";

export default function SimulationPage() {
  const { dataset, datasetId, datasets, role, refreshDatasets, setDatasetId } = useApp();
  const [scenario, setScenario] = useState("multi_covariate_complex_urban");
  const [seed, setSeed] = useState(20260117);
  const [lixel, setLixel] = useState(25);
  const [studyDays, setStudyDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [truth, setTruth] = useState<GeoCollection | null>(null);
  const [showTruth, setShowTruth] = useState(true);
  const [facet, setFacet] = useState("trueLambda");
  const [ramp, setRamp] = useState("inferno");
  const job = useAnalysisJob(datasetId, role);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    Promise.all([
      apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=1&lixels=0`, role).catch(() => null),
      apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/incidents?groundTruth=1&limit=8000`, role).catch(() => null),
    ]).then(([n, t]) => {
      if (!alive) return;
      setNetwork(n?.geojson ?? null);
      setTruth(t?.geojson ?? null);
    });
    return () => {
      alive = false;
    };
  }, [datasetId, role]);

  const generate = useCallback(async () => {
    setBusy(true);
    setMessage("Running generator: topology → lixelisation → Λ(s) → Poisson realisation → VGI noise → map-matching → conflation…");
    try {
      const res = await apiPost<{ dataset: any; durationMs: number; reused: boolean }>("/api/datasets", { scenario, seed, lixelLengthM: lixel, studyDays }, role);
      setMessage(`${res.reused ? "Reused existing" : "Generated"} dataset in ${fmtDuration(res.durationMs)}.`);
      await refreshDatasets();
      setDatasetId(res.dataset.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [scenario, seed, lixel, studyDays, role, refreshDatasets, setDatasetId]);

  const runBenchmark = useCallback(() => {
    void job.run("ground_truth_benchmark", { bandwidthM: 320, kernel: "quartic", topPercent: [1, 2, 5, 10, 20, 30, 50] });
  }, [job]);

  const benchmarkLayer = useMemo<MapLayerSpec | null>(() => {
    const data = job.result?.features as GeoCollection | undefined;
    if (!data) return null;
    return lixelChoroplethLayer(data, { valueKey: facet, ramp: facet === "residual" ? "rdbu" : ramp, width: 3, id: "bench", label: facet });
  }, [job.result, facet, ramp]);

  const layers = useMemo<MapLayerSpec[]>(() => {
    const out: MapLayerSpec[] = [networkLayer(network, "class", benchmarkLayer ? 0.35 : 0.7)];
    if (benchmarkLayer) out.push(benchmarkLayer);
    if (showTruth && truth)
      out.push({
        id: "oracle",
        data: truth,
        visible: true,
        zIndex: 16,
        opacity: 0.85,
        stroke: (p) => (p.severityRank >= 4 ? "#ffffff" : "rgba(255,255,255,0.72)"),
        fill: (p) => (p.severityRank >= 4 ? "#ffffff" : "rgba(230,240,255,0.65)"),
        radius: (p) => (p.severityRank >= 4 ? 2.6 : 1.5),
        width: () => 0.4,
        pickable: true,
      });
    return out;
  }, [network, benchmarkLayer, showTruth, truth]);

  const sim = (dataset as any)?.simParams ?? null;
  const proc = sim?.process ?? null;
  const ns = dataset?.networkStats;
  const rc = dataset?.recordCounts;
  const benchLayers = ((job.result?.stats as any)?.layers ?? []) as any[];

  return (
    <div className="scroll-thin h-full overflow-auto p-2">
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Panel title="Point-process generator" subtitle="Seeded inhomogeneous Cox/Poisson process on a linear network" right={busy && <Badge tone="warn">RUNNING</Badge>}>
            <div className="space-y-2 p-2">
              <Select label="Scenario λ(s,t)" value={scenario} onChange={setScenario} options={Object.entries(SCENARIO_LABELS).map(([value, label]) => ({ value, label }))} />
              <Field label="Seed (reproducibility contract)">
                <input type="number" className="mono w-full" value={seed} min={1} max={2147483647} onChange={(e) => setSeed(Number(e.target.value))} />
              </Field>
              <Select label="Lixel resolution (LRS unit)" value={String(lixel)} onChange={(v) => setLixel(Number(v))} options={[
                { value: "10", label: "10 m — fine (large n, high variance)" },
                { value: "25", label: "25 m — default" },
                { value: "50", label: "50 m — coarse" },
                { value: "100", label: "100 m — very coarse (MAUP stress test)" },
              ]} hint="Uniform lixels remove segment-length MAUP bias; changing the resolution changes the variance, not the expectation, of every rate." />
              <Slider label="Study window" value={studyDays} min={30} max={1095} step={30} unit="days" onChange={setStudyDays} />
              <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => void generate()}>
                {busy ? "Generating…" : "Generate dataset"}
              </button>
              {message && <div className="mono rounded-[3px] border p-2 text-[10.5px]" style={{ borderColor: "var(--border)", color: "var(--accent)" }}>{message}</div>}
              <div className="rounded-[3px] border p-2 text-[10px] leading-snug" style={{ borderColor: "var(--warn)", color: "var(--text-dim)" }}>
                <Badge tone="warn">SYNTHETIC</Badge> All datasets produced here are labelled synthetic throughout the UI and API. Oracle λ and
                injected drift are available for benchmarking but must never be mixed with empirical observations.
              </div>
            </div>
          </Panel>

          <Panel title="Dataset registry" subtitle="Every realisation with its provenance" bodyClass="p-0">
            <DataTable
              rows={datasets}
              rowKey={(r) => r.id}
              selectedKey={datasetId}
              onRowClick={(r) => setDatasetId(r.id)}
              maxHeight={230}
              columns={[
                { key: "scenario", label: "scenario", format: (v) => String(v).replace(/_/g, " ") },
                { key: "seed", label: "seed", align: "right" },
                { key: "lixelLengthM", label: "lixel", align: "right", format: (v) => `${v} m` },
                { key: "networkStats", label: "km", align: "right", format: (v) => fmt(v?.totalLengthKm, 1) },
                { key: "networkStats", label: "lixels", align: "right", format: (v) => fmt(v?.lixelCount) },
                { key: "recordCounts", label: "λ draws", align: "right", format: (v) => fmt(v?.groundTruthAccidents) },
                { key: "recordCounts", label: "VGI", align: "right", format: (v) => fmt(v?.vgiReports) },
                { key: "kind", label: "kind", tone: (v) => (v === "synthetic" ? "var(--warn)" : "var(--accent-2)") },
              ]}
            />
          </Panel>

          {proc && (
            <Panel title="Generator parameter block" subtitle="Persisted with the dataset — λ is recomputable exactly">
              <div className="scroll-thin max-h-[300px] overflow-auto p-2 text-[10px]">
                <div className="mono grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {Object.entries(proc)
                    .filter(([k, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
                    .map(([k, v]) => (
                      <Fragment key={k}>
                        <span style={{ color: "var(--text-mute)" }}>{k}</span>
                        <span className="text-right" style={{ color: "var(--text)" }}>{typeof v === "number" ? fmt(v as number, 4) : String(v)}</span>
                      </Fragment>
                    ))}
                </div>
                <div className="mt-2 border-t pt-1.5" style={{ borderColor: "var(--border)" }}>
                  <div className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Latent Cox field bumps (synthetic only)</div>
                  <table className="data mt-1">
                    <thead><tr><th>x (m)</th><th>y (m)</th><th className="text-right">amp</th><th className="text-right">σ (m)</th></tr></thead>
                    <tbody>
                      {(proc.latentBumps ?? []).map((b: any, i: number) => (
                        <tr key={i}><td className="mono">{fmt(b.x, 0)}</td><td className="mono">{fmt(b.y, 0)}</td><td className="mono text-right">{fmt(b.amplitude, 3)}</td><td className="mono text-right">{fmt(b.sigmaM, 0)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mono mt-2 grid grid-cols-2 gap-x-3 border-t pt-1.5 text-[10px]" style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--text-mute)" }}>E[crashes] analytic</span><span className="text-right">{fmt(sim?.expectedTotalCrashes, 2)}</span>
                  <span style={{ color: "var(--text-mute)" }}>realised draws</span><span className="text-right">{fmt(sim?.realisedGroundTruth)}</span>
                  <span style={{ color: "var(--text-mute)" }}>VGI reports</span><span className="text-right">{fmt(sim?.vgiReports)}</span>
                  <span style={{ color: "var(--text-mute)" }}>false alarms</span><span className="text-right">{fmt(sim?.falseAlarms)}</span>
                  <span style={{ color: "var(--text-mute)" }}>conflation clusters</span><span className="text-right">{fmt(sim?.clusters)}</span>
                </div>
              </div>
            </Panel>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <Kpi label="Nodes / edges" value={`${fmt(ns?.nodeCount)} / ${fmt(ns?.segmentCount)}`} />
            <Kpi label="Lixels" value={fmt(ns?.lixelCount)} hint={`${dataset?.lixelLengthM} m LRS units`} />
            <Kpi label="Network length" value={fmt(ns?.totalLengthKm)} unit="km" />
            <Kpi label="Mean degree" value={fmt(ns?.meanNodeDegree)} hint={`β ${fmt(ns?.betaGamma?.beta, 2)} · γ ${fmt(ns?.betaGamma?.gamma, 2)}`} />
            <Kpi label="Oracle draws" value={fmt(rc?.groundTruthAccidents)} tone="warn" />
            <Kpi label="VGI reports" value={fmt(rc?.vgiReports)} hint={`${fmt(rc?.falseAlarms)} false alarms`} />
            <Kpi label="Canonical incidents" value={fmt(rc?.verifiedAccidents)} tone="good" />
          </div>

          <Panel
            title="Ground-truth intensity surface"
            subtitle="Oracle λ(s) per lixel and realised point process; benchmark any estimator against it"
            right={
              <div className="flex items-center gap-2">
                <select value={facet} onChange={(e) => setFacet(e.target.value)}>
                  <option value="trueLambda">Oracle Λ(s)</option>
                  <option value="realized">Realised counts</option>
                  <option value="nkde">NKDE estimate</option>
                  <option value="planar">Planar KDE estimate</option>
                  <option value="eb">EB estimate</option>
                  <option value="raw">Raw lixel counts</option>
                  <option value="residual">NKDE − oracle residual</option>
                </select>
                <select value={ramp} onChange={(e) => setRamp(e.target.value)}>
                  {["inferno", "viridis", "magma", "plasma", "cividis", "ylorrd", "spectral"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Toggle label="Oracle points" checked={showTruth} onChange={setShowTruth} />
                <button type="button" className="btn btn-primary" disabled={job.busy} onClick={runBenchmark}>{job.busy ? `Running ${job.job?.stage ?? ""}…` : "Benchmark estimators"}</button>
              </div>
            }
            className="min-h-[430px]"
            bodyClass="relative"
          >
            <MapCanvas
              layers={layers}
              origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
              fitKey={`${datasetId ?? ""}|${facet}|${job.result?.id ?? ""}`}
              className="h-[430px] w-full"
              legend={
                <div className="flex flex-wrap items-end gap-2">
                  {job.result && <RampLegend ramp={facet === "residual" ? "rdbu" : ramp} min={0} max={maxOf(job.result.features as GeoCollection, facet)} unit={facet} />}
                  <div className="rounded-[3px] border px-2 py-1.5 text-[10px]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text-dim)" }}>
                    <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "rgba(230,240,255,0.85)" }} /> oracle realisation of λ(s,t)</div>
                    <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#ffffff" }} /> fatal / serious oracle draw</div>
                  </div>
                </div>
              }
            />
          </Panel>

          {job.result && (
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <Panel title="Estimator recovery of the oracle" subtitle="PAI · RRI · RMSE · rank correlation" right={job.busy && <Badge tone="warn">COMPUTING</Badge>} bodyClass="p-0">
                <DataTable
                  rows={benchLayers}
                  rowKey={(r) => r.label}
                  maxHeight={210}
                  columns={[
                    { key: "label", label: "Estimator" },
                    { key: "pai5", label: "PAI(5%)", align: "right", format: (v) => fmt(v, 2), tone: (v) => (v > 6 ? "var(--accent-2)" : undefined) },
                    { key: "pai10", label: "PAI(10%)", align: "right", format: (v) => fmt(v, 2) },
                    { key: "rri5", label: "RRI(5%)", align: "right", format: (v) => fmt(v, 3) },
                    { key: "rri10", label: "RRI(10%)", align: "right", format: (v) => fmt(v, 3) },
                    { key: "rmseVsLambda", label: "RMSE", align: "right", format: (v) => fmt(v, 5), tone: (v) => (v < 0.03 ? "var(--accent-2)" : v > 0.2 ? "var(--danger)" : undefined) },
                    { key: "maeVsLambda", label: "MAE", align: "right", format: (v) => fmt(v, 5) },
                    { key: "spearmanVsLambda", label: "ρ", align: "right", format: (v) => fmt(v, 4) },
                    { key: "r2", label: "R²", align: "right", format: (v) => fmt(v, 4) },
                    { key: "biasRatio", label: "Σλ/Σλ̂", align: "right", format: (v) => fmt(v, 4) },
                  ]}
                />
                <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
                  <BarList
                    title={`Capture-rate curve — ${benchLayers[0]?.label ?? "nkde_network"}`}
                    items={(benchLayers[0]?.curve ?? []).map((c: any) => ({ key: String(c.percentUnits), label: `top ${c.percentUnits}% · ${c.units} lixels`, value: c.rri * 100, sub: `PAI ${fmt(c.pai, 2)}` }))}
                    ramp="viridis"
                    valueFormat={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              </Panel>

              <div className="flex flex-col gap-2">
                <Panel title="Bandwidth sensitivity" subtitle="PAI/RRI/RMSE versus h_net" bodyClass="p-0">
                  <DataTable
                    rows={(job.result.stats as any)?.bandwidthSweep ?? []}
                    rowKey={(r) => String(r.bandwidthM)}
                    maxHeight={150}
                    columns={[
                      { key: "bandwidthM", label: "h (m)", align: "right" },
                      { key: "pai10", label: "PAI(10%)", align: "right", format: (v) => fmt(v, 2) },
                      { key: "rri10", label: "RRI(10%)", align: "right", format: (v) => fmt(v, 3) },
                      { key: "rmseVsLambda", label: "RMSE", align: "right", format: (v) => fmt(v, 5) },
                      { key: "spearman", label: "ρ", align: "right", format: (v) => fmt(v, 4) },
                      { key: "runtimeMs", label: "ms", align: "right" },
                    ]}
                  />
                </Panel>
                <Panel title="Oracle vs. estimated intensity" subtitle="Each point is one lixel" bodyClass="p-2">
                  <ScatterPlot
                    points={((job.result.features as GeoCollection)?.features ?? []).slice(0, 1500).map((f) => ({
                      x: Number(f.properties?.trueLambda ?? 0),
                      y: Number(f.properties?.nkde ?? 0),
                      c: Number(f.properties?.realized ?? 0),
                      label: `${f.properties?.lixelId}: λ=${fmt(f.properties?.trueLambda, 4)}, λ̂=${fmt(f.properties?.nkde, 4)}, n=${f.properties?.realized}`,
                    }))}
                    xLabel="oracle Λ"
                    yLabel="NKDE λ̂"
                    ramp="viridis"
                    colorBy={{ min: 0, max: Math.max(1, ...((job.result.features as GeoCollection)?.features ?? []).slice(0, 1500).map((f) => Number(f.properties?.realized ?? 0))) }}
                    size={150}
                  />
                </Panel>
                <Panel title="Model" subtitle="What is being recovered">
                  <div className="p-2.5">
                    <FormulaBlock
                      title="Inhomogeneous network point process"
                      latex="λ(s,t) = Λ(s) · τ(t) · Ξ(s,t),   N(u) ~ Poisson(∫_u λ)"
                      notes={[
                        "Λ(s) = β₀ · f_class · (1 + ω·exp(−d_node/δ)) · (AADT/10⁴)^ε · (v/50)^κ · latent Cox field · environment.",
                        "τ(t) = diurnal(h) · weekly(dow) · seasonal(doy), numerically normalised to mean 1 so the temporal modulation redistributes but never inflates intensity.",
                        "Ξ(s,t) is the non-separable rush-hour × arterial interaction used by the Diurnal Rush-Hour Shock scenario.",
                        "Observation model: detection probability p_report, 2-D Gaussian positional drift, log-normal reporting lag, multi-witness Poisson bursts, false alarms and attribute misclassification.",
                        ` realised draws = ${fmt(sim?.realisedGroundTruth)} vs analytic expectation ${fmt(sim?.expectedTotalCrashes, 2)} (ratio ${fmt((sim?.realisedGroundTruth ?? 0) / Math.max(1e-9, sim?.expectedTotalCrashes ?? 1), 3)}).`,
                      ]}
                    />
                  </div>
                </Panel>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function maxOf(data: GeoCollection | undefined | null, key: string): number {
  if (!data) return 1;
  let max = 0;
  for (const f of data.features) {
    const v = Number(f.properties?.[key] ?? 0);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max || 1;
}
