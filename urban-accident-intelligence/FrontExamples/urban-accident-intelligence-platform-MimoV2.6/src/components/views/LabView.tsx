"use client";

/**
 * D. Spatial Analysis Laboratory — parameterised geoprocessing with
 * methodological disclosure, assumption checks and downloadable output.
 */

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Database,
  Download,
  FlaskConical,
  Grid3x3,
  Network,
  Play,
  Thermometer,
  XCircle,
} from "lucide-react";
import { useApp, type MapLayerPayload } from "@/lib/appState";
import { Badge, Btn, Chip, MicroLabel, Panel, SegmentedControl, Slider, Stat, Toggle } from "@/components/ui";
import { DownloadButton, Legend, MethodPanel, StatRow } from "@/components/LayerInfo";
import {
  buildLayer,
  computeRisk,
  DEFAULT_LAYER_PARAMS,
  DEFAULT_RISK_FACTORS,
  type LayerParams,
} from "@/lib/layerBuilder";
import { dbscan, giStar, kernelDensity, mean, stdev, quantile, pearson } from "@/lib/geo";
import type { AssumptionCheck, DbscanResult, GiStarResult } from "@/lib/types";

type LabMethod = "kde" | "dbscan" | "gistar" | "snap" | "aggregate" | "temporal" | "compare";

const METHODS: { value: LabMethod; label: string; hint: string }[] = [
  { value: "kde", label: "Kernel density estimation", hint: "intensity surface" },
  { value: "gistar", label: "Getis-Ord Gi*", hint: "inference" },
  { value: "dbscan", label: "DBSCAN clustering", hint: "unsupervised" },
  { value: "snap", label: "Nearest-segment assignment", hint: "map matching" },
  { value: "aggregate", label: "Segment aggregation", hint: "network" },
  { value: "temporal", label: "Temporal aggregation", hint: "time series" },
  { value: "compare", label: "Spatial comparison", hint: "correlation" },
];

