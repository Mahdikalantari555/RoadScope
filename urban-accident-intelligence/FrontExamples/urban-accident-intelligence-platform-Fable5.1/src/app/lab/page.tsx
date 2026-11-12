"use client";
import { useEffect, useMemo, useState } from "react";
import type { ExpressionSpecification } from "maplibre-gl";
import MapCanvas, { type FC, type Overlay } from "@/components/MapCanvas";
import { Scatter } from "@/components/charts";
import { Field, Math_, Panel, RampLegend, Slider, Spinner, Stat, Swatches, fmt } from "@/components/ui";
import { useJson, useNetwork, useTheme } from "@/components/hooks";
import { GI_COLORS, ramp } from "@/lib/colors";

type Kind = "nkde" | "gistar" | "ndbscan" | "benchmark";
interface Job { id: number; kind: Kind; status: string; progress: number; params: Record<string, unknown>; runtimeMs: number | null; sampleSize: number | null; error: string | null; createdAt: string }
interface JobRes { job: Job; summary: Record<string, unknown> | null; geojson: FC | null }

const DOC: Record<Kind, { title: string; math: string[]; notes: string }> = {
  nkde: { title: "Network Kernel Density Estimation (lixel NKDE) vs planar KDE", math: ["λ̂_net(l) = Σ_i w_i · (1/h) · K(d_net(l, s_i)/h) · Π_{v∈π(l,s_i)} 1/(deg(v)−1)   [equal-split discontinuous]", "λ̂_planar(l) = Σ_i w_i · (1/h²) · K₂(‖l − s_i‖/h) · (A / L_total)", "K ∈ {Gaussian, Epanechnikov (¾(1−u²)), Quartic (15/16 (1−u²)²)}; d_net via Dijkstra on node graph + LRS offsets"], notes: "Planar KDE leaks mass across non-connected parallel corridors and compounds at dense junctions; the difference map (planar − network) quantifies that distortion per lixel." },
  gistar: { title: "Network-constrained Getis-Ord Gi* and global Moran's I", math: ["G_i* = [Σ_j w_ij x_j − X̄ Σ_j w_ij] / ( S · √{[n Σ_j w_ij² − (Σ_j w_ij)²]/(n−1)} )", "w_ij = exp(−d_net(i,j)² / 2δ²) · 1[d_net ≤ δ]  (self included)", "pseudo-p: conditional permutation (x_i fixed, neighbours drawn without replacement) · BH-FDR → q", "I = (n/S₀) · Σ_i Σ_j w_ij z_i z_j / Σ_i z_i²  with analytical z under normality"], notes: "Assumptions checked before execution: n ≥ 30 lixels, non-zero variance, ≥ 10 non-empty lixels. Descriptive high density ≠ statistical significance: only q < 0.05 / 0.01 classes are reported as hot/cold spots." },
  ndbscan: { title: "Network DBSCAN (N-DBSCAN)", math: ["N_ε(p) = { q : d_net(p, q) ≤ ε }   (shortest-path, not Euclidean disc)", "core(p) ⇔ |N_ε(p)| ≥ minPts; clusters = connected components of core points under reachability"], notes: "Outputs convex hulls (visual only; clusters live on the 1-D network) and the topological subgraph (segment set) of each cluster." },
  benchmark: { title: "Ground-truth benchmarking against the hidden intensity λ(e,m,t)", math: ["RMSE = √(1/n Σ_l (λ̂_l/Σλ̂ − λ_l/Σλ)²)", "PAI = (Σ_{l∈top-X% by λ̂} λ_l·len_l / Σ λ_l·len_l) / (Σ_{top} len_l / L_total)", "RRI = PAI(λ̂) / PAI(oracle ordering by λ)", "ρ_Spearman between predicted and true lixel ranks"], notes: "Synthetic datasets only. The simulator's per-lixel integrated intensity is the ground truth; NKDE, planar KDE and raw lixel counts are evaluated side by side." },
};

