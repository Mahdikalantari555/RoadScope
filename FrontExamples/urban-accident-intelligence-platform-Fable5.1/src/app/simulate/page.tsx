"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Math_, Panel, Slider, SyntheticTag, fmt } from "@/components/ui";
import { useJson } from "@/components/hooks";

interface Src { id: number; name: string; kind: string; scenario: string | null; seed: number | null; isActive: boolean; createdAt: string; reports: number; lixels: number; segments: number; params: Record<string, unknown> }
const SCEN = [
  ["uniform", "Uniform baseline", "Homogeneous Poisson on the network: λ constant per metre. Null model — any detected hotspot is a false positive."],
  ["intersection", "Intersection-clustered", "λ elevated near junctions of degree ≥ 3 via Gaussian decay (σ = 30 m) along the edge; no temporal structure."],
  ["diurnal", "Diurnal rush-hour shock", "Adds AM/PM Gaussian peaks (08:00, 17:30), night suppression, weekend attenuation."],
  ["complex", "Multi-covariate complex urban", "Road hierarchy × AADT^0.6 exposure × intersection proximity × sinuosity × weather risk × seasonal wave + one elevated arterial corridor."],
] as const;

export default function SimulatePage() {
  const router = useRouter();
  const { data, refresh } = useJson<{ sources: Src[]; defaults: Record<string, number | string> }>("/api/simulate");
  const [p, setP] = useState({ scenario: "complex", seed: 42, lixelResolution: 25, gridCols: 9, gridRows: 8, spacingM: 230, days: 90, expectedEvents: 650, positionalSigmaM: 12, falseAlarmRate: 0.06, lagMeanMin: 25, intersectionAlpha: 3.5, preVerifiedFraction: 0.55 });
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<Record<string, unknown> | null>(null);
  const run = async () => { setBusy(true); setRes(null); const r = await fetch("/api/simulate", { method: "POST", body: JSON.stringify(p) }); const d = await r.json(); setRes(d); setBusy(false); refresh(); if (d.ok) setTimeout(() => router.refresh(), 100); };
  const activate = async (id: number) => { await fetch("/api/simulate", { method: "PATCH", body: JSON.stringify({ sourceId: id }) }); refresh(); router.refresh(); };

  return (
    <div className="h-full overflow-y-auto p-2 grid gap-2" style={{ gridTemplateColumns: "360px 1fr" }}>
      <div className="space-y-2">
        <Panel title="Scenario · inhomogeneous network point process">
          <div className="space-y-1">{SCEN.map(([k, label, desc]) => <label key={k} className="block p-1.5 rounded cursor-pointer" style={{ background: p.scenario === k ? "var(--bg-3)" : "transparent", border: "1px solid var(--line)" }}><div className="flex items-center gap-2 text-[11.5px]"><input type="radio" checked={p.scenario === k} onChange={() => setP({ ...p, scenario: k })} /><b>{label}</b></div><div className="text-[10.5px] pl-5" style={{ color: "var(--fg-2)" }}>{desc}</div></label>)}</div>
        </Panel>
        <Panel title="Network & lixel parameters"><div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5"><Field label="Seed"><input type="number" className="inp" value={p.seed} onChange={(e) => setP({ ...p, seed: Number(e.target.value) })} /></Field><Field label="Lixel resolution (m)"><select className="inp" value={p.lixelResolution} onChange={(e) => setP({ ...p, lixelResolution: Number(e.target.value) })}>{[10, 25, 50].map((v) => <option key={v} value={v}>{v} m</option>)}</select></Field></div>
          <Slider label="Grid columns" value={p.gridCols} min={4} max={12} step={1} onChange={(v) => setP({ ...p, gridCols: v })} /><Slider label="Grid rows" value={p.gridRows} min={4} max={12} step={1} onChange={(v) => setP({ ...p, gridRows: v })} /><Slider label="Block spacing" value={p.spacingM} min={120} max={400} step={10} unit=" m" onChange={(v) => setP({ ...p, spacingM: v })} />
        </div></Panel>
        <Panel title="Point-process & VGI noise parameters"><div className="space-y-1.5">
          <Slider label="Study period" value={p.days} min={14} max={365} step={1} unit=" d" onChange={(v) => setP({ ...p, days: v })} /><Slider label="E[N] true events" value={p.expectedEvents} min={50} max={3000} step={50} onChange={(v) => setP({ ...p, expectedEvents: v })} /><Slider label="Intersection effect α" value={p.intersectionAlpha} min={0} max={10} step={0.5} onChange={(v) => setP({ ...p, intersectionAlpha: v })} />
          <Slider label="Positional drift σ" value={p.positionalSigmaM} min={0} max={60} step={1} unit=" m" onChange={(v) => setP({ ...p, positionalSigmaM: v })} /><Slider label="False-alarm rate" value={p.falseAlarmRate} min={0} max={0.5} step={0.01} onChange={(v) => setP({ ...p, falseAlarmRate: v })} /><Slider label="Reporting lag mean" value={p.lagMeanMin} min={0} max={600} step={5} unit=" min" onChange={(v) => setP({ ...p, lagMeanMin: v })} /><Slider label="Pre-verified fraction" value={p.preVerifiedFraction} min={0} max={1} step={0.05} onChange={(v) => setP({ ...p, preVerifiedFraction: v })} />
          <button className="btn btn-primary w-full" disabled={busy} onClick={run}>{busy ? "Realising point process…" : "Generate synthetic dataset (becomes active)"}</button>
          {res && <div className="text-[11px] p-1.5 rounded mono" style={{ background: "var(--bg-2)", color: res.ok ? "var(--ok)" : "var(--bad)" }}>{res.ok ? `source #${res.sourceId} · ${res.nodes} nodes · ${res.segments} segments · ${res.lixels} lixels · ${res.trueEvents} true events → ${res.reports} VGI reports (${res.falseAlarms} false alarms) · ${res.runtimeMs} ms` : String(res.error)}</div>}
        </div></Panel>
      </div>
      <div className="space-y-2">
        <Panel title="Ground-truth model">
          <div className="text-[11px] space-y-1" style={{ color: "var(--fg-1)" }}>
            <Math_>λ(e, m, t) = c · ρ_class(e) · (AADT_e/8000)^0.6 · [1 + α·1[deg≥3]·exp(−d_int(m)²/2·30²)] · [1 + 2.5·exp(−‖s−s_c‖²/2·260²)] · (1 + 2(ς_e − 1)) · f_T(t) · f_W(t)</Math_>
            <Math_>f_T(t) = [1 + 1.8·N(h;8,1.2) + 2.2·N(h;17.5,1.5)] · night(h) · weekend(dow) · [1 + 0.25 sin(2πt/yr)]</Math_>
            <p>Normalising constant c is fixed so that ∫λ = E[N]. Per lixel we store the integrated intensity Λ_l = λ_l·len_l (hidden truth), draw N_l ~ Poisson(Λ_l), place each event uniformly in m within the lixel and sample t by thinning against f_T·f_W. This is an inhomogeneous spatiotemporal Poisson process on the linear network (a Cox process when weather is treated as a random driver).</p>
            <p><b>VGI injection.</b> Each true event emits 1 + Poisson(κ_sev) witness reports (κ = 2.2 serious/fatal, 0.5 minor, 0.15 PDO); each report is drifted by 2-D Gaussian noise N(0, σ²) off the centreline, lagged by Exp(mean lag), given a reporter σ ∈ {"{10, 15, 25, 50, 100}"} m, probabilistically map-matched, and a share is pre-verified. False alarms (no true event) are injected at rate r_FA·N. Every synthetic row carries <span className="tag tag-syn">is_synthetic</span>.</p>
            <p><b>Exposure gaps.</b> 14% of segments deliberately lack AADT so exposure-aware metrics expose epistemic uncertainty instead of silently imputing.</p>
          </div>
        </Panel>
        <Panel title="Dataset sources" bodyClass="p-0">
          <table className="tbl"><thead><tr><th>#</th><th>Name</th><th>Kind</th><th>Scenario</th><th>Seed</th><th>Segments</th><th>Lixels</th><th>Reports</th><th>Lixel res.</th><th>Created</th><th></th></tr></thead><tbody>
            {(data?.sources ?? []).map((s) => <tr key={s.id} className={s.isActive ? "sel" : ""}><td className="mono">{s.id}</td><td>{s.name}</td><td><SyntheticTag kind={s.kind} /></td><td>{s.scenario}</td><td className="mono">{s.seed}</td><td className="mono">{s.segments}</td><td className="mono">{s.lixels}</td><td className="mono">{s.reports}</td><td className="mono">{String(s.params?.lixelResolution ?? "")} m</td><td className="mono">{s.createdAt.slice(0, 16)}</td><td>{s.isActive ? <span className="tag">active</span> : <button className="btn btn-xs" onClick={() => activate(s.id)}>activate</button>}</td></tr>)}
          </tbody></table>
          {data && !data.sources.length && <div className="p-2" style={{ color: "var(--fg-2)" }}>No datasets yet — generate one on the left.</div>}
        </Panel>
        <Panel title="Reproducibility"><div className="text-[11px]" style={{ color: "var(--fg-1)" }}>All randomness flows from a single Mulberry32 seed (uniform → Box–Muller Gaussian → Knuth/normal Poisson → exponential). Identical parameters reproduce identical networks, lixels, events, VGI noise and map-matching results. The hidden intensity is stored per lixel (<span className="mono">road_lixels.true_intensity</span>, events·m⁻¹ over the period = {fmt(p.expectedEvents / 1000, 2)}k expected total) and is consumed only by the benchmark evaluator.</div></Panel>
      </div>
    </div>
  );
}
