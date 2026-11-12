"use client";
import { useEffect, useState } from "react";
import { useAppStore, type Scenario, type AnalysisType, type MetricMode } from "@/lib/store";

const SCENARIO_LABELS: Record<Scenario, { label: string; sub: string }> = {
  uniform: { label: "Uniform Baseline", sub: "Homogeneous Poisson null model" },
  intersection_clustered: { label: "Intersection-Clustered", sub: "Hot nodes near junctions" },
  rush_hour: { label: "Diurnal Rush-Hour", sub: "Temporal morning/evening shocks" },
  complex_urban: { label: "Complex Urban", sub: "Multi-covariate inhomogeneous Cox" },
};

const ANALYSIS_LABELS: Record<AnalysisType, { label: string; sub: string }> = {
  nkde: { label: "Network KDE", sub: "Equal-split network kernel density" },
  planar_kde: { label: "Planar KDE", sub: "Euclidean 2D kernel density" },
  compare_kde: { label: "Network vs Planar KDE Δ", sub: "Visualize planar distortion" },
  getis_ord: { label: "Network Getis-Ord Gi*", sub: "Hot/cold spots with FDR correction" },
  ndbscan: { label: "Network DBSCAN", sub: "Shortest-path ε clustering" },
  eb_risk: { label: "EB Smoothed Risk", sub: "Empirical Bayes SPF blending" },
  benchmark: { label: "GT Benchmark", sub: "PAI / RRI / RMSE evaluation" },
};

