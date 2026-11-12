"use client";
import { useMemo, useState } from "react";
import type { ExpressionSpecification } from "maplibre-gl";
import MapCanvas, { type FC } from "@/components/MapCanvas";
import { Scatter } from "@/components/charts";
import { Math_, Panel, RampLegend, Slider, Stat, Swatches, fmt } from "@/components/ui";
import { useJson, useNetwork, useTheme } from "@/components/hooks";
import { bivariate, ramp } from "@/lib/colors";

interface Seg { segmentId: number; roadClass: string; lengthM: number; aadt: number | null; speedLimit: number; lanes: number; sinuosity: number; maxDegree: number; n: number; nVerified: number; nRaw: number; density: number; epdo: number; ratePerMVKT: number | null; spfMu: number; ebExpected: number; ebWeight: number; psi: number; ebVar: number; ebCI: [number, number]; geomHazard: number; envHazard: number; composite: number; rank: number; uncertainty: number; coverageFlags: string[] }
interface Resp { source: { kind: string }; spf: Record<string, { a: number; b: number; phi: number; nFit: number }>; segments: Seg[]; geojson: FC; note: string }
type Metric = "n" | "density" | "epdo" | "ratePerMVKT" | "ebExpected" | "psi" | "composite" | "uncertainty";
const METRICS: { k: Metric; label: string; unit: string; desc: string }[] = [
  { k: "n", label: "Raw frequency N", unit: "crashes", desc: "Credibility-weighted count of reports on the segment (verified = 1, raw = credibility)." },
  { k: "density", label: "Linear density N/L", unit: "crashes/km", desc: "Count normalised by segment length — controls for the variable-length edge MAUP." },
  { k: "epdo", label: "EPDO index", unit: "EPDO", desc: "Σ severity weights (PDO 1 · minor 3.5 · serious 25 · fatal 150)." },
  { k: "ratePerMVKT", label: "Rate per MVKT", unit: "crashes/MVKT", desc: "Exposure-normalised: N / (AADT · days · L_km / 10⁶). Undefined where AADT is missing." },
  { k: "ebExpected", label: "EB expected", unit: "crashes", desc: "Empirical Bayes: w·μ_SPF + (1−w)·N with w = 1/(1+μ/φ). Corrects regression-to-the-mean." },
  { k: "psi", label: "PSI (excess)", unit: "crashes", desc: "Potential for Safety Improvement = EB − μ_SPF. Positive → performs worse than similar roads." },
  { k: "composite", label: "MCDA priority", unit: "index 0–1", desc: "Weighted heuristic index (EB, severity, geometry, environment). NOT a calibrated probability." },
  { k: "uncertainty", label: "Uncertainty layer", unit: "0–1", desc: "Epistemic coverage: sample sparsity, missing AADT, raw-VGI share." },
];