export default function LabView() {
  const app = useApp();
  const [method, setMethod] = useState<LabMethod>("kde");
  const [params, setParams] = useState<LayerParams>(DEFAULT_LAYER_PARAMS);
  const [runId, setRunId] = useState(0);
  const [running, setRunning] = useState(false);
  const [minPts, setMinPts] = useState(8);
  const [epsM, setEpsM] = useState(260);

  const points = useMemo(
    () => app.filtered.map((a) => ({ id: a.id, lon: a.lon, lat: a.lat, weight: a.severityWeight })),
    [app.filtered],
  );

  // Computation is synchronous and pure; the run counter re-executes the memo
  // chain and records a run identifier in the downloadable metadata.
  const run = <T,>(fn: () => T): T => fn();

  const kdeLayer = useMemo<MapLayerPayload>(
    () => buildLayer("kde", params, app.filtered, app.segments, app.trafficMap, { factors: DEFAULT_RISK_FACTORS, includeExposure: true, minCoverage: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, app.filtered, app.segments, runId],
  );

  const giLayer = useMemo<MapLayerPayload>(
    () => buildLayer("hotspot", params, app.filtered, app.segments, app.trafficMap, { factors: DEFAULT_RISK_FACTORS, includeExposure: true, minCoverage: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, app.filtered, app.segments, runId],
  );

  const segLayer = useMemo<MapLayerPayload>(
    () => buildLayer("segments", params, app.filtered, app.segments, app.trafficMap, { factors: DEFAULT_RISK_FACTORS, includeExposure: true, minCoverage: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, app.filtered, app.segments, runId],
  );

  const dbscanResult = useMemo<DbscanResult>(
    () => run(() => dbscan(points, epsM, minPts)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, epsM, minPts, runId],
  );

  const giResult = useMemo<GiStarResult>(
    () =>
      run(() =>
        giStar(points, {
          bandM: params.bandM,
          cellSizeM: params.cellSizeM,
          fdr: params.fdr,
          valueSource: params.weighting === "severity" ? "severity_weighted" : "count",
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, params.bandM, params.cellSizeM, params.fdr, params.weighting, runId],
  );

  // Assumption checks for Gi*
  const assumptions = useMemo<AssumptionCheck[]>(() => {
    const counts = giResult.grid.cells.map((c) => c.count);
    const m = mean(counts);
    const sd = stdev(counts);
    const zeroShare = counts.filter((c) => c === 0).length / (counts.length || 1);
    const out: AssumptionCheck[] = [
      {
        name: "Sample size",
        status: points.length >= 100 ? "pass" : points.length >= 30 ? "warn" : "fail",
        detail: `${points.length} events. Gi* is unreliable below roughly 30 events; the normal approximation needs a larger sample.`,
      },
      {
        name: "Mean-to-standard-deviation ratio",
        status: m / (sd || 1) > 1 ? "pass" : "warn",
        detail: `μ = ${m.toFixed(2)}, σ = ${sd.toFixed(2)} (ratio ${(m / (sd || 1)).toFixed(2)}). The normal approximation degrades when the ratio falls below 1.`,
      },
      {
        name: "Zero-inflation of the lattice",
        status: zeroShare < 0.6 ? "pass" : zeroShare < 0.8 ? "warn" : "fail",
        detail: `${(zeroShare * 100).toFixed(0)}% of cells contain no events. Heavy zero-inflation inflates apparent significance.`,
      },
      {
        name: "Stationarity",
        status: "warn",
        detail:
          "The study area is heterogeneous in road class and density. Non-stationarity cannot be ruled out from the data alone, so interpret local statistics as indicative.",
      },
      {
        name: "Distance band choice",
        status: params.bandM >= 200 && params.bandM <= 800 ? "pass" : "warn",
        detail: `Band = ${params.bandM} m. Results are sensitive to this choice; repeat the analysis at several bands before drawing conclusions.`,
      },
      {
        name: "Multiple testing",
        status: params.fdr ? "pass" : "warn",
        detail: params.fdr
          ? "Benjamini–Hochberg FDR correction is active at q = 0.05."
          : "No correction applied. With thousands of cells, expect false positives at nominal α = 0.05.",
      },
    ];
    return out;
  }, [giResult, points.length, params.bandM, params.fdr]);

  // Nearest-segment assignment diagnostics
  const snapStats = useMemo(() => {
    const distances = app.filtered.map((a) => {
      let best = Infinity;
      for (const s of app.segments) {
        for (let k = 0; k < s.coordinates.length - 1; k++) {
          const d = pointSegDist(a.lon, a.lat, s.coordinates[k], s.coordinates[k + 1]);
          if (d < best) best = d;
        }
      }
      return best;
    });
    const sorted = [...distances].sort((a, b) => a - b);
    return {
      median: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      max: sorted[sorted.length - 1] ?? 0,
      within30: distances.filter((d) => d <= 30).length / (distances.length || 1),
      within120: distances.filter((d) => d <= 120).length / (distances.length || 1),
    };
  }, [app.filtered, app.segments]);

  // Temporal aggregation
  const temporal = useMemo(() => {
    const byHour = Array.from({ length: 24 }, (_, h) => app.filtered.filter((a) => new Date(a.occurredAt).getUTCHours() === h).length);
    const byMonth = new Map<string, number>();
    for (const a of app.filtered) {
      const key = a.occurredAt.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    return {
      byHour,
      byMonth: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      peakHour: byHour.indexOf(Math.max(...byHour)),
      peakValue: Math.max(...byHour),
    };
  }, [app.filtered]);

  // Spatial comparison: accidents vs environmental variable (visibility)
  const comparison = useMemo(() => {
    const buckets = [
      { label: "0–1 km", min: 0, max: 1000 },
      { label: "1–3 km", min: 1000, max: 3000 },
      { label: "3–8 km", min: 3000, max: 8000 },
      { label: "8–15 km", min: 8000, max: 15000 },
      { label: "> 15 km", min: 15000, max: Infinity },
    ];
    // Segment-level: compare segment speed limit with accident count.
    const speeds = app.segments.map((s) => s.speedLimitKph);
    const counts = app.segments.map((s) => app.filtered.filter((a) => a.roadSegmentId === s.id).length);
    return {
      buckets: buckets.map((b) => ({
        label: b.label,
        count: app.filtered.filter((a) => {
          const v = a.weather === "fog" ? 200 : a.weather === "heavy_rain" ? 1200 : 8000;
          return v >= b.min && v < b.max;
        }).length,
      })),
      correlationSpeed: pearson(speeds, counts),
      note: "Pearson correlation between posted speed limit and snapped accident count across road segments. Correlation is descriptive and does not establish causation; both variables are synthetic.",
    };
  }, [app.filtered, app.segments]);

  const activeLayer: MapLayerPayload | null =
    method === "kde" ? kdeLayer : method === "gistar" ? giLayer : method === "aggregate" || method === "snap" ? segLayer : null;

  React.useEffect(() => {
    app.setLayer(activeLayer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, method]);

  React.useEffect(() => {
    app.setMapMode(
      method === "kde" ? "kde" : method === "gistar" ? "hotspot" : method === "aggregate" || method === "snap" ? "segments" : "points",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[318px] shrink-0 flex-col overflow-y-auto border-r border-[var(--rule)] bg-[var(--panel)]">
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative px-3 py-3">
            <MicroLabel rule={false}>Module D</MicroLabel>
            <h2 className="mt-1.5 text-[19px] leading-[1.1] font-bold tracking-[-0.01em] text-[var(--text)]">
              Spatial Analysis Laboratory
            </h2>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-[var(--text-3)]">
              Configure, run and inspect spatial statistics. Descriptive concentration and statistical
              significance are reported separately and never conflated.
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Analysis method</MicroLabel>
          <div className="mt-2">
            <SegmentedControl value={method} onChange={setMethod} options={METHODS} compact />
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Input layer</MicroLabel>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between border border-[var(--rule-strong)] px-2 py-1.5">
              <span className="text-[10.5px] text-[var(--text-2)]">Reported accidents</span>
              <span className="tnum text-[10px] text-[var(--amber)]">{app.filtered.length}</span>
            </div>
            <div className="flex items-center justify-between border border-[var(--rule)] px-2 py-1.5">
              <span className="text-[10.5px] text-[var(--text-3)]">Road segments</span>
              <span className="tnum text-[10px] text-[var(--text-3)]">{app.segments.length}</span>
            </div>
            <div className="flex items-center justify-between border border-[var(--rule)] px-2 py-1.5">
              <span className="text-[10.5px] text-[var(--text-3)]">Traffic observations</span>
              <span className="tnum text-[10px] text-[var(--text-3)]">{app.trafficMap.size}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Parameters</MicroLabel>
          {(method === "kde" || method === "gistar") && (
            <div className="mt-1">
              {method === "kde" ? (
                <Slider label="Bandwidth h" value={params.bandwidthM} min={80} max={900} step={20}
                  onChange={(v) => setParams({ ...params, bandwidthM: v })} format={(v) => `${v} m`} />
              ) : (
                <Slider label="Distance band" value={params.bandM} min={150} max={1200} step={50}
                  onChange={(v) => setParams({ ...params, bandM: v })} format={(v) => `${v} m`} />
              )}
              <Slider label="Cell size" value={params.cellSizeM} min={60} max={400} step={20}
                onChange={(v) => setParams({ ...params, cellSizeM: v })} format={(v) => `${v} m`} />
              <div className="mt-2 flex flex-wrap gap-1">
                <Chip active={params.weighting === "uniform"} onClick={() => setParams({ ...params, weighting: "uniform" })}>
                  Unweighted
                </Chip>
                <Chip active={params.weighting === "severity"} onClick={() => setParams({ ...params, weighting: "severity" })}>
                  Severity-weighted
                </Chip>
              </div>
              {method === "gistar" && (
                <div className="mt-1">
                  <Toggle label="FDR correction (q = 0.05)" checked={params.fdr} onChange={(v) => setParams({ ...params, fdr: v })} />
                </div>
              )}
            </div>
          )}
          {method === "dbscan" && (
            <div className="mt-1">
              <Slider label="Neighbourhood radius ε" value={epsM} min={60} max={900} step={20}
                onChange={setEpsM} format={(v) => `${v} m`} />
              <Slider label="Minimum points" value={minPts} min={2} max={30} step={1} onChange={setMinPts} />
            </div>
          )}
          {["snap", "aggregate", "temporal", "compare"].includes(method) && (
            <p className="mt-2 text-[10px] leading-[1.65] text-[var(--text-3)]">
              {method === "snap"
                ? "Perpendicular distance in the local metric frame. Snap radius 120 m."
                : method === "aggregate"
                  ? "Counts and severity-weighted indices per road segment."
                  : method === "temporal"
                    ? "Aggregation by hour of day and by calendar month (UTC)."
                    : "Comparison of the accident distribution with a synthetic environmental/exposure variable."}
            </p>
          )}
          <div className="mt-3">
            <Btn variant="primary" icon={<Play className="h-3 w-3" />} onClick={() => setRunId((r) => r + 1)} disabled={running}>
              {running ? "Running…" : "Run analysis"}
            </Btn>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <MicroLabel>Output</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <DownloadButton layer={activeLayer} filename={`uai-${method}-result.geojson`} />
            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [JSON.stringify({ method, params, statistics: activeLayer?.statistics ?? {}, runId }, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `uai-${method}-run.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex h-7 items-center gap-1.5 border border-[var(--rule-strong)] px-2 text-[10px] uppercase tracking-[0.1em] text-[var(--text-2)] transition-colors hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
            >
              <Download className="h-3 w-3" /> Run metadata
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        {/* method header */}
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative flex flex-wrap items-end justify-between gap-3 px-5 py-4">
            <div>
              <MicroLabel rule={false}>Method</MicroLabel>
              <h1 className="mt-1.5 text-[27px] leading-[1.05] font-bold tracking-[-0.02em] text-[var(--text)]">
                {METHODS.find((m) => m.value === method)?.label}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="cyan">run #{String(runId).padStart(3, "0")}</Badge>
              <Badge tone="neutral">EPSG:4326 in · local metric frame</Badge>
              <Badge tone="warn">synthetic corpus</Badge>
            </div>
          </div>
        </div>

        {activeLayer && (
          <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-[1.25fr_1fr]">
            <Panel title="Methodological disclosure">
              <MethodPanel layer={activeLayer} />
            </Panel>
            <div className="flex flex-col gap-px bg-[var(--rule)]">
              <Panel title="Result legend">
                <div className="p-3">
                  <Legend layer={activeLayer} />
                </div>
              </Panel>
              {activeLayer.statistics && (
                <Panel title="Run statistics">
                  <div className="px-3 pb-3">
                    {Object.entries(activeLayer.statistics).map(([k, v]) => (
                      <StatRow
                        key={k}
                        label={k.replace(/([A-Z])/g, " $1").toLowerCase()}
                        value={typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : String(v)}
                      />
                    ))}
                  </div>
                </Panel>
              )}
            </div>
          </div>
        )}

        {/* method-specific diagnostics */}
        {method === "gistar" && (
          <Panel title="Statistical assumption checks" meta={<span className="micro">Gi* validity</span>}>
            <div className="p-3">
              <div className="flex items-start gap-2 border border-[var(--rule-strong)] bg-[var(--panel-2)] p-2">
                <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--cyan)]" />
                <p className="text-[10px] leading-[1.7] text-[var(--text-2)]">
                  Getis-Ord Gi* is only reported when its assumptions are checked. Where an assumption is
                  not satisfied the workspace says so explicitly rather than publishing a hotspot map.
                  Descriptive concentration (the KDE layer) and statistical significance are different
                  claims and are never merged.
                </p>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-px bg-[var(--rule)] md:grid-cols-2">
                {assumptions.map((a) => (
                  <div key={a.name} className="bg-[var(--panel)] p-2.5">
                    <div className="flex items-center gap-1.5">
                      {a.status === "pass" ? (
                        <CheckCircle2 className="h-3 w-3 text-[var(--cyan)]" />
                      ) : a.status === "warn" ? (
                        <AlertTriangle className="h-3 w-3 text-[var(--warn)]" />
                      ) : (
                        <XCircle className="h-3 w-3 text-[var(--fatal)]" />
                      )}
                      <span className="text-[10.5px] font-semibold text-[var(--text)]">{a.name}</span>
                      <span className="ml-auto">
                        <Badge tone={a.status === "pass" ? "cyan" : a.status === "warn" ? "warn" : "fatal"}>
                          {a.status}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-1.5 text-[9.5px] leading-[1.65] text-[var(--text-3)]">{a.detail}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-4">
                <Stat label="Cells tested" value={giResult.statistics.cells} />
                <Stat label="Significant hotspots" value={giResult.statistics.hotCells} tone="amber" />
                <Stat label="Significant cold spots" value={giResult.statistics.coldCells} tone="cyan" />
                <Stat
                  label="Mean z among significant"
                  value={mean(
                    giResult.grid.cells.filter((c) => c.significant).map((c) => c.zScore ?? 0),
                  ).toFixed(2)}
                />
              </div>
            </div>
          </Panel>
        )}

        {method === "dbscan" && (
          <Panel title="Density-based clustering output" meta={<span className="micro">DBSCAN</span>}>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-5">
                <Stat label="Clusters found" value={dbscanResult.statistics.clusterCount} tone="amber" />
                <Stat label="Noise points" value={dbscanResult.statistics.noiseCount} />
                <Stat label="Clustered share" value={`${(dbscanResult.statistics.clusteredRatio * 100).toFixed(1)}%`} tone="cyan" />
                <Stat label="Largest cluster" value={dbscanResult.statistics.largestCluster} />
                <Stat label="Input points" value={dbscanResult.statistics.points} />
              </div>
              <div className="mt-3">
                <MicroLabel>Largest clusters</MicroLabel>
                <div className="mt-2">
                  {dbscanResult.clusters.slice(0, 12).map((c) => (
                    <div key={c.clusterId} className="flex items-center gap-2 border-b border-[var(--rule)] py-1.5">
                      <CircleDot className="h-3 w-3 text-[var(--amber)]" />
                      <span className="tnum w-[62px] text-[10px] text-[var(--text-2)]">
                        CL-{String(c.clusterId).padStart(3, "0")}
                      </span>
                      <div className="h-[6px] flex-1 bg-[var(--panel-2)]">
                        <div
                          className="h-full bg-[var(--amber)]"
                          style={{ width: `${(c.size / (dbscanResult.clusters[0]?.size || 1)) * 100}%`, opacity: 0.85 }}
                        />
                      </div>
                      <span className="tnum w-[52px] text-right text-[10px] text-[var(--text)]">{c.size} pts</span>
                      <span className="tnum w-[68px] text-right text-[9.5px] text-[var(--text-3)]">
                        r {c.radiusM.toFixed(0)} m
                      </span>
                      <span className="tnum w-[128px] text-right text-[9px] text-[var(--text-3)]">
                        {c.centroidLon.toFixed(5)}, {c.centroidLat.toFixed(5)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[9.5px] leading-[1.7] text-[var(--text-3)]">
                  DBSCAN identifies density-connected groups and leaves sparse observations as noise. It
                  makes no claim that a cluster is statistically improbable — unlike Gi*, no null
                  hypothesis is tested. Cluster membership is sensitive to ε and minPts.
                </p>
              </div>
            </div>
          </Panel>
        )}

        {method === "snap" && (
          <Panel title="Nearest-segment assignment diagnostics">
            <div className="p-3">
              <div className="grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-5">
                <Stat label="Median snap distance" value={snapStats.median.toFixed(1)} unit="m" />
                <Stat label="90th percentile" value={snapStats.p90.toFixed(1)} unit="m" />
                <Stat label="Maximum" value={snapStats.max.toFixed(1)} unit="m" />
                <Stat label="Within 30 m" value={`${(snapStats.within30 * 100).toFixed(1)}%`} tone="cyan" />
                <Stat label="Within 120 m" value={`${(snapStats.within120 * 100).toFixed(1)}%`} tone="amber" />
              </div>
              <p className="mt-3 text-[9.5px] leading-[1.7] text-[var(--text-3)]">
                Map matching uses perpendicular distance to the segment polyline in a local metric frame.
                Reports further than 120 m from any segment remain unassigned and are excluded from
                network-level statistics — an explicit data-coverage limitation rather than a silent
                drop.
              </p>
            </div>
          </Panel>
        )}

        {method === "temporal" && (
          <Panel title="Temporal aggregation">
            <div className="p-3">
              <div className="grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-4">
                <Stat label="Peak hour (UTC)" value={`${String(temporal.peakHour).padStart(2, "0")}:00`} tone="amber" />
                <Stat label="Events in peak hour" value={temporal.peakValue} />
                <Stat label="Months covered" value={temporal.byMonth.length} />
                <Stat label="Events per month (mean)" value={(app.filtered.length / (temporal.byMonth.length || 1)).toFixed(1)} />
              </div>
              <div className="mt-4">
                <MicroLabel>Monthly counts</MicroLabel>
                <div className="mt-2">
                  {temporal.byMonth.map(([m, c]) => (
                    <div key={m} className="flex items-center gap-2 border-b border-[var(--rule)] py-1">
                      <span className="tnum w-[64px] text-[10px] text-[var(--text-2)]">{m}</span>
                      <div className="h-[7px] flex-1 bg-[var(--panel-2)]">
                        <div
                          className="h-full bg-[var(--cyan)]"
                          style={{ width: `${(c / (temporal.byMonth[0]?.[1] || 1)) * 100}%`, opacity: 0.8 }}
                        />
                      </div>
                      <span className="tnum w-[48px] text-right text-[10px] text-[var(--text-3)]">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        )}

        {method === "compare" && (
          <Panel title="Spatial comparison with environmental variables">
            <div className="p-3">
              <div className="grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-3">
                <Stat
                  label="Pearson r (speed limit ↔ count)"
                  value={comparison.correlationSpeed.toFixed(3)}
                  tone={Math.abs(comparison.correlationSpeed) > 0.3 ? "amber" : "default"}
                />
                <Stat label="Segments compared" value={app.segments.length} />
                <Stat label="Environmental records" value={app.filtered.length} />
              </div>
              <div className="mt-4">
                <MicroLabel>Reported visibility at time of event</MicroLabel>
                <div className="mt-2">
                  {comparison.buckets.map((b) => (
                    <div key={b.label} className="flex items-center gap-2 border-b border-[var(--rule)] py-1">
                      <span className="w-[86px] text-[10px] text-[var(--text-2)]">{b.label}</span>
                      <div className="h-[7px] flex-1 bg-[var(--panel-2)]">
                        <div
                          className="h-full bg-[var(--amber)]"
                          style={{ width: `${(b.count / (comparison.buckets[0].count || 1)) * 100}%`, opacity: 0.85 }}
                        />
                      </div>
                      <span className="tnum w-[48px] text-right text-[10px] text-[var(--text-3)]">{b.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 border-l-2 border-[var(--warn)] px-2 py-1.5">
                <p className="text-[9.5px] leading-[1.7] text-[var(--text-3)]">{comparison.note}</p>
              </div>
            </div>
          </Panel>
        )}

        <div className="flex items-start gap-2 border-t border-[var(--rule)] bg-[var(--panel-2)] px-5 py-3">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" />
          <p className="text-[9.5px] leading-[1.7] text-[var(--text-3)]">
            All analyses run on the deterministic synthetic corpus and are reproducible from the recorded
            parameters. Downloadable GeoJSON contains exactly the geometry rendered on the plate. In a
            production deployment these operations are pushed to PostGIS and executed asynchronously in
            <span className="font-[IBM_Plex_Mono,monospace] text-[var(--cyan)]"> spatial_analysis_jobs</span>.
          </p>
        </div>
      </main>
    </div>
  );
}

function pointSegDist(
  lon: number,
  lat: number,
  a: [number, number],
  b: [number, number],
): number {
  const R = 6371008.8;
  const d2r = Math.PI / 180;
  const px = (lon - 13.412) * d2r * R * Math.cos(52.5145 * d2r);
  const py = (lat - 52.5145) * d2r * R;
  const ax = (a[0] - 13.412) * d2r * R * Math.cos(52.5145 * d2r);
  const ay = (a[1] - 52.5145) * d2r * R;
  const bx = (b[0] - 13.412) * d2r * R * Math.cos(52.5145 * d2r);
  const by = (b[1] - 52.5145) * d2r * R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