export default function SidebarPanel() {
  const activeTab = useAppStore(s => s.activeTab);
  const setActiveTab = useAppStore(s => s.setActiveTab);
  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] border-r border-[var(--border)]">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          <div className="text-sm font-bold tracking-wide text-cyan-400">
            URBAN ACCIDENT INTELLIGENCE
          </div>
        </div>
        <div className="text-[10px] text-slate-500 uppercase tracking-widest">
          Network-Constrained Geocomputation Platform
        </div>
      </div>

      <div className="flex flex-wrap px-2 pt-2 gap-0.5 border-b border-[var(--border)]">
        {(["simulation", "analysis", "risk", "stewardship", "benchmark"] as const).map(t => (
          <button
            key={t}
            className={`tab ${activeTab === t ? "active" : ""}`}
            onClick={() => setActiveTab(t)}
            style={{ fontSize: 10, padding: "6px 8px" }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {activeTab === "simulation" && <SimulationPanel />}
        {activeTab === "analysis" && <AnalysisPanel />}
        {activeTab === "risk" && <RiskPanel />}
        {activeTab === "stewardship" && <StewardshipPanel />}
        {activeTab === "benchmark" && <BenchmarkPanel />}
      </div>
    </div>
  );
}

function SimulationPanel() {
  const config = useAppStore(s => s.simConfig);
  const setConfig = useAppStore(s => s.setSimConfig);
  const runSimulation = useAppStore(s => s.runSimulation);
  const isSimulating = useAppStore(s => s.isSimulating);
  const simStats = useAppStore(s => s.simStats);
  const summary = useAppStore(s => s.summary);

  return (
    <>
      <div className="panel">
        <div className="panel-header">Scenario</div>
        <div className="panel-body space-y-2">
          {(Object.keys(SCENARIO_LABELS) as Scenario[]).map(s => (
            <label key={s} className="flex items-start gap-2 cursor-pointer p-1.5 rounded hover:bg-[var(--bg-tertiary)]">
              <input
                type="radio"
                name="scenario"
                checked={config.scenario === s}
                onChange={() => setConfig({ scenario: s })}
                className="mt-0.5 accent-cyan-500"
              />
              <div>
                <div className="text-xs font-semibold">{SCENARIO_LABELS[s].label}</div>
                <div className="text-[10px] text-slate-500">{SCENARIO_LABELS[s].sub}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">Parameters</div>
        <div className="panel-body space-y-3">
          <div>
            <label className="label">Random Seed: {config.seed}</label>
            <input type="range" min={1} max={999} step={1}
              value={config.seed}
              onChange={e => setConfig({ seed: +e.target.value })} />
          </div>
          <div>
            <label className="label">Lixel Resolution: {config.lixelResolutionM} m</label>
            <input type="range" min={10} max={100} step={5}
              value={config.lixelResolutionM}
              onChange={e => setConfig({ lixelResolutionM: +e.target.value })} />
            <div className="text-[10px] text-slate-500 mt-0.5">
              Controls MAUP: uniform linear analysis units.
            </div>
          </div>
          <div>
            <label className="label">Annual Expected Crashes: {config.expectedCrashesPerYear}</label>
            <input type="range" min={200} max={2000} step={50}
              value={config.expectedCrashesPerYear}
              onChange={e => setConfig({ expectedCrashesPerYear: +e.target.value })} />
          </div>
          <div>
            <label className="label">VGI Positional Noise σ: {config.vgiPositionalNoiseSigmaM} m</label>
            <input type="range" min={0} max={60} step={2}
              value={config.vgiPositionalNoiseSigmaM}
              onChange={e => setConfig({ vgiPositionalNoiseSigmaM: +e.target.value })} />
          </div>
          <div>
            <label className="label">Multi-Witness Duplicate Rate: {(config.vgiDuplicateRate * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={0.8} step={0.05}
              value={config.vgiDuplicateRate}
              onChange={e => setConfig({ vgiDuplicateRate: +e.target.value })} />
          </div>
          <div>
            <label className="label">False-Alarm Rate: {(config.vgiFalseAlarmRate * 100).toFixed(0)}%</label>
            <input type="range" min={0} max={0.30} step={0.01}
              value={config.vgiFalseAlarmRate}
              onChange={e => setConfig({ vgiFalseAlarmRate: +e.target.value })} />
          </div>
        </div>
      </div>

      <button
        className="btn btn-accent w-full py-2.5 text-sm"
        onClick={() => runSimulation()}
        disabled={isSimulating}
      >
        {isSimulating ? "Running Inhomogeneous Point Process..." : "▶ Generate & Seed Dataset"}
      </button>

      {simStats && (
        <div className="panel">
          <div className="panel-header">
            <span>Synthetic Dataset</span>
            <span className="badge badge-accent">{simStats.scenarioName}</span>
          </div>
          <div className="panel-body grid grid-cols-2 gap-2 text-xs">
            <KPI label="Nodes" value={simStats.nodes?.toLocaleString() ?? "-"} />
            <KPI label="Edges" value={simStats.segments?.toLocaleString() ?? "-"} />
            <KPI label="Lixels" value={simStats.lixels?.toLocaleString() ?? "-"} />
            <KPI label="Reports" value={simStats.accidents?.toLocaleString() ?? "-"} />
            <KPI label="Network" value={`${simStats.totalKm ?? "-"} km`} wide />
          </div>
        </div>
      )}

      {summary && (
        <div className="panel">
          <div className="panel-header">Severity Breakdown</div>
          <div className="panel-body space-y-1.5">
            {summary.bySeverity.map(s => (
              <div key={s.code} className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                <span className="flex-1">{s.label}</span>
                <span className="font-mono text-slate-400">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AnalysisPanel() {
  const config = useAppStore(s => s.analysisConfig);
  const setConfig = useAppStore(s => s.setAnalysisConfig);
  const runAnalysis = useAppStore(s => s.runAnalysis);
  const isAnalyzing = useAppStore(s => s.isAnalyzing);
  const result = useAppStore(s => s.analysisResult);
  const showHotspots = useAppStore(s => s.showHotspots);
  const toggleLayer = useAppStore(s => s.toggleLayer);
  const showClusters = useAppStore(s => s.showClusters);

  const needBandwidth = ["nkde", "planar_kde", "compare_kde", "getis_ord"].includes(config.type);
  const needEps = config.type === "ndbscan";
  const needKernel = ["nkde", "planar_kde", "compare_kde"].includes(config.type);
  const needMetric = ["nkde", "planar_kde", "compare_kde", "getis_ord", "eb_risk"].includes(config.type);

  return (
    <>
      <div className="panel">
        <div className="panel-header">Analysis Method</div>
        <div className="panel-body space-y-1.5">
          {(Object.keys(ANALYSIS_LABELS) as AnalysisType[]).map(a => (
            <button
              key={a}
              className={`btn btn-sm w-full text-left ${config.type === a ? "btn-active" : ""}`}
              onClick={() => setConfig({ type: a })}
            >
              <div className="font-semibold text-[11px]">{ANALYSIS_LABELS[a].label}</div>
              <div className="text-[9px] text-slate-400 font-normal">{ANALYSIS_LABELS[a].sub}</div>
            </button>
          ))}
        </div>
      </div>

      {needMetric && (
        <div className="panel">
          <div className="panel-header">Event Weighting Metric</div>
          <div className="panel-body space-y-1">
            {(["frequency", "density", "epdo", "eb"] as MetricMode[]).map(m => (
              <label key={m} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" name="metric"
                  checked={config.metric === m}
                  onChange={() => setConfig({ metric: m })}
                  className="accent-cyan-500" />
                <span className="uppercase">{m}</span>
              </label>
            ))}
            <div className="text-[10px] text-slate-500 mt-1">
              EPDO weights crashes by severity-equivalent cost.
            </div>
          </div>
        </div>
      )}

      {needBandwidth && (
        <div className="panel">
          <div className="panel-header">Network Bandwidth: {config.bandwidth} m</div>
          <div className="panel-body">
            <input type="range" min={50} max={800} step={25}
              value={config.bandwidth}
              onChange={e => setConfig({ bandwidth: +e.target.value })} />
            <div className="text-[10px] text-slate-500 mt-1">
              Shortest-path kernel bandwidth along the network graph.
            </div>
          </div>
        </div>
      )}

      {needKernel && (
        <div className="panel">
          <div className="panel-header">Kernel Function</div>
          <div className="panel-body space-y-1">
            {(["gaussian", "epanechnikov", "quartic"] as const).map(k => (
              <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="radio" name="kernel"
                  checked={config.kernel === k}
                  onChange={() => setConfig({ kernel: k })}
                  className="accent-cyan-500" />
                <span className="capitalize">{k}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {needEps && (
        <div className="panel">
          <div className="panel-header">N-DBSCAN ε: {config.eps} m · MinPts: {config.minPts}</div>
          <div className="panel-body space-y-2">
            <input type="range" min={25} max={400} step={25}
              value={config.eps} onChange={e => setConfig({ eps: +e.target.value })} />
            <input type="range" min={2} max={12} step={1}
              value={config.minPts} onChange={e => setConfig({ minPts: +e.target.value })} />
          </div>
        </div>
      )}

      <button
        className="btn btn-primary w-full py-2 text-sm"
        onClick={() => runAnalysis()}
        disabled={isAnalyzing}
      >
        {isAnalyzing ? "Computing..." : "▶ Run Geocomputation"}
      </button>

      <label className="flex items-center gap-2 text-xs cursor-pointer px-1">
        <input type="checkbox" checked={showHotspots} onChange={() => toggleLayer("showHotspots")} className="accent-cyan-500" />
        Render analysis overlay on map
      </label>
      {config.type === "ndbscan" && (
        <label className="flex items-center gap-2 text-xs cursor-pointer px-1">
          <input type="checkbox" checked={showClusters} onChange={() => toggleLayer("showClusters")} className="accent-cyan-500" />
          Show cluster convex hulls
        </label>
      )}

      {result && (
        <div className="panel">
          <div className="panel-header">
            <span>Execution Metadata</span>
            <span className="badge badge-success">{result.runtimeMs} ms</span>
          </div>
          <div className="panel-body text-xs space-y-0.5 font-mono text-slate-400">
            <div>events: <span className="text-cyan-400">{result.eventCount}</span></div>
            <div>lixels: <span className="text-cyan-400">{result.lixelCount}</span></div>
            <div>bandwidth h: <span className="text-cyan-400">{result.bandwidthM} m</span></div>
            <div>kernel: <span className="text-cyan-400">{result.kernel}</span></div>
            {result.clusterCount !== undefined && (
              <div>clusters: <span className="text-cyan-400">{result.clusterCount}</span></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function RiskPanel() {
  const result = useAppStore(s => s.analysisResult);
  const toggleHotspots = useAppStore(s => s.toggleLayer);
  const showHotspots = useAppStore(s => s.showHotspots);
  const setAnalysisConfig = useAppStore(s => s.setAnalysisConfig);
  const runAnalysis = useAppStore(s => s.runAnalysis);
  const isAnalyzing = useAppStore(s => s.isAnalyzing);

  useEffect(() => {
    // auto-run EB if not present
  }, []);

  const ebRows = result?.ebResults ?? [];
  const topCorridors = [...ebRows].sort((a, b) => b.psi - a.psi).slice(0, 15);

  return (
    <>
      <div className="panel">
        <div className="panel-header">Exposure-Aware Safety Metrics</div>
        <div className="panel-body text-[11px] space-y-1.5 text-slate-300">
          <div><b className="text-cyan-400">1. Raw Frequency (N)</b> — observed crash counts.</div>
          <div><b className="text-cyan-400">2. Linear Density</b> — N / km.</div>
          <div><b className="text-cyan-400">3. EPDO Severity Index</b> — weighted by PDO-equivalent cost.</div>
          <div><b className="text-cyan-400">4. MVKT Normalized Rate</b> — crashes per million vehicle-km travelled.</div>
          <div className="pt-1 border-t border-[var(--border)] mt-2">
            <b className="text-cyan-400">Empirical Bayes</b> blends observed N with SPF prior:
            <span className="block font-mono text-[10px] text-slate-400 mt-1">
              EB<sub>est</sub> = w · E[N|AADT] + (1−w) · N<sub>obs</sub>
            </span>
          </div>
          <div className="text-slate-400">
            PSI = excess expected crashes (N<sub>obs</sub> − EB<sub>est</sub>).
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary w-full py-2 text-sm"
        onClick={() => { setAnalysisConfig({ type: "eb_risk", metric: "frequency" }); runAnalysis(); }}
        disabled={isAnalyzing}
      >
        {isAnalyzing ? "Fitting SPF..." : "▶ Compute EB Risk & PSI"}
      </button>

      <label className="flex items-center gap-2 text-xs cursor-pointer px-1">
        <input type="checkbox" checked={showHotspots} onChange={() => toggleHotspots("showHotspots")} className="accent-cyan-500" />
        Render EB heat layer on map
      </label>

      {topCorridors.length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span>Top PSI Corridors</span>
            <span className="badge badge-warn">Excess</span>
          </div>
          <div className="panel-body p-0 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Seg</th>
                  <th>N</th>
                  <th>E[N]</th>
                  <th>EB</th>
                  <th>PSI</th>
                  <th>/MVKT</th>
                </tr>
              </thead>
              <tbody>
                {topCorridors.map(r => (
                  <tr key={r.segmentId}>
                    <td className="font-mono text-slate-400">#{r.segmentId}</td>
                    <td>{r.observed}</td>
                    <td>{r.spfExpected.toFixed(1)}</td>
                    <td>{r.ebEstimate.toFixed(1)}</td>
                    <td className="text-orange-400 font-semibold">{r.psi.toFixed(1)}</td>
                    <td className="text-slate-400">{r.rawRatePerMvk.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function StewardshipPanel() {
  const summary = useAppStore(s => s.summary);
  return (
    <>
      <div className="panel">
        <div className="panel-header">VGI Data Stewardship</div>
        <div className="panel-body text-[11px] space-y-1.5 text-slate-300">
          <p>Citizen reports are initially <span className="badge badge-warn">RAW VGI</span> and require probabilistic topological map-matching, deduplication, and triage before entering analytical layers.</p>
          <p>SHIFT+CLICK on the map to submit a new citizen report. The system automatically:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
            <li>Projects the observation to the road network</li>
            <li>Computes snap-confidence (orthogonal distance, class likelihood)</li>
            <li>Searches spatiotemporal network neighborhood for duplicates</li>
            <li>Suggests witness corroboration if found</li>
          </ul>
        </div>
      </div>

      {summary && (
        <>
          <div className="panel">
            <div className="panel-header">VGI Quality Diagnostics</div>
            <div className="panel-body grid grid-cols-2 gap-2 text-xs">
              <KPI label="Verified" value={summary.totals.verified.toLocaleString()} color="#10b981" />
              <KPI label="Raw VGI" value={summary.totals.rawVgi.toLocaleString()} color="#f97316" />
              <KPI label="False Alarms" value={summary.totals.falseAlarms.toLocaleString()} color="#ef4444" />
              <KPI label="Total" value={summary.totals.total.toLocaleString()} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">By Lighting Condition</div>
            <div className="panel-body space-y-1">
              {summary.byLighting.map(l => (
                <div key={l.label} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 capitalize">{l.label.replace("_", " ")}</span>
                  <span className="font-mono text-slate-400">{l.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function BenchmarkPanel() {
  const result = useAppStore(s => s.analysisResult);
  const runAnalysis = useAppStore(s => s.runAnalysis);
  const setAnalysisConfig = useAppStore(s => s.setAnalysisConfig);
  const isAnalyzing = useAppStore(s => s.isAnalyzing);

  return (
    <>
      <div className="panel">
        <div className="panel-header">Ground-Truth Benchmarking</div>
        <div className="panel-body text-[11px] space-y-1.5 text-slate-300">
          <p>Because the simulator exposes the true intensity function λ(s,t), we can quantitatively evaluate hotspot-detection performance.</p>
          <p className="text-slate-400">
            <b className="text-cyan-400">PAI</b> — Prediction Accuracy Index: hit-rate in top-x-percent of zones divided by x.
          </p>
          <p className="text-slate-400">
            <b className="text-cyan-400">RRI</b> — Recapture Rate Index: overlap between predicted and true hot zones.
          </p>
          <p className="text-slate-400">
            <b className="text-cyan-400">RMSE</b> — Root-mean-square error between estimated and true λ across all lixels.
          </p>
        </div>
      </div>

      <button
        className="btn btn-primary w-full py-2 text-sm"
        onClick={() => { setAnalysisConfig({ type: "benchmark", bandwidth: 250, kernel: "gaussian", metric: "frequency" }); runAnalysis(); }}
        disabled={isAnalyzing}
      >
        {isAnalyzing ? "Running NKDE & scoring..." : "▶ Run Benchmark"}
      </button>

      {result?.metrics && (
        <div className="panel">
          <div className="panel-header">
            <span>Top 10% Hot Zones</span>
            <span className="badge badge-accent">PAI × RRI</span>
          </div>
          <div className="panel-body grid grid-cols-3 gap-2">
            <KPI label="PAI" value={result.metrics.pai.toFixed(2)} />
            <KPI label="RRI" value={result.metrics.rri.toFixed(2)} />
            <KPI label="RMSE" value={result.metrics.rmse.toFixed(3)} />
          </div>
          <div className="panel-body pt-0 text-[10px] text-slate-400">
            PAI &gt; 1.0 = concentration of true events in predicted hot zones.
            RRI = 1.0 = perfect overlap of top-k lists.
          </div>
        </div>
      )}

      {result?.metricsAt5 && result?.metricsAt20 && (
        <div className="panel">
          <div className="panel-header">Sensitivity to Hot-Zone Threshold</div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr><th>Top %</th><th>PAI</th><th>RRI</th></tr>
              </thead>
              <tbody>
                <tr><td>5%</td><td>{result.metricsAt5.pai.toFixed(2)}</td><td>{result.metricsAt5.rri.toFixed(2)}</td></tr>
                <tr><td>10%</td><td>{result.metrics!.pai.toFixed(2)}</td><td>{result.metrics!.rri.toFixed(2)}</td></tr>
                <tr><td>20%</td><td>{result.metricsAt20.pai.toFixed(2)}</td><td>{result.metricsAt20.rri.toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function KPI({ label, value, color, wide }: { label: string; value: string; color?: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="kpi-value" style={{ color: color ?? "var(--accent)" }}>{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
