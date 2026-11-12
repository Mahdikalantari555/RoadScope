"use client";

/**
 * Epic 3 — VGI quality assurance, topological map-matching and stewardship.
 * Triage queue, candidate-snap inspection, credibility decomposition, lifecycle
 * transitions with RBAC + immutable audit trail, and macro data-quality
 * diagnostics with strict synthetic/empirical separation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Field, Kpi, Panel, Select, Slider, Tabs } from "@/components/ui";
import { BarList, DataTable, Histogram, ScatterPlot } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, apiPost, fmt, fmtDate, type GeoCollection } from "@/lib/clientApi";
import { networkLayer, severityColor } from "@/lib/ui";
import { colorFor } from "@/lib/util/colors";

type Tab = "queue" | "quality" | "audit";

export default function StewardshipPage() {
  const { dataset, datasetId, role } = useApp();
  const [tab, setTab] = useState<Tab>("queue");
  const [reports, setReports] = useState<any[]>([]);
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [selected, setSelected] = useState<any>(null);
  const [status, setStatus] = useState("unverified,triaged");
  const [sort, setSort] = useState<"recent" | "credibility" | "drift">("recent");
  const [quality, setQuality] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [conflate, setConflate] = useState({ networkDistanceM: 160, timeWindowMinutes: 120, kernelThreshold: 0.34 });
  const [conflateResult, setConflateResult] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    if (!datasetId) return;
    const qs = new URLSearchParams({ datasetId, status, sort, limit: "400" });
    const [r, q, a] = await Promise.all([
      apiGet<{ reports: any[] }>(`/api/reports?${qs.toString()}`, role).catch(() => ({ reports: [] })),
      apiGet<any>(`/api/datasets/${datasetId}/quality`, role).catch(() => null),
      apiGet<{ entries: any[] }>(`/api/audit?datasetId=${datasetId}&limit=60`, role).catch(() => ({ entries: [] })),
    ]);
    setReports(r.reports);
    setQuality(q);
    setAudit(a.entries);
  }, [datasetId, status, sort, role]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!datasetId) return;
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=1`, role).then((r) => setNetwork(r.geojson)).catch(() => undefined);
  }, [datasetId, role]);

  const act = useCallback(
    async (action: string, extra?: Record<string, unknown>) => {
      if (!selected) return;
      setBusy(true);
      setMessage(null);
      try {
        const res = await apiPost<any>(`/api/reports/${selected.id}/verify`, { action, reason, ...extra }, role);
        setMessage(`${action} → ${res.toStatus} · credibility ${fmt(res.credibility?.score, 1)} · witnesses ${res.witnessesInCluster}`);
        setReason("");
        await loadQueue();
        const next = reports.find((r) => r.id !== selected.id);
        setSelected(next ?? null);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [selected, reason, role, loadQueue, reports],
  );

  const runConflate = useCallback(
    async (apply: boolean) => {
      if (!datasetId) return;
      setBusy(true);
      try {
        const res = await apiPost<any>("/api/reports/conflate", { datasetId, apply, ...conflate }, role);
        setConflateResult(res);
        setMessage(apply ? `Conflation applied: ${res.duplicateReportsMerged} duplicates merged into ${res.clusterCount} clusters` : `Preview: ${res.clusterCount} clusters, ${res.duplicateReportsMerged} duplicates`);
        if (apply) await loadQueue();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [datasetId, conflate, role, loadQueue],
  );

  const mapLayers = useMemo<MapLayerSpec[]>(() => {
    const layers: MapLayerSpec[] = [networkLayer(network, "plain", 0.55)];
    layers.push({
      id: "queue",
      data: {
        type: "FeatureCollection",
        features: reports.slice(0, 400).map((r) => ({
          type: "Feature",
          id: r.id,
          geometry: { type: "Point", coordinates: r.rawPosition?.lonLat ?? [0, 0] },
          properties: { kind: "raw_vgi", id: r.id, status: r.status, severity: r.severity?.code, credibility: r.credibilityScore, drift: r.injectedDriftM },
        })),
      },
      visible: true,
      zIndex: 10,
      opacity: 0.55,
      stroke: (p) => (p.status === "rejected" ? "#6b7a90" : severityColor(p.severity)),
      radius: () => 2.2,
      pickable: true,
    });
    if (selected) {
      const feats: any[] = [];
      if (selected.rawPosition?.lonLat)
        feats.push({ type: "Feature", id: `${selected.id}-raw`, geometry: { type: "Point", coordinates: selected.rawPosition.lonLat }, properties: { kind: "raw_observation", drift: selected.injectedDriftM, accuracy: selected.positionalAccuracyM } });
      if (selected.snappedPosition?.lonLat)
        feats.push({ type: "Feature", id: `${selected.id}-snap`, geometry: { type: "Point", coordinates: selected.snappedPosition.lonLat }, properties: { kind: "network_snap", residual: selected.snapPerpDistanceM, posterior: selected.snapPosterior, lixel: selected.lixelId, m: selected.mOffset } });
      const candidatePoints = (selected.mapMatch?.candidates ?? []).map((c: any) => ({
        type: "Feature",
        id: `cand-${c.lixelId}`,
        geometry: { type: "Point", coordinates: (c.lonLat ?? [0, 0]) as [number, number] },
        properties: { kind: "candidate", roadClass: c.roadClass, perpDistanceM: c.perpDistanceM, posterior: c.posterior, classPrior: c.classPrior, topologyBonus: c.topologyBonus, m: c.m },
      }));
      layers.push({
        id: "focus",
        data: { type: "FeatureCollection", features: [...feats.slice(0, 2), ...candidatePoints] },
        visible: true,
        zIndex: 16,
        stroke: (p) => (p.kind === "raw_observation" ? "#f06292" : p.kind === "network_snap" ? "#7bd88f" : "#4cc9f0"),
        fill: (p) => (p.kind === "candidate" ? "rgba(76,201,240,0.55)" : p.kind === "raw_observation" ? "#f06292" : "#7bd88f"),
        radius: (p) => (p.kind === "candidate" ? 3 + p.posterior * 6 : 5.5),
        width: () => 1,
        pickable: true,
      });
      if (selected.rawPosition?.lonLat && selected.snappedPosition?.lonLat) {
        layers.push({
          id: "drift-vector",
          data: { type: "FeatureCollection", features: [{ type: "Feature", id: "dv", geometry: { type: "LineString", coordinates: [selected.rawPosition.lonLat, selected.snappedPosition.lonLat] }, properties: { kind: "drift_vector", metres: selected.snapPerpDistanceM } }] },
          visible: true,
          zIndex: 15,
          stroke: () => "#f0a35e",
          width: () => 1.6,
          dashed: true,
          pickable: false,
        });
      }
    }
    return layers;
  }, [network, reports, selected]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Kpi label="Reports" value={fmt(quality?.volumes?.reports)} hint={`${fmt(quality?.volumes?.canonicalIncidents)} canonical incidents`} />
          <Kpi label="Verification rate" value={`${fmt(quality?.rates?.verificationRatePct)} %`} tone="good" />
          <Kpi label="Rejection rate" value={`${fmt(quality?.rates?.rejectionRatePct)} %`} tone="bad" />
          <Kpi label="False alarms" value={`${fmt(quality?.rates?.falseAlarmRatePct)} %`} tone="warn" hint={fmt(quality?.volumes?.falseAlarms)} />
          <Kpi label="Witness duplication" value={`${fmt(quality?.rates?.duplicationRatePct)} %`} hint={`${fmt(quality?.volumes?.witnessReports)} duplicate reports`} />
          <Kpi label="Lattice coverage" value={`${fmt(quality?.volumes?.coveragePct)} %`} hint={`${fmt(quality?.volumes?.lixelsWithAtLeastOneIncident)} / ${fmt(quality?.volumes?.lixelCount)} lixels`} />
        </div>

        <Panel
          title="Triage queue"
          subtitle="Unverified VGI never enters a confirmed analytical layer without explicit steward action"
          right={
            <div className="flex items-center gap-2">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="unverified,triaged">open (unverified + triaged)</option>
                <option value="unverified">unverified only</option>
                <option value="triaged">triaged only</option>
                <option value="corroborated">corroborated</option>
                <option value="verified">verified</option>
                <option value="rejected">rejected</option>
                <option value="merged">merged duplicates</option>
                <option value="all">all states</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as any)}>
                <option value="recent">sort: most recent</option>
                <option value="credibility">sort: credibility</option>
                <option value="drift">sort: snap residual</option>
              </select>
              <Badge tone="info">{reports.length} rows</Badge>
            </div>
          }
          className="min-h-0 flex-1"
          bodyClass="p-0"
        >
          <DataTable
            rows={reports}
            rowKey={(r) => r.id}
            selectedKey={selected?.id ?? null}
            onRowClick={(r) => setSelected(r)}
            maxHeight={260}
            columns={[
              { key: "occurrenceTime", label: "Occurred (UTC)", format: (v) => fmtDate(v) },
              { key: "severity", label: "Severity", format: (v) => v?.label ?? "—", tone: (v) => severityColor(v?.code) },
              { key: "roadName", label: "Matched edge", format: (v, r) => `${v ?? "—"} · ${r.roadClass ?? ""}` },
              { key: "snapPerpDistanceM", label: "Residual", align: "right", format: (v) => `${fmt(v, 1)} m`, tone: (v) => (v > 40 ? "var(--danger)" : v > 20 ? "var(--warn)" : undefined) },
              { key: "snapPosterior", label: "P(edge)", align: "right", format: (v) => fmt(v, 3), tone: (v) => (v < 0.5 ? "var(--warn)" : undefined) },
              { key: "reportingLagSeconds", label: "Lag", align: "right", format: (v) => `${fmt(v / 60, 1)} min` },
              { key: "credibilityScore", label: "Credibility", align: "right", format: (v) => fmt(v, 1) },
              { key: "status", label: "State", tone: (v) => (v === "verified" ? "var(--accent-2)" : v === "rejected" ? "var(--danger)" : v === "merged" ? "var(--text-mute)" : "var(--warn)") },
              { key: "isFalseAlarm", label: "Alarm", align: "right", format: (v) => (v ? "FALSE" : "") , tone: (v) => (v ? "var(--danger)" : undefined) },
            ]}
          />
        </Panel>

        <Panel title="Stewardship workspace" subtitle="Lifecycle, conflation and diagnostics" className="min-h-[300px]" bodyClass="flex min-h-0 flex-col">
          <div className="px-2 pt-2">
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { value: "queue", label: "Conflation" },
                { value: "quality", label: "Data quality" },
                { value: "audit", label: "Audit trail" },
              ]}
            />
          </div>
          {tab === "queue" && (
            <div className="grid grid-cols-1 gap-3 p-2.5 lg:grid-cols-2">
              <div className="space-y-2">
                <Slider label="Network kernel Δd" value={conflate.networkDistanceM} min={40} max={600} step={10} unit="m" onChange={(v) => setConflate({ ...conflate, networkDistanceM: v })} />
                <Slider label="Temporal kernel Δt*" value={conflate.timeWindowMinutes} min={10} max={720} step={10} unit="min" onChange={(v) => setConflate({ ...conflate, timeWindowMinutes: v })} />
                <Slider label="Linkage threshold θ" value={conflate.kernelThreshold} min={0.1} max={0.9} step={0.01} onChange={(v) => setConflate({ ...conflate, kernelThreshold: v })} format={(v) => v.toFixed(2)} />
                <div className="mono rounded-[3px] border p-2 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
                  K(i,j) = exp(−(d_net/Δd)²) · exp(−|Δt|/Δt*) · agreement(i,j) ≥ θ
                </div>
                <div className="flex gap-1">
                  <button type="button" className="btn flex-1" onClick={() => void runConflate(false)} disabled={busy}>Preview clusters</button>
                  <button type="button" className="btn btn-primary flex-1" onClick={() => void runConflate(true)} disabled={busy}>Merge duplicates</button>
                </div>
              </div>
              <div className="space-y-2">
                {conflateResult ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Kpi label="Clusters" value={fmt(conflateResult.clusterCount)} />
                      <Kpi label="Duplicates merged" value={fmt(conflateResult.duplicateReportsMerged)} tone="good" />
                      <Kpi label="Duplication rate" value={`${fmt(conflateResult.duplicationRate)} %`} />
                      <Kpi label="Mean credibility" value={fmt(conflateResult.meanCredibility, 1)} />
                    </div>
                    <BarList
                      title="Cluster size distribution"
                      items={(conflateResult.clusterSizeHistogram ?? []).map((h: any) => ({ key: String(h.size), label: `${h.size === 6 ? "≥6" : h.size} witness${h.size > 1 ? "es" : ""}`, value: h.count }))}
                      ramp="viridis"
                      valueFormat={(v) => fmt(v)}
                    />
                    <DataTable
                      rows={conflateResult.largestClusters ?? []}
                      rowKey={(r) => r.clusterId}
                      maxHeight={130}
                      columns={[
                        { key: "clusterId", label: "cluster" },
                        { key: "size", label: "n", align: "right" },
                        { key: "credibility", label: "cred", align: "right", format: (v) => fmt(v, 1) },
                        { key: "meanNetworkDistanceM", label: "d_net", align: "right", format: (v) => `${fmt(v, 0)} m` },
                        { key: "timeRangeMinutes", label: "Δt", align: "right", format: (v) => `${fmt(v, 0)} min` },
                        { key: "severityAgreement", label: "agree", align: "right", format: (v) => fmt(v, 2) },
                      ]}
                    />
                  </>
                ) : (
                  <div className="text-[11px]" style={{ color: "var(--text-mute)" }}>
                    Configure the spatiotemporal network decay kernel and run a preview. Single-linkage union-find over K ≥ θ groups likely
                    multi-witness duplicates; the canonical report is retained and children keep an immutable audit trail.
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === "quality" && quality && (
            <div className="grid grid-cols-1 gap-3 p-2.5 lg:grid-cols-2">
              <div className="space-y-2">
                <Histogram title="Injected positional drift (oracle)" bins={quality.positionalQuality.driftHistogram} ramp="cividis" />
                <Histogram title="Reporting lag (log bins)" bins={quality.temporalQuality.lagHistogram.map((b: any) => ({ bucket: b.bucketSeconds + " s", count: b.count }))} ramp="plasma" />
                <Histogram title="Map-match posterior P(edge|m)" bins={quality.positionalQuality.snapPosteriorHistogram} ramp="viridis" />
              </div>
              <div className="space-y-2">
                <ScatterPlot
                  points={(quality.positionalQuality.byRoadClass ?? []).map((b: any, i: number) => ({ x: b.meanPosterior, y: b.meanResidualM, c: b.reports, label: `${b.roadClass}: n=${b.reports}, residual=${fmt(b.meanResidualM, 1)} m, P=${fmt(b.meanPosterior, 3)}` }))}
                  xLabel="mean posterior"
                  yLabel="mean residual (m)"
                  ramp="magma"
                  colorBy={{ min: 0, max: Math.max(1, ...quality.positionalQuality.byRoadClass.map((b: any) => b.reports)) }}
                  diagonal={false}
                  size={120}
                />
                <DataTable
                  rows={quality.positionalQuality.byRoadClass ?? []}
                  rowKey={(r) => r.roadClass}
                  maxHeight={150}
                  columns={[
                    { key: "roadClass", label: "Road class" },
                    { key: "reports", label: "reports", align: "right" },
                    { key: "meanResidualM", label: "residual (m)", align: "right", format: (v) => fmt(v, 2) },
                    { key: "meanPosterior", label: "P(edge|m)", align: "right", format: (v) => fmt(v, 3) },
                  ]}
                />
                <div className="rounded-[3px] border p-2 text-[10.5px] leading-snug" style={{ borderColor: "var(--warn)", color: "var(--text-dim)" }}>
                  <Badge tone="warn">{quality.provenance.synthetic ? "SYNTHETIC" : "EMPIRICAL"}</Badge>
                  <div className="mt-1">{quality.provenance.separationNote}</div>
                </div>
              </div>
            </div>
          )}
          {tab === "audit" && (
            <div className="scroll-thin max-h-[300px] overflow-auto p-0">
              <table className="data">
                <thead><tr><th>UTC</th><th>actor</th><th>entity</th><th>action</th><th>severity</th><th>payload</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td className="mono">{new Date(a.at).toISOString().slice(5, 19).replace("T", " ")}</td>
                      <td>{a.actorRole}</td>
                      <td className="mono">{a.entity}</td>
                      <td className="mono" style={{ color: "var(--text)" }}>{a.action}</td>
                      <td style={{ color: a.severity === "warning" ? "var(--warn)" : a.severity === "critical" ? "var(--danger)" : "var(--text-mute)" }}>{a.severity}</td>
                      <td className="mono text-[9.5px]" style={{ color: "var(--text-mute)" }}>{JSON.stringify(a.after ?? {}).slice(0, 110)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ---------------- inspector ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto">
        <Panel title="Map-matching inspection" subtitle="Probabilistic snap, not naive nearest-neighbour" className="min-h-[300px]" bodyClass="relative">
          <MapCanvas
            layers={mapLayers}
            origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
            fitKey={`${datasetId ?? ""}|${selected?.id ?? ""}`}
            className="h-[300px] w-full"
            onSelect={(f) => {
              if (f && String(f.id ?? "").length > 4) {
                const hit = reports.find((r) => r.id === String(f.id));
                if (hit) setSelected(hit);
              }
            }}
            legend={
              <div className="rounded-[3px] border px-2 py-1.5 text-[10px]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text-dim)" }}>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#f06292" }} /> raw VGI observation</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#7bd88f" }} /> network snap (edge, m)</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#4cc9f0" }} /> candidate snaps (size ∝ posterior)</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-3 w-3" style={{ background: "#f0a35e", height: 2 }} /> orthogonal residual vector</div>
              </div>
            }
          />
        </Panel>

        <Panel title="Report inspector" subtitle={selected ? `${selected.id} · ${selected.status}` : "select a report from the queue"}>
          {!selected ? (
            <div className="p-4 text-[11px]" style={{ color: "var(--text-mute)" }}>
              The inspector decomposes the map-matching posterior P(e,m|z) ∝ 𝒩(d⊥;0,σ²)·π_class(e)·τ_topo and the six-facet credibility score.
            </div>
          ) : (
            <div className="space-y-2.5 p-2.5">
              <div className="grid grid-cols-2 gap-2 text-[10.5px]">
                <Info k="Occurred" v={fmtDate(selected.occurrenceTime)} />
                <Info k="Reported" v={fmtDate(selected.reportedTime)} />
                <Info k="Lag" v={`${fmt(selected.reportingLagSeconds / 60, 1)} min`} />
                <Info k="Declared accuracy" v={`±${fmt(selected.positionalAccuracyM, 0)} m`} />
                <Info k="Injected drift (oracle)" v={selected.injectedDriftM !== null ? `${fmt(selected.injectedDriftM, 1)} m` : "n/a"} />
                <Info k="Snap residual" v={`${fmt(selected.snapPerpDistanceM, 2)} m`} tone={selected.snapPerpDistanceM > 35 ? "bad" : "good"} />
                <Info k="Severity (reported)" v={selected.severity?.label ?? "—"} />
                <Info k="Taxonomy" v={selected.category?.label ?? "—"} />
                <Info k="Matched edge" v={`${selected.roadName ?? "—"} (${selected.roadClass ?? "—"})`} />
                <Info k="Linear offset m" v={`${fmt(selected.mOffset, 2)} m`} />
                <Info k="Lixel" v={<span className="mono">{String(selected.lixelId ?? "—").slice(-10)}</span>} />
                <Info k="Contributor" v={`${selected.contributor?.name ?? "—"}${selected.contributor?.synthetic ? " (synthetic)" : ""}`} />
              </div>
              {selected.narrative && <div className="rounded-[3px] border p-2 text-[10.5px] italic" style={{ borderColor: "var(--border)", color: "var(--text-dim)" }}>“{selected.narrative}”</div>}

              <div>
                <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Candidate snaps — posterior decomposition</div>
                <DataTable
                  rows={(selected.mapMatch?.candidates ?? []) as any[]}
                  rowKey={(r: any) => `${r.segmentId}-${r.m}`}
                  maxHeight={132}
                  columns={[
                    { key: "roadClass", label: "class" },
                    { key: "perpDistanceM", label: "d⊥ (m)", align: "right", format: (v) => fmt(v, 2) },
                    { key: "classPrior", label: "π_class", align: "right", format: (v) => fmt(v, 3) },
                    { key: "topologyBonus", label: "τ_topo", align: "right", format: (v) => fmt(v, 3) },
                    { key: "posterior", label: "P(e,m|z)", align: "right", format: (v) => fmt(v, 4), tone: (v) => (v > 0.6 ? "var(--accent-2)" : v < 0.3 ? "var(--warn)" : undefined) },
                    { key: "m", label: "m", align: "right", format: (v) => fmt(v, 1) },
                  ]}
                />
                <div className="mono mt-1 flex gap-3 text-[9.5px]" style={{ color: "var(--text-mute)" }}>
                  <span>σ = {fmt(selected.mapMatch?.sigmaM, 1)} m</span>
                  <span>H = {fmt(selected.mapMatch?.entropyNats, 3)} nats</span>
                  <span>ambiguity = {fmt(selected.mapMatch?.ambiguity, 3)}</span>
                </div>
              </div>

              {selected.credibility && (
                <div>
                  <div className="mb-1 text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>VGI credibility decomposition · total {fmt(selected.credibilityScore, 1)}</div>
                  <BarList
                    items={Object.entries(selected.credibility)
                      .filter(([k]) => k !== "total")
                      .map(([k, v]) => ({ key: k, label: k.replace(/([A-Z])/g, " $1").toLowerCase(), value: (v as number) * 100, color: colorFor("viridis", (v as number) ?? 0) }))}
                    valueFormat={(v) => `${v.toFixed(0)}%`}
                    height={11}
                  />
                </div>
              )}

              <Field label="Reason (recorded in the immutable audit trail)">
                <input type="text" className="w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. corroborated by two independent witnesses at the same node" />
              </Field>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act("verify")}>Verify</button>
                <button type="button" className="btn" disabled={busy} onClick={() => void act("reject")}>Reject</button>
                <button type="button" className="btn" disabled={busy} onClick={() => void act("flag")}>Flag for triage</button>
                <button type="button" className="btn" disabled={busy} onClick={() => void act("reopen")}>Reopen</button>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={""}
                  onChange={() => undefined}
                  options={[{ value: "", label: "merge into canonical report…" }, ...reports.filter((r) => r.id !== selected.id && r.accidentId).slice(0, 12).map((r) => ({ value: r.id, label: `${r.id.slice(-6)} · ${fmtDate(r.occurrenceTime)} · ${r.severity?.label ?? ""}` }))]}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const target = reports.find((r) => r.id !== selected.id && r.accidentId === selected.accidentId);
                    if (target) void act("merge", { mergedIntoReportId: target.id });
                  }}
                >
                  Merge duplicate
                </button>
              </div>
              {message && <div className="mono rounded-[3px] border p-2 text-[10.5px]" style={{ borderColor: "var(--border)", color: message.includes("error") || message.includes("403") ? "var(--danger)" : "var(--accent-2)" }}>{message}</div>}
              <div className="text-[10px] leading-snug" style={{ color: "var(--text-mute)" }}>
                Active persona: <span className="mono">{role}</span>. Verification requires <span className="mono">report:verify</span>; merging requires{" "}
                <span className="mono">report:merge</span>. Every transition is written to <span className="mono">report_verifications</span> and{" "}
                <span className="mono">audit_logs</span> with before/after state.
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Info({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>{k}</div>
      <div className="text-[11px]" style={{ color: tone === "good" ? "var(--accent-2)" : tone === "bad" ? "var(--danger)" : "var(--text)" }}>{v}</div>
    </div>
  );
}