export default function LabPage() {
  const { net } = useNetwork(); const theme = useTheme();
  const [kind, setKind] = useState<Kind>("nkde");
  const [p, setP] = useState({ bandwidth: 150, kernel: "gaussian", includeRaw: true, planarCompare: true, severityWeighted: false, delta: 200, weightMode: "gaussian", permutations: 499, variable: "count", eps: 120, minPts: 4, topFraction: 0.1 });
  const { data: jobs, refresh } = useJson<{ jobs: Job[] }>(net?.source ? "/api/analysis/jobs" : null);
  const [sel, setSel] = useState<number | null>(null);
  const [view, setView] = useState<"nkde" | "planar" | "diff">("nkde");
  const { data: res, refresh: refreshRes } = useJson<JobRes>(sel ? `/api/analysis/jobs/${sel}` : null);
  const running = (jobs?.jobs ?? []).some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => { if (!running) return; const t = setInterval(() => { refresh(); if (sel) refreshRes(); }, 800); return () => clearInterval(t); }, [running, refresh, refreshRes, sel]);
  useEffect(() => { if (res?.job.status === "running" || res?.job.status === "queued") { const t = setTimeout(refreshRes, 800); return () => clearTimeout(t); } }, [res, refreshRes]);

  const submit = async () => { const r = await fetch("/api/analysis/jobs", { method: "POST", body: JSON.stringify({ kind, ...p }) }); const d = await r.json(); if (d.ok) { setSel(d.job.id); refresh(); } };

  const vis = useMemo<{ overlays: Overlay[]; legend: React.ReactNode; points?: FC; pointColor?: ExpressionSpecification }>(() => {
    if (!res?.geojson || res.job.status !== "done") return { overlays: [], legend: null };
    const k = res.job.kind; const g = res.geojson; const width: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 9];
    if (k === "gistar") return { overlays: [{ id: "gi", data: g, type: "line", paint: { "line-color": ["match", ["get", "cls"], ...Object.entries(GI_COLORS).flat(), "#4b5563"], "line-width": width, "line-opacity": ["match", ["get", "cls"], "ns", 0.2, 0.95] } }], legend: <Swatches items={[{ color: GI_COLORS.hot99, label: "hot q<0.01" }, { color: GI_COLORS.hot95, label: "hot q<0.05" }, { color: GI_COLORS.hot_uncorrected, label: "p<0.05 only (not FDR-significant)" }, { color: GI_COLORS.cold95, label: "cold q<0.05" }, { color: GI_COLORS.cold99, label: "cold q<0.01" }, { color: GI_COLORS.ns, label: "n.s." }]} /> };
    if (k === "ndbscan") { const hulls: FC = { type: "FeatureCollection", features: g.features.filter((f) => f.properties?.kind === "hull") }; const pts: FC = { type: "FeatureCollection", features: g.features.filter((f) => f.properties?.kind === "point") }; const n = Math.max(1, hulls.features.length); return { overlays: [{ id: "hull", data: hulls, type: "fill", paint: { "fill-color": ["interpolate", ["linear"], ["get", "cluster"], 1, ramp("viridis", 0), n, ramp("viridis", 1)], "fill-opacity": 0.25 } }, { id: "hull-l", data: hulls, type: "line", paint: { "line-color": "#fff", "line-width": 1 } }], points: pts, pointColor: ["case", ["==", ["get", "cluster"], -1], "#555", ["interpolate", ["linear"], ["get", "cluster"], 1, ramp("viridis", 0), n, ramp("viridis", 1)]] as unknown as ExpressionSpecification, legend: <Swatches items={[{ color: "#555", label: "noise", shape: "dot" }, { color: ramp("viridis", 0.5), label: "cluster members (viridis by id)", shape: "dot" }]} /> }; }
    const prop = k === "benchmark" ? (view === "planar" ? "truth" : view === "diff" ? "residual" : "nkde") : view;
    const vals = g.features.map((f) => Number((f.properties as Record<string, number>)[prop] ?? 0)).filter((v) => isFinite(v)).sort((a, b) => a - b);
    const diverging = prop === "diff" || prop === "residual";
    if (diverging) { const a = Math.max(Math.abs(vals[Math.floor(0.02 * vals.length)] ?? 0), Math.abs(vals[Math.floor(0.98 * (vals.length - 1))] ?? 0)) || 1; const stops = Array.from({ length: 9 }, (_, i) => [-a + (2 * a * i) / 8, ramp("rdbu", i / 8)]).flat(); return { overlays: [{ id: "kde", data: g, type: "line", paint: { "line-color": ["interpolate", ["linear"], ["coalesce", ["get", prop], 0], ...stops], "line-width": width } }], legend: <RampLegend name="rdbu" min={-a} max={a} mid="0" label={prop === "diff" ? "Planar − Network KDE (events/km): red = planar overestimates" : "NKDE − truth (normalised residual)"} /> }; }
    const max = vals[Math.floor(0.98 * (vals.length - 1))] || 1; const name = prop === "truth" ? "viridis" : "inferno";
    const stops = Array.from({ length: 6 }, (_, i) => [(i / 5) * max, ramp(name, i / 5)]).flat();
    return { overlays: [{ id: "kde", data: g, type: "line", paint: { "line-color": ["interpolate", ["linear"], ["coalesce", ["get", prop], 0], ...stops], "line-width": width } }], legend: <RampLegend name={name} min={0} max={max} label={`${prop === "truth" ? "Hidden true λ" : prop === "planar" ? "Planar KDE" : "Network KDE"} (events/km, p98 clip)`} /> };
  }, [res, view]);

  const scatter = useMemo(() => { if (!res?.geojson || res.job.kind !== "benchmark" && res.job.kind !== "nkde") return null; const k = res.job.kind; const pts = res.geojson.features.slice(0, 1500).map((f) => { const pr = f.properties as Record<string, number>; return k === "benchmark" ? { x: pr.truth, y: pr.nkde } : { x: pr.nkde, y: pr.planar ?? 0 }; }).filter((p) => isFinite(p.x) && isFinite(p.y)); return { pts, xl: k === "benchmark" ? "true λ (ev/km)" : "NKDE (ev/km)", yl: k === "benchmark" ? "NKDE (ev/km)" : "planar KDE (ev/km)" }; }, [res]);
  const S = (res?.summary ?? {}) as Record<string, unknown>;
  const bm = (key: string) => S[key] as { rmse: number; PAI: number; RRI: number; spearman: number; hitRate: number } | undefined;

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "330px 1fr 360px" }}>
      <aside className="min-h-0 overflow-y-auto border-r p-1.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
        <Panel title="Method">
          <div className="grid grid-cols-2 gap-1">{(["nkde", "gistar", "ndbscan", "benchmark"] as Kind[]).map((k) => <button key={k} className={`btn btn-xs ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>{k === "nkde" ? "NKDE / planar" : k === "gistar" ? "Network Gi*" : k === "ndbscan" ? "N-DBSCAN" : "GT benchmark"}</button>)}</div>
        </Panel>
        <Panel title="Parameters">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={p.includeRaw} onChange={(e) => setP({ ...p, includeRaw: e.target.checked })} /> Include raw VGI (credibility-weighted) — otherwise verified only</label>
            <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={p.severityWeighted} onChange={(e) => setP({ ...p, severityWeighted: e.target.checked })} /> Severity weighting (log EPDO)</label>
            {(kind === "nkde" || kind === "benchmark") && <><Slider label="Network bandwidth h" value={p.bandwidth} min={25} max={600} step={25} unit=" m" onChange={(v) => setP({ ...p, bandwidth: v })} /><Field label="Kernel"><select className="inp" value={p.kernel} onChange={(e) => setP({ ...p, kernel: e.target.value })}><option>gaussian</option><option>epanechnikov</option><option>quartic</option></select></Field></>}
            {kind === "nkde" && <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={p.planarCompare} onChange={(e) => setP({ ...p, planarCompare: e.target.checked })} /> Compute planar KDE comparison + difference map</label>}
            {kind === "gistar" && <><Slider label="Weights distance δ (network)" value={p.delta} min={50} max={600} step={25} unit=" m" onChange={(v) => setP({ ...p, delta: v })} /><Field label="Weight kernel"><select className="inp" value={p.weightMode} onChange={(e) => setP({ ...p, weightMode: e.target.value })}><option value="gaussian">Gaussian decay</option><option value="binary">Binary contiguity (d ≤ δ)</option></select></Field><Field label="Variable"><select className="inp" value={p.variable} onChange={(e) => setP({ ...p, variable: e.target.value })}><option value="count">Lixel crash count</option><option value="nkde">Lixel NKDE (h=100 m)</option></select></Field><Slider label="Permutations" value={p.permutations} min={99} max={999} step={100} onChange={(v) => setP({ ...p, permutations: v })} /></>}
            {kind === "ndbscan" && <><Slider label="ε (network distance)" value={p.eps} min={20} max={500} step={10} unit=" m" onChange={(v) => setP({ ...p, eps: v })} /><Slider label="minPts" value={p.minPts} min={2} max={20} step={1} onChange={(v) => setP({ ...p, minPts: v })} /></>}
            {kind === "benchmark" && <Slider label="Top fraction for PAI" value={p.topFraction} min={0.02} max={0.3} step={0.02} onChange={(v) => setP({ ...p, topFraction: v })} />}
            <button className="btn btn-primary w-full" onClick={submit} disabled={!net?.source || (kind === "benchmark" && net?.source?.kind !== "synthetic")}>Run asynchronously</button>
          </div>
        </Panel>
        <Panel title="Job queue" bodyClass="p-0 max-h-72 overflow-auto"><table className="tbl"><thead><tr><th>#</th><th>Kind</th><th>Status</th><th>n</th><th>ms</th></tr></thead><tbody>{(jobs?.jobs ?? []).map((j) => <tr key={j.id} className={sel === j.id ? "sel" : ""} onClick={() => setSel(j.id)}><td className="mono">{j.id}</td><td>{j.kind}</td><td style={{ color: j.status === "done" ? "var(--ok)" : j.status === "failed" ? "var(--bad)" : "var(--accent)" }}>{j.status}{j.status === "running" && ` ${(j.progress * 100).toFixed(0)}%`}</td><td className="mono">{j.sampleSize ?? ""}</td><td className="mono">{j.runtimeMs ?? ""}</td></tr>)}</tbody></table></Panel>
      </aside>
      <MapCanvas segments={net?.segments} segmentOpacity={vis.overlays.length ? 0.35 : 0.9} overlays={vis.overlays} points={vis.points ?? null} pointColor={vis.pointColor} pointRadius={4} fitBbox={net?.bbox ?? null} theme={theme}
        hoverHtml={(l, pr) => (["kde", "gi"].includes(l) ? `<b>Lixel #${pr.lixelId}</b> · seg ${pr.segmentId}<br/>${Object.entries(pr).filter(([k]) => !["lixelId", "segmentId"].includes(k)).map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(3) : v}`).join("<br/>")}` : l === "hull" ? `Cluster ${pr.cluster} · ${pr.size} events · ${pr.segments} segments` : null)}>
        <div className="absolute top-2 left-2 panel p-2 w-64 space-y-1">
          {res?.job.kind === "nkde" && <div className="flex gap-1">{(["nkde", "planar", "diff"] as const).map((v) => <button key={v} className={`btn btn-xs flex-1 ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)} disabled={v !== "nkde" && !res.job.params.planarCompare}>{v === "nkde" ? "Network" : v === "planar" ? "Planar" : "Δ map"}</button>)}</div>}
          {res?.job.kind === "benchmark" && <div className="flex gap-1">{(["nkde", "planar", "diff"] as const).map((v) => <button key={v} className={`btn btn-xs flex-1 ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>{v === "nkde" ? "NKDE" : v === "planar" ? "True λ" : "Residual"}</button>)}</div>}
          {vis.legend ?? <div className="text-[11px]" style={{ color: "var(--fg-2)" }}>Run or select a completed job to render its lixel layer.</div>}
          {res && res.job.status !== "done" && <Spinner label={`job #${res.job.id} ${res.job.status} ${(res.job.progress * 100).toFixed(0)}%`} />}
          {res?.job.error && <div style={{ color: "var(--bad)" }}>{res.job.error}</div>}
        </div>
      </MapCanvas>
      <aside className="min-h-0 overflow-y-auto border-l p-1.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
        <Panel title={DOC[res?.job.kind ?? kind].title}><div className="text-[11px]">{DOC[res?.job.kind ?? kind].math.map((m) => <Math_ key={m}>{m}</Math_>)}<p style={{ color: "var(--fg-1)" }}>{DOC[res?.job.kind ?? kind].notes}</p></div></Panel>
        {res?.job.status === "done" && <>
          {res.job.kind === "benchmark" && <Panel title="Recovery of the true risk surface"><table className="tbl"><thead><tr><th>Layer</th><th>RMSE</th><th>PAI</th><th>RRI</th><th>ρ</th><th>hit</th></tr></thead><tbody>{(["nkde", "planar", "rawCounts"] as const).map((k) => { const b = bm(k); return b ? <tr key={k}><td>{k === "rawCounts" ? "lixel counts" : k === "nkde" ? "Network KDE" : "Planar KDE"}</td><td className="mono">{b.rmse.toExponential(2)}</td><td className="mono">{fmt(b.PAI)}</td><td className="mono">{fmt(b.RRI)}</td><td className="mono">{fmt(b.spearman)}</td><td className="mono">{(b.hitRate * 100).toFixed(0)}%</td></tr> : null; })}</tbody></table><div className="text-[10px] mt-1" style={{ color: "var(--fg-2)" }}>Top {((S.topFraction as number) * 100).toFixed(0)}% of network length. RRI = 1 means oracle-level targeting.</div></Panel>}
          {res.job.kind === "gistar" && <><div className="panel grid grid-cols-3"><Stat label="Moran's I" value={fmt(S.moranI as number, 3)} sub={`z = ${fmt(S.moranZ as number, 1)}`} /><Stat label="Hot q<0.05" value={`${(S.hot95 as number) + (S.hot99 as number)}`} sub={`${S.hot99} at q<0.01`} tone="bad" /><Stat label="Cold q<0.05" value={`${(S.cold95 as number) + (S.cold99 as number)}`} sub={`${S.hotUncorrected} p<0.05 uncorrected`} /></div><Panel title="Assumption checks"><dl className="kv">{Object.entries((S.assumptions as Record<string, unknown>) ?? {}).map(([k, v]) => <><dt key={k + "k"}>{k}</dt><dd key={k + "v"} style={{ color: v === false ? "var(--bad)" : v === true ? "var(--ok)" : undefined }}>{String(v)}</dd></>)}</dl></Panel></>}
          {res.job.kind === "nkde" && <div className="panel grid grid-cols-3"><Stat label="NKDE max" value={fmt(S.nkdeMax as number, 1)} sub="events/km" /><Stat label="NKDE p95" value={fmt(S.nkdeP95 as number, 1)} /><Stat label="Planar overest." value={S.planarOverestimationShare != null ? `${((S.planarOverestimationShare as number) * 100).toFixed(0)}%` : "—"} sub="lixels where planar > 1.25× network" tone="warn" /></div>}
          {res.job.kind === "ndbscan" && <Panel title="Clusters (topological subgraphs)" bodyClass="max-h-56 overflow-auto p-0"><table className="tbl"><thead><tr><th>Cluster</th><th>Events</th><th>Segments</th></tr></thead><tbody>{((S.clusterTable as { cluster: number; size: number; segments: number[] }[]) ?? []).map((c) => <tr key={c.cluster}><td className="mono">{c.cluster}</td><td className="mono">{c.size}</td><td className="mono">{c.segments.join(", ")}</td></tr>)}</tbody></table><div className="p-1 text-[10px]" style={{ color: "var(--fg-2)" }}>{String(S.noise)} noise points.</div></Panel>}
          {scatter && <Panel title={res.job.kind === "benchmark" ? "Predicted vs true (per lixel)" : "Network vs planar (per lixel)"}><Scatter pts={scatter.pts} xl={scatter.xl} yl={scatter.yl} identity /></Panel>}
          <Panel title="Provenance & export">
            <dl className="kv"><dt>Job</dt><dd>#{res.job.id} · {res.job.kind}</dd><dt>Sample size</dt><dd>{res.job.sampleSize}</dd><dt>Runtime</dt><dd>{res.job.runtimeMs} ms</dd><dt>CRS (compute)</dt><dd>local metric plane (m)</dd><dt>CRS (export)</dt><dd>EPSG:4326 / CRS84</dd><dt>Params</dt><dd className="whitespace-normal text-left">{JSON.stringify(res.job.params)}</dd><dt>Created</dt><dd>{res.job.createdAt.slice(0, 19)}Z</dd></dl>
            <div className="flex gap-1 mt-2"><a className="btn btn-xs" href={`/api/analysis/jobs/${res.job.id}?format=geojson`}>↓ GeoJSON layer</a><a className="btn btn-xs" href={`/api/analysis/jobs/${res.job.id}?format=csv`}>↓ CSV table</a></div>
          </Panel>
        </>}
      </aside>
    </div>
  );
}