export default function RiskPage() {
  const { net } = useNetwork(); const theme = useTheme();
  const [w, setW] = useState({ eb: 0.45, severity: 0.25, geometry: 0.15, environment: 0.15 });
  const [includeRaw, setIncludeRaw] = useState(true); const [metric, setMetric] = useState<Metric>("ebExpected"); const [biv, setBiv] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const url = net?.source ? `/api/risk?includeRaw=${includeRaw}&w_eb=${w.eb}&w_severity=${w.severity}&w_geometry=${w.geometry}&w_environment=${w.environment}` : null;
  const { data, loading } = useJson<Resp>(url);
  const segs = data?.segments ?? [];
  const selected = segs.find((s) => s.segmentId === sel) ?? null;

  const geo = useMemo<FC | null>(() => { if (!data) return null; const vals = segs.map((s) => Number(s[metric] ?? 0)).filter((v) => isFinite(v)).sort((a, b) => a - b); const max = vals[Math.floor(0.97 * (vals.length - 1))] || 1; const min = metric === "psi" ? vals[Math.floor(0.03 * vals.length)] : 0; return { type: "FeatureCollection", features: data.geojson.features.map((f) => { const p = f.properties as unknown as Seg; const v = p[metric] as number | null; const t = v === null || v === undefined ? null : Math.max(0, Math.min(1, (v - min) / (max - min || 1))); return { ...f, properties: { ...f.properties, color: t === null ? "#333" : biv && metric !== "uncertainty" ? bivariate(t, p.uncertainty) : ramp(metric === "uncertainty" ? "magma" : metric === "psi" ? "rdbu" : "inferno", metric === "uncertainty" ? 1 - t : t), t, max, min } }; }) }; }, [data, segs, metric, biv]);
  const stats = geo?.features[0]?.properties as { max?: number; min?: number } | undefined;
  const colorExpr: ExpressionSpecification = ["coalesce", ["get", "color"], "#333"];
  const widthExpr: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 10];
  const M = METRICS.find((m) => m.k === metric)!;

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "300px 1fr 400px" }}>
      <aside className="min-h-0 overflow-y-auto border-r p-1.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
        <Panel title="Metric tier"><div className="space-y-0.5">{METRICS.map((m) => <button key={m.k} className={`btn btn-xs w-full text-left ${metric === m.k ? "btn-primary" : ""}`} onClick={() => setMetric(m.k)}>{m.label} <span style={{ opacity: 0.6 }}>· {m.unit}</span></button>)}</div><p className="text-[10.5px] mt-1" style={{ color: "var(--fg-1)" }}>{M.desc}</p></Panel>
        <Panel title="Data scope"><label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} /> Include raw VGI (credibility-weighted)</label><label className="flex items-center gap-2 text-[11px] mt-1"><input type="checkbox" checked={biv} onChange={(e) => setBiv(e.target.checked)} /> Bivariate risk × uncertainty (desaturate uncertain)</label></Panel>
        <Panel title="MCDA weights · live sensitivity"><div className="space-y-1.5"><Slider label="EB expected crashes" value={w.eb} min={0} max={1} step={0.05} onChange={(v) => setW({ ...w, eb: v })} /><Slider label="Severity (EPDO)" value={w.severity} min={0} max={1} step={0.05} onChange={(v) => setW({ ...w, severity: v })} /><Slider label="Geometric hazard" value={w.geometry} min={0} max={1} step={0.05} onChange={(v) => setW({ ...w, geometry: v })} /><Slider label="Environmental covariates" value={w.environment} min={0} max={1} step={0.05} onChange={(v) => setW({ ...w, environment: v })} /></div><div className="text-[10px] mt-1 p-1 rounded" style={{ background: "var(--bg-2)", color: "var(--warn)" }}>⚠ {data?.note ?? "Composite is a heuristic priority index, not a calibrated crash probability."}</div></Panel>
        <Panel title="Safety Performance Functions (fitted)"><Math_>μ = a · L_km · AADT^b ; φ = 1/k (NB dispersion, moments)</Math_><table className="tbl"><thead><tr><th>Class</th><th>a</th><th>b</th><th>φ</th><th>n_fit</th></tr></thead><tbody>{Object.entries(data?.spf ?? {}).map(([c, f]) => <tr key={c}><td>{c}</td><td className="mono">{f.a.toExponential(2)}</td><td className="mono">{fmt(f.b)}</td><td className="mono">{fmt(f.phi, 1)}</td><td className="mono">{f.nFit}</td></tr>)}</tbody></table><Math_>EB = w·μ + (1−w)·N, w = 1/(1+μ/φ) · PSI = EB − μ · Var(EB) = (1−w)·EB</Math_></Panel>
      </aside>
      <MapCanvas segments={geo ?? net?.segments} segmentColor={colorExpr} segmentWidth={widthExpr} selectedSegmentIds={sel ? [sel] : []} fitBbox={net?.bbox ?? null} theme={theme} onSegmentClick={(id) => setSel(id === sel ? null : id)}
        hoverHtml={(l, pr) => (l === "segments" ? `<b>Segment #${pr.segmentId ?? pr.id}</b> · rank ${pr.rank}<br/>${M.label}: ${pr[metric] == null ? "n/a" : Number(pr[metric]).toFixed(2)} ${M.unit}<br/>N=${Number(pr.n).toFixed(1)} · EB=${Number(pr.ebExpected).toFixed(2)} [${Number(pr.ebLo).toFixed(1)}, ${Number(pr.ebHi).toFixed(1)}]<br/>uncertainty ${Number(pr.uncertainty).toFixed(2)} ${pr.coverageFlags ? "· " + pr.coverageFlags : ""}` : null)}>
        <div className="absolute top-2 left-2 panel p-2 w-64 space-y-1">
          <div className="text-[11px] font-medium">{M.label} {loading && <span className="animate-pulse" style={{ color: "var(--accent)" }}>· recomputing</span>}</div>
          <RampLegend name={metric === "uncertainty" ? "magma" : metric === "psi" ? "rdbu" : "inferno"} min={stats?.min ?? 0} max={stats?.max ?? 1} label={`${M.unit} (p97 clip)`} />
          {biv && metric !== "uncertainty" && <div className="text-[10px]" style={{ color: "var(--fg-1)" }}>Bivariate: saturation ∝ confidence. <div className="flex gap-[2px] mt-0.5">{[0, 0.25, 0.5, 0.75, 1].map((u) => <div key={u} className="flex flex-col gap-[2px]">{[1, 0.66, 0.33, 0.05].map((r) => <div key={r} className="w-5 h-2" style={{ background: bivariate(r, u) }} />)}<span className="text-[8px] mono">u={u}</span></div>)}</div></div>}
          <Swatches items={[{ color: "#333", label: "metric undefined (no exposure data)" }]} />
        </div>
      </MapCanvas>
      <aside className="min-h-0 overflow-y-auto border-l p-1.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
        {selected && <Panel title={`Segment #${selected.segmentId} · rank ${selected.rank}`} right={<button className="btn btn-xs" onClick={() => setSel(null)}>×</button>}>
          <dl className="kv"><dt>Class / speed / lanes</dt><dd>{selected.roadClass} · {selected.speedLimit} km/h · {selected.lanes}</dd><dt>Length / sinuosity / deg</dt><dd>{fmt(selected.lengthM, 0)} m · {fmt(selected.sinuosity, 3)} · {selected.maxDegree}</dd><dt>AADT</dt><dd>{selected.aadt ?? <span style={{ color: "var(--warn)" }}>missing → class median</span>}</dd><dt>N (verified / raw)</dt><dd>{fmt(selected.n, 1)} ({selected.nVerified} / {selected.nRaw})</dd><dt>Density</dt><dd>{fmt(selected.density, 1)} /km</dd><dt>EPDO</dt><dd>{fmt(selected.epdo, 0)}</dd><dt>Rate</dt><dd>{selected.ratePerMVKT != null ? fmt(selected.ratePerMVKT) + " /MVKT" : "n/a"}</dd><dt>μ_SPF</dt><dd>{fmt(selected.spfMu)}</dd><dt>EB weight w</dt><dd>{fmt(selected.ebWeight)}</dd><dt>EB expected</dt><dd>{fmt(selected.ebExpected)} [{fmt(selected.ebCI[0], 1)}, {fmt(selected.ebCI[1], 1)}]</dd><dt>PSI</dt><dd style={{ color: selected.psi > 0 ? "var(--bad)" : "var(--ok)" }}>{fmt(selected.psi)}</dd><dt>Geometric / env hazard</dt><dd>{fmt(selected.geomHazard)} / {fmt(selected.envHazard)}</dd><dt>Composite</dt><dd>{fmt(selected.composite, 3)}</dd><dt>Uncertainty</dt><dd>{fmt(selected.uncertainty)} {selected.coverageFlags.join(", ")}</dd></dl>
        </Panel>}
        <div className="panel grid grid-cols-3"><Stat label="Segments" value={segs.length} sub={`${segs.filter((s) => !s.aadt).length} without AADT`} /><Stat label="Σ PSI > 0" value={fmt(segs.reduce((a, s) => a + Math.max(0, s.psi), 0), 1)} sub="excess crashes" tone="warn" /><Stat label="Top-10 share" value={segs.length ? `${((segs.slice(0, 10).reduce((a, s) => a + s.n, 0) / Math.max(1, segs.reduce((a, s) => a + s.n, 0))) * 100).toFixed(0)}%` : "—"} sub="of crashes on top-10 corridors" /></div>
        <Panel title="Observed N vs EB expected (shrinkage)"><Scatter pts={segs.map((s) => ({ x: s.n, y: s.ebExpected, c: s.roadClass === "arterial" ? "#f2b55e" : s.roadClass === "collector" ? "#5ec8f2" : "#7d8795" }))} xl="observed N" yl="EB expected" identity /><Swatches items={[{ color: "#f2b55e", label: "arterial", shape: "dot" }, { color: "#5ec8f2", label: "collector", shape: "dot" }, { color: "#7d8795", label: "local", shape: "dot" }]} /><div className="text-[10px]" style={{ color: "var(--fg-2)" }}>Points below the diagonal on the right are short-term spikes shrunk toward the SPF prior (RTM correction).</div></Panel>
        <Panel title="Ranked corridor priority table" right={<a className="btn btn-xs" href={`${url ?? "/api/risk"}&format=csv`}>↓ CSV</a>} bodyClass="p-0 max-h-[40vh] overflow-auto">
          <table className="tbl"><thead><tr><th>Rank</th><th>Seg</th><th>Class</th><th>N</th><th>EB</th><th>PSI</th><th>EPDO</th><th>Rate</th><th>Index</th><th>Unc.</th></tr></thead><tbody>
            {segs.slice(0, 60).map((s) => <tr key={s.segmentId} className={sel === s.segmentId ? "sel" : ""} onClick={() => setSel(s.segmentId)}><td className="mono">{s.rank}</td><td className="mono">{s.segmentId}</td><td>{s.roadClass}</td><td className="mono">{fmt(s.n, 1)}</td><td className="mono">{fmt(s.ebExpected, 1)}</td><td className="mono" style={{ color: s.psi > 0 ? "var(--bad)" : "var(--ok)" }}>{fmt(s.psi, 1)}</td><td className="mono">{fmt(s.epdo, 0)}</td><td className="mono">{s.ratePerMVKT != null ? fmt(s.ratePerMVKT, 1) : "—"}</td><td className="mono">{fmt(s.composite, 3)}</td><td className="mono" style={{ color: s.uncertainty > 0.5 ? "var(--warn)" : undefined }}>{fmt(s.uncertainty)}</td></tr>)}
          </tbody></table>
        </Panel>
      </aside>
    </div>
  );
}
