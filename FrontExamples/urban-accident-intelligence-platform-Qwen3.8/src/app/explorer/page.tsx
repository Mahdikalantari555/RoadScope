"use client";

/**
 * Epic 6 — Coordinated Multiple Views geovisual analytics.
 * Chart brushes drive the map; map selections (bounding box, segment, lixel)
 * recompute every statistic for that spatial subset.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Field, Panel, Select, Toggle } from "@/components/ui";
import { BarList, CategoricalLegend, DataTable, DiurnalMatrix, RampLegend, ScatterPlot, TimeSeriesChart, fmtCompact } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, fmt, type GeoCollection, type GeoFeature } from "@/lib/clientApi";
import { buildQuery, useAnalysisJob } from "@/lib/useJob";
import { CLASS_LABELS, SEVERITY_LABELS, SEVERITY_ORDER, incidentPointLayer, lixelChoroplethLayer, networkLayer, severityColor } from "@/lib/ui";
import { colorFor } from "@/lib/util/colors";

type OverlayKind = "none" | "nkde" | "getis" | "risk" | "dbscan" | "truth";

export default function ExplorerPage() {
  const { dataset, datasetId, role } = useApp();
  const [severities, setSeverities] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(["verified", "triaged", "unverified"]);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [bin, setBin] = useState<"day" | "week" | "month">("week");
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [hourCell, setHourCell] = useState<{ dow: number; hour: number } | null>(null);
  const [overlay, setOverlay] = useState<OverlayKind>("none");
  const [ramp, setRamp] = useState("inferno");
  const [clusterPoints, setClusterPoints] = useState(true);
  const [showNodes, setShowNodes] = useState(false);
  const [networkMode, setNetworkMode] = useState<"class" | "exposure" | "plain">("class");
  const [incidents, setIncidents] = useState<GeoCollection | null>(null);
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [selected, setSelected] = useState<GeoFeature | null>(null);
  const job = useAnalysisJob(datasetId, role);

  const dateFrom = useMemo(() => (range && stats?.series ? stats.series[range[0]]?.start : undefined), [range, stats]);
  const dateTo = useMemo(() => (range && stats?.series ? stats.series[range[1]]?.end : undefined), [range, stats]);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=${showNodes ? 1 : 0}&lixels=0`, role)
      .then((r) => alive && setNetwork(r.geojson))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [datasetId, role, showNodes]);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    const url = buildQuery(`/api/datasets/${datasetId}/incidents`, {
      limit: 12000,
      severity: severities,
      category: categories,
      status: statuses,
      from: dateFrom,
      to: dateTo,
    });
    apiGet<{ geojson: GeoCollection; categories: Array<{ code: string; label: string }> }>(url, role)
      .then((r) => alive && setIncidents(r.geojson))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [datasetId, role, severities, categories, statuses, dateFrom, dateTo]);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    const url = buildQuery(`/api/datasets/${datasetId}/stats`, { bin, severity: severities, category: categories, status: statuses, bbox: bbox ? bbox.join(",") : undefined });
    apiGet<any>(url, role)
      .then((r) => alive && setStats(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [datasetId, role, bin, severities, categories, statuses, bbox]);

  // Client-side cross-filters that do not require a server round-trip.
  const filteredIncidents = useMemo<GeoCollection | null>(() => {
    if (!incidents) return null;
    const feats = incidents.features.filter((f) => {
      const p = f.properties;
      if (selectedSegment && p.segmentId !== selectedSegment) return false;
      if (hourCell) {
        const d = new Date(p.occurredAt);
        const dow = (d.getUTCDay() + 6) % 7;
        if (dow !== hourCell.dow || d.getUTCHours() !== hourCell.hour) return false;
      }
      return true;
    });
    return { ...incidents, features: feats };
  }, [incidents, selectedSegment, hourCell]);

  // Run the overlay job when requested.
  useEffect(() => {
    if (!datasetId || overlay === "none") return;
    const common = { severities: severities.length ? severities : undefined, categories: categories.length ? categories : undefined, statuses, bbox: bbox ?? undefined, dateFrom, dateTo };
    if (overlay === "nkde") void job.run("nkde", { bandwidthM: 320, kernel: "quartic", edgeCorrection: true, splitting: true, ...common });
    if (overlay === "getis") void job.run("network_getis_ord", { bandwidthM: 300, weightMode: "distance_decay", permutations: 499, ...common });
    if (overlay === "risk") void job.run("eb_smoothing", { level: "lixel", ...common });
    if (overlay === "dbscan") void job.run("n_dbscan", { epsilonM: 220, minPoints: 4, ...common });
    if (overlay === "truth") void job.run("ground_truth_benchmark", { bandwidthM: 320, ...common });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, datasetId, bbox, dateFrom, dateTo, severities.join("|"), categories.join("|"), statuses.join("|")]);

  const overlayLayer = useMemo<MapLayerSpec | null>(() => {
    const data = job.result?.features as GeoCollection | undefined;
    if (!data || overlay === "none" || overlay === "dbscan") return null;
    if (overlay === "getis") {
      const colors: Record<string, string> = { hotspot_p01: "#d81b60", hotspot_p05: "#fb8c00", coldspot_p05: "#42a5f5", coldspot_p01: "#1565c0", not_significant: "#4b5a70" };
      return {
        id: "getis",
        data,
        visible: true,
        zIndex: 6,
        opacity: 0.95,
        stroke: (p) => colors[p.significanceClass] ?? "#4b5a70",
        width: (p) => (p.significanceClass === "not_significant" ? 1.4 : 3.6),
        pickable: true,
      };
    }
    if (overlay === "truth") {
      return lixelChoroplethLayer(data, { valueKey: "trueLambda", ramp: "viridis", width: 3, id: "truth", label: "Oracle λ" });
    }
    if (overlay === "risk") {
      return lixelChoroplethLayer(data, { valueKey: "ebEstimate", ramp, width: 3, opacity: 0.95, id: "risk", label: "EB estimate" });
    }
    return lixelChoroplethLayer(data, { valueKey: "value", ramp, width: 3, opacity: 0.95, id: "nkde", label: "NKDE per km" });
  }, [job.result, overlay, ramp]);

  const layers = useMemo<MapLayerSpec[]>(() => {
    const out: MapLayerSpec[] = [networkLayer(network, networkMode, overlay === "none" ? 0.8 : 0.45)];
    if (overlayLayer) out.push(overlayLayer);
    if (overlay === "dbscan" && job.result?.features) {
      out.push({
        id: "hulls",
        data: job.result.features as GeoCollection,
        visible: true,
        zIndex: 8,
        stroke: (p) => (p.kind === "cluster_hull" ? colorFor("plasma", 0.85) : p.kind === "cluster_subgraph" ? "#7bd88f" : "#8fa3bd"),
        fill: (p) => (p.kind === "cluster_hull" ? "rgba(216,27,96,0.14)" : null),
        width: (p) => (p.kind === "cluster_subgraph" ? 1.6 : 1.2),
        pickable: true,
      });
    }
    out.push(incidentPointLayer(filteredIncidents, { clusterRadiusPx: clusterPoints ? 15 : 0, zIndex: 14 }));
    if (selectedSegment && network) {
      out.push({
        id: "selection",
        data: { type: "FeatureCollection", features: network.features.filter((f) => f.properties.segmentId === selectedSegment) },
        visible: true,
        zIndex: 20,
        stroke: () => "var(--accent)",
        width: () => 4,
        pickable: false,
      });
    }
    return out;
  }, [network, networkMode, overlayLayer, overlay, job.result, filteredIncidents, clusterPoints, selectedSegment]);

  const onMapSelect = useCallback(
    (feature: GeoFeature | null, layerId: string | null) => {
      setSelected(feature);
      if (feature && layerId === "network") setSelectedSegment(String(feature.properties.segmentId));
      else if (layerId !== "network" && !feature) setSelectedSegment(null);
    },
    [],
  );

  const toggleIn = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const activeFilterCount = severities.length + categories.length + (bbox ? 1 : 0) + (range ? 1 : 0) + (selectedSegment ? 1 : 0) + (hourCell ? 1 : 0);

  const epdoMax = Math.max(1, ...((stats?.topSegments ?? []).map((s: any) => s.epdoPerKm) as number[]));

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1fr)_330px]">
      {/* ---------------- map canvas ---------------- */}
      <div className="flex min-h-0 flex-col gap-2">
        <Panel
          title="Multi-scale cartographic canvas"
          subtitle={`${fmt(filteredIncidents?.features.length ?? 0)} incidents in view · ${activeFilterCount} active cross-filters · CRS84 serialisation of EPSG:${dataset?.srid ?? "—"}`}
          right={
            <div className="flex items-center gap-2">
              <button type="button" className={`btn ${bbox ? "btn-primary" : ""}`} onClick={() => setBbox(null)} disabled={!bbox}>
                Clear bbox
              </button>
              <button type="button" className="btn" onClick={() => { setSeverities([]); setCategories([]); setRange(null); setHourCell(null); setSelectedSegment(null); setBbox(null); }}>
                Reset all filters
              </button>
            </div>
          }
          className="min-h-0 flex-1"
          bodyClass="relative min-h-0"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b px-2 py-1.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-1.5">
                <span className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Overlay</span>
                <select value={overlay} onChange={(e) => setOverlay(e.target.value as OverlayKind)}>
                  <option value="none">None — incidents only</option>
                  <option value="nkde">NKDE (network KDE per km)</option>
                  <option value="getis">Network Gi* significance</option>
                  <option value="risk">Empirical Bayes estimate</option>
                  <option value="dbscan">N-DBSCAN hulls + subgraph</option>
                  <option value="truth">Oracle λ (synthetic only)</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Ramp</span>
                <select value={ramp} onChange={(e) => setRamp(e.target.value)}>
                  {["inferno", "viridis", "magma", "plasma", "cividis", "ylorrd", "spectral", "rdbu"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Network</span>
                <select value={networkMode} onChange={(e) => setNetworkMode(e.target.value as any)}>
                  <option value="class">Functional class</option>
                  <option value="exposure">Exposure coverage</option>
                  <option value="plain">Neutral</option>
                </select>
              </div>
              <div className="w-32"><Toggle label="Cluster glyphs" checked={clusterPoints} onChange={setClusterPoints} /></div>
              <div className="w-32"><Toggle label="Junction nodes" checked={showNodes} onChange={setShowNodes} /></div>
              {job.busy && <span className="badge pulse">{job.job?.stage ?? "computing"} {Math.round((job.job?.progress ?? 0) * 100)}%</span>}
              {job.error && <span className="badge" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{job.error}</span>}
            </div>
            <MapCanvas
              layers={layers}
              origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
              fitKey={`${datasetId ?? ""}|${overlay}`}
              brushMode
              brush={bbox}
              onBrush={setBbox}
              onSelect={onMapSelect}
              selectedId={selected ? String(selected.id ?? "") : null}
              className="min-h-0 flex-1"
              legend={
                <div className="flex flex-wrap items-end gap-2">
                  {overlay === "none" && (
                    <CategoricalLegend items={SEVERITY_ORDER.map((c) => ({ label: SEVERITY_LABELS[c], color: severityColor(c), count: stats?.severityMix?.find((s: any) => s.code === c)?.count ?? 0 }))} />
                  )}
                  {(overlay === "nkde" || overlay === "risk") && job.result && (
                    <RampLegend
                      ramp={ramp}
                      min={overlay === "risk" ? 0 : 0}
                      max={maxOfFeature(job.result.features as GeoCollection, overlay === "risk" ? "ebEstimate" : "value")}
                      unit={overlay === "risk" ? "EB expected crashes (lixel)" : "NKDE crashes · km⁻¹"}
                    />
                  )}
                  {overlay === "getis" && job.result && (
                    <CategoricalLegend
                      items={[
                        { label: "Hotspot p<0.01 (FDR)", color: "#d81b60" },
                        { label: "Hotspot p<0.05 (FDR)", color: "#fb8c00" },
                        { label: "Not significant", color: "#4b5a70" },
                        { label: "Coldspot p<0.05", color: "#42a5f5" },
                        { label: "Coldspot p<0.01", color: "#1565c0" },
                      ]}
                    />
                  )}
                  {overlay === "truth" && <RampLegend ramp="viridis" min={0} max={maxOfFeature(job.result?.features as GeoCollection, "trueLambda")} unit="Oracle Λ per lixel" />}
                  {bbox && <div className="mono rounded-[3px] border px-2 py-1 text-[9.5px]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text-dim)" }}>bbox {bbox.map((v) => v.toFixed(4)).join(", ")}</div>}
                </div>
              }
              overlay={
                selected && (
                  <div className="pointer-events-auto max-h-44 overflow-auto rounded-[3px] border p-2 text-[10.5px]" style={{ borderColor: "var(--border-strong)", background: "var(--panel)" }}>
                    <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--accent)" }}>selection</div>
                    <table className="w-full">
                      <tbody>
                        {Object.entries(selected.properties).slice(0, 16).map(([k, v]) => (
                          <tr key={k}>
                            <td className="pr-2" style={{ color: "var(--text-mute)" }}>{k}</td>
                            <td className="mono text-right" style={{ color: "var(--text)" }}>{typeof v === "number" ? fmtCompact(v) : String(v ?? "—").slice(0, 40)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            />
          </div>
        </Panel>

        <div className="grid shrink-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Temporal brush" subtitle={`${bin} bins · drag to cross-filter the map`} bodyClass="p-2">
            <div className="mb-1.5 flex items-center gap-2">
              <Select value={bin} onChange={(v) => setBin(v)} options={[{ value: "day", label: "daily" }, { value: "week", label: "weekly" }, { value: "month", label: "monthly" }]} />
              <span className="mono text-[9.5px]" style={{ color: "var(--text-mute)" }}>Σ {fmt(stats?.totals?.incidents)} · EPDO {fmt(stats?.totals?.epdo)}</span>
            </div>
            <TimeSeriesChart series={(stats?.series ?? []).map((s: any) => ({ label: s.label, count: s.count, epdo: s.epdo }))} range={range} onRangeChange={setRange} ramp="viridis" height={92} />
          </Panel>
          <Panel title="Diurnal / weekly matrix" subtitle="EPDO-weighted · click a cell to isolate" bodyClass="p-2">
            <DiurnalMatrix matrix={stats?.diurnalMatrix ?? []} onCell={(dow, hour) => setHourCell((c) => (c?.dow === dow && c?.hour === hour ? null : { dow, hour }))} selected={hourCell} />
          </Panel>
          <Panel title="Observed vs. EPDO by class" subtitle="Road-class composition of the current subset" bodyClass="p-2">
            <ScatterPlot
              points={(stats?.classMix ?? []).map((c: any) => ({ x: c.count, y: c.count * (c.code === "primary" ? 1.4 : 1), c: c.count, label: `${CLASS_LABELS[c.code] ?? c.code}: ${c.count}` }))}
              xLabel="class count"
              yLabel="weighted"
              ramp="plasma"
              diagonal={false}
              size={86}
            />
          </Panel>
        </div>
      </div>

      {/* ---------------- right rail ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto pr-0.5">
        <Panel title="Attribute cross-filters" subtitle="Bidirectional: charts ⇄ canvas">
          <div className="space-y-2 p-2">
            <div>
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Severity</div>
              <div className="flex flex-wrap gap-1">
                {(stats?.severityMix ?? []).map((s: any) => (
                  <button key={s.code} type="button" className="badge" onClick={() => toggleIn(severities, setSeverities, s.code)} style={{ borderColor: severities.includes(s.code) ? s.color : "var(--border-strong)", color: severities.includes(s.code) ? s.color : "var(--text-mute)" }}>
                    {s.label} · {s.count}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Taxonomy</div>
              <div className="flex flex-wrap gap-1">
                {(stats?.categoryMix ?? []).map((c: any) => (
                  <button key={c.code} type="button" className="badge" onClick={() => toggleIn(categories, setCategories, c.code)} style={{ borderColor: categories.includes(c.code) ? "var(--accent)" : "var(--border-strong)", color: categories.includes(c.code) ? "var(--accent)" : "var(--text-mute)" }}>
                    {c.label} · {c.count}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Verification status</div>
              <div className="flex flex-wrap gap-1">
                {["verified", "triaged", "unverified"].map((s) => (
                  <button key={s} type="button" className="badge" onClick={() => toggleIn(statuses, setStatuses, s)} style={{ borderColor: statuses.includes(s) ? "var(--accent-2)" : "var(--border-strong)", color: statuses.includes(s) ? "var(--accent-2)" : "var(--text-mute)" }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
              <MiniStat label="Fatalities" value={fmt(stats?.totals?.fatalities)} tone="bad" />
              <MiniStat label="Injured" value={fmt(stats?.totals?.injured)} />
              <MiniStat label="Crashes / km / yr" value={fmt(stats?.totals?.incidentsPerKmPerYear, 3)} />
              <MiniStat label="Mean EPDO" value={fmt(stats?.totals?.meanEpdoPerIncident, 2)} />
            </div>
          </div>
        </Panel>

        <Panel title="Environmental covariates" subtitle="Composition of the filtered subset" bodyClass="p-2">
          <div className="space-y-2">
            <BarList items={(stats?.weatherMix ?? []).map((w: any) => ({ key: w.code, label: w.code.replace(/_/g, " "), value: w.count }))} ramp="blues" valueFormat={(v) => fmt(v)} title="Weather state" height={11} />
            <BarList items={(stats?.lightingMix ?? []).map((w: any) => ({ key: w.code, label: w.code.replace(/_/g, " "), value: w.count }))} ramp="purples" valueFormat={(v) => fmt(v)} title="Lighting" height={11} />
            <BarList items={(stats?.trafficMix ?? []).map((w: any) => ({ key: w.code, label: w.code.replace(/_/g, " "), value: w.count }))} ramp="greens" valueFormat={(v) => fmt(v)} title="Traffic state" height={11} />
          </div>
        </Panel>

        <Panel title="Top hazardous segments" subtitle="Click to isolate on the canvas" bodyClass="p-2">
          <BarList
            items={(stats?.topSegments ?? []).slice(0, 14).map((s: any) => ({ key: s.segmentId, label: s.name ?? "—", value: s.epdoPerKm, sub: `${s.roadClass} · ${fmt(s.lengthKm, 2)} km · AADT ${s.aadt ?? "n/a"}`, color: colorFor("ylorrd", 0.2 + (s.epdoPerKm / epdoMax) * 0.75) }))}
            selectedKey={selectedSegment}
            onSelect={(k) => setSelectedSegment(k)}
            valueFormat={(v) => fmt(v, 1)}
          />
        </Panel>

        <Panel title="Filtered subset table" subtitle={`${filteredIncidents?.features.length ?? 0} incidents`} bodyClass="p-0">
          <DataTable
            rows={(filteredIncidents?.features ?? []).slice(0, 200).map((f) => f.properties)}
            rowKey={(r) => String(r.accidentId)}
            maxHeight={230}
            onRowClick={(r) => setSelected({ id: r.accidentId, geometry: { type: "Point", coordinates: [0, 0] }, properties: r } as GeoFeature)}
            columns={[
              { key: "occurredAt", label: "Occurred (UTC)", format: (v) => String(v).slice(0, 16).replace("T", " ") },
              { key: "severityCode", label: "Severity", format: (v) => SEVERITY_LABELS[v] ?? v, tone: (v) => severityColor(v) },
              { key: "categoryLabel", label: "Taxonomy" },
              { key: "status", label: "State" },
              { key: "witnessCount", label: "W", align: "right" },
              { key: "credibilityScore", label: "Cred", align: "right", format: (v) => fmt(v, 1) },
            ]}
          />
        </Panel>

        {overlay !== "none" && job.result && (
          <Panel title="Overlay diagnostics" subtitle={`${job.result.method} · ${fmt(job.result.runtimeMs)} ms · n=${job.result.sampleSize}`}>
            <div className="space-y-1.5 p-2 text-[10.5px]" style={{ color: "var(--text-dim)" }}>
              {Object.entries(job.result.stats ?? {})
                .filter(([k, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
                .slice(0, 22)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="mono" style={{ color: "var(--text-mute)" }}>{k}</span>
                    <span className="mono text-right" style={{ color: "var(--text)" }}>{typeof v === "number" ? fmtCompact(v as number) : String(v).slice(0, 40)}</span>
                  </div>
                ))}
              {job.result.benchmark && (
                <div className="mt-2 border-t pt-1.5" style={{ borderColor: "var(--border)" }}>
                  <Badge tone="info">GROUND-TRUTH BENCHMARK</Badge>
                  <div className="mono mt-1 grid grid-cols-2 gap-x-2 text-[10px]">
                    <span style={{ color: "var(--text-mute)" }}>PAI(10%)</span><span className="text-right">{fmt((job.result.benchmark as any).pai10, 3)}</span>
                    <span style={{ color: "var(--text-mute)" }}>RRI(10%)</span><span className="text-right">{fmt((job.result.benchmark as any).rri10, 3)}</span>
                    <span style={{ color: "var(--text-mute)" }}>RMSE vs λ</span><span className="text-right">{fmt((job.result.benchmark as any).rmseVsLambda, 5)}</span>
                    <span style={{ color: "var(--text-mute)" }}>Spearman ρ</span><span className="text-right">{fmt((job.result.benchmark as any).spearmanVsLambda, 4)}</span>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--border)" }}>
      <div className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>{label}</div>
      <div className="mono text-[13px]" style={{ color: tone === "bad" ? "var(--danger)" : tone === "good" ? "var(--accent-2)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function maxOfFeature(data: GeoCollection | undefined | null, key: string): number {
  if (!data) return 1;
  let max = 0;
  for (const f of data.features) {
    const v = Number(f.properties?.[key] ?? 0);
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max || 1;
}
