"use client";
import { useEffect, useMemo, useState } from "react";
import MapCanvas, { type FC } from "@/components/MapCanvas";
import { Field, Panel, Swatches, SyntheticTag, fmt } from "@/components/ui";
import { useNetwork, useTheme, sevColor, fmtDate } from "@/components/hooks";

interface Cand { segmentId: number; roadClass: string; m: number; distanceM: number; posterior: number; lonlat: [number, number]; nearJunctionNodeId: number | null }
interface Match { id: number; dNetM: number; dtMin: number; kernel: number; status: string; severityId: number; categoryId: number; occurredAt: string; witnessCount: number; credibility: number; lon: number; lat: number }

const circle = (lon: number, lat: number, r: number, color: string): GeoJSON.Feature => { const k = Math.cos((lat * Math.PI) / 180); const pts: [number, number][] = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push([lon + ((r * Math.cos(a)) / (111320 * k)), lat + (r * Math.sin(a)) / 110574]); } return { type: "Feature", properties: { color }, geometry: { type: "Polygon", coordinates: [pts] } }; };

export default function ReportPage() {
  const { net } = useNetwork(); const theme = useTheme();
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [unc, setUnc] = useState(15);
  const [occurredAt, setOccurredAt] = useState(() => new Date(Date.now() - 20 * 60e3).toISOString().slice(0, 16));
  const [form, setForm] = useState({ categoryId: 0, severityId: 0, vehicles: 2, pedestrians: 0, emergencyPresent: false, weather: "clear", lighting: "daylight", description: "" });
  const [files, setFiles] = useState<{ filename: string; mimeType: string; sizeBytes: number }[]>([]);
  const [cands, setCands] = useState<Cand[]>([]); const [matches, setMatches] = useState<Match[]>([]); const [chosen, setChosen] = useState<number | null>(null);
  const [coordInput, setCoordInput] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; id?: number; error?: string; snap?: { segmentId: number; offsetM: number; distanceM: number; posterior: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (net && !form.categoryId && net.categories.length) setForm((f) => ({ ...f, categoryId: net.categories[0].id, severityId: net.severities[0].id })); }, [net, form.categoryId]);

  useEffect(() => {
    if (!pin) return; const ctl = new AbortController();
    fetch("/api/accidents/nearby", { method: "POST", body: JSON.stringify({ lon: pin[0], lat: pin[1], occurredAt: new Date(occurredAt).toISOString(), uncertaintyRadiusM: unc }), signal: ctl.signal }).then((r) => r.json()).then((d) => { setCands(d.candidates ?? []); setMatches(d.matches ?? []); setChosen(d.candidates?.[0]?.segmentId ?? null); }).catch(() => {});
    return () => ctl.abort();
  }, [pin, occurredAt, unc]);

  const markers = useMemo<FC>(() => { if (!pin) return { type: "FeatureCollection", features: [] }; const f: GeoJSON.Feature[] = [circle(pin[0], pin[1], unc, "#f2b55e"), { type: "Feature", properties: { color: "#f2b55e", radius: 6 }, geometry: { type: "Point", coordinates: pin } }]; for (const c of cands) { f.push({ type: "Feature", properties: { color: c.segmentId === chosen ? "#4ade80" : "#5ec8f2", radius: c.segmentId === chosen ? 6 : 4 }, geometry: { type: "Point", coordinates: c.lonlat } }); f.push({ type: "Feature", properties: { color: c.segmentId === chosen ? "#4ade80" : "#5ec8f2" }, geometry: { type: "LineString", coordinates: [pin, c.lonlat] } }); } for (const m of matches) f.push({ type: "Feature", properties: { color: "#ef4444", radius: 7 }, geometry: { type: "Point", coordinates: [m.lon, m.lat] } }); return { type: "FeatureCollection", features: f }; }, [pin, unc, cands, chosen, matches]);

  const submit = async () => {
    if (!pin) return; setBusy(true); setResult(null);
    const r = await fetch("/api/accidents", { method: "POST", body: JSON.stringify({ lon: pin[0], lat: pin[1], uncertaintyRadiusM: unc, occurredAt: new Date(occurredAt).toISOString(), ...form, attachments: files, chosenSegmentId: chosen }) });
    setResult(await r.json()); setBusy(false);
  };
  const corroborate = async (id: number) => { setBusy(true); const r = await fetch(`/api/accidents/${id}`, { method: "POST", body: JSON.stringify({ action: "corroborate", categoryId: form.categoryId, severityId: form.severityId, vehicles: form.vehicles }) }); const d = await r.json(); setResult({ ok: d.ok, id, error: d.error }); setBusy(false); setPin([...pin!]); };
  const sevById = new Map((net?.severities ?? []).map((s) => [s.id, s])); const catById = new Map((net?.categories ?? []).map((c) => [c.id, c]));

  return (
    <div className="h-full grid" style={{ gridTemplateColumns: "1fr 400px" }}>
      <MapCanvas segments={net?.segments} markers={markers} fitBbox={net?.bbox ?? null} theme={theme} onMapClick={(ll) => { setPin(ll); setResult(null); }} onSegmentClick={(_, pr) => { /* segment click also places the pin */ void pr; }}
        hoverHtml={(l, pr) => (l === "segments" ? `Segment #${pr.id} · ${pr.roadClass}` : null)}>
        <div className="absolute top-2 left-2 panel p-2 w-64 space-y-1 text-[11px]">
          <div><b>1.</b> Click the map to pin the incident location.</div>
          <Swatches items={[{ color: "#f2b55e", label: "raw click + σ radius", shape: "dot" }, { color: "#5ec8f2", label: "snap candidates", shape: "dot" }, { color: "#4ade80", label: "chosen snap", shape: "dot" }, { color: "#ef4444", label: "possible duplicate", shape: "dot" }]} />
          <div className="flex gap-1"><input className="inp" placeholder="lon, lat" value={coordInput} onChange={(e) => setCoordInput(e.target.value)} /><button className="btn btn-xs" onClick={() => { const [a, b] = coordInput.split(",").map(Number); if (!isNaN(a) && !isNaN(b)) setPin([a, b]); }}>Go</button></div>
          {pin && <div className="mono text-[10px]">raw: {pin[0].toFixed(6)}, {pin[1].toFixed(6)}</div>}
        </div>
      </MapCanvas>
      <aside className="min-h-0 overflow-y-auto border-l p-1.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
        <Panel title="Positional uncertainty & map-matching" right={<SyntheticTag kind={net?.source?.kind} />}>
          <Field label={`Observation radius σ = ${unc} m`} hint="Your confidence in the pinned location. Raw coordinates are preserved; snapping is probabilistic."><input type="range" min={5} max={200} step={5} value={unc} onChange={(e) => setUnc(Number(e.target.value))} className="w-full" /></Field>
          {cands.length > 0 && <table className="tbl mt-1"><thead><tr><th></th><th>Segment</th><th>Class</th><th>d⊥ (m)</th><th>m (m)</th><th>P(snap)</th></tr></thead><tbody>{cands.map((c) => <tr key={c.segmentId} className={chosen === c.segmentId ? "sel" : ""} onClick={() => setChosen(c.segmentId)}><td><input type="radio" checked={chosen === c.segmentId} readOnly /></td><td className="mono">#{c.segmentId}{c.nearJunctionNodeId ? " ⌖" : ""}</td><td>{c.roadClass}</td><td className="mono">{fmt(c.distanceM, 1)}</td><td className="mono">{fmt(c.m, 1)}</td><td className="mono">{fmt(c.posterior)}</td></tr>)}</tbody></table>}
          {pin && !cands.length && <div style={{ color: "var(--warn)" }}>No road within 80 m — move the pin closer to the network.</div>}
        </Panel>
        {matches.length > 0 && <Panel title="⚠ Spatiotemporal conflation alert" className="border-amber-500/50">
          <div className="text-[11px] mb-1" style={{ color: "var(--fg-1)" }}>Existing reports within Δd<sub>net</sub> ≤ 250 m along the network and Δt ≤ 90 min. Corroborate one if it is the same incident (raises its multi-witness trust) or submit a distinct report.</div>
          <table className="tbl"><thead><tr><th>#</th><th>d_net</th><th>Δt</th><th>κ</th><th>Severity</th><th>Status</th><th>W</th><th></th></tr></thead><tbody>{matches.map((m) => <tr key={m.id}><td className="mono">{m.id}</td><td className="mono">{m.dNetM} m</td><td className="mono">{m.dtMin} min</td><td className="mono">{m.kernel}</td><td style={{ color: sevColor(sevById.get(m.severityId)?.code) }}>{sevById.get(m.severityId)?.label}</td><td>{m.status}</td><td className="mono">{m.witnessCount}</td><td><button className="btn btn-xs" disabled={busy} onClick={() => corroborate(m.id)}>Corroborate</button></td></tr>)}</tbody></table>
        </Panel>}
        <Panel title="Incident attributes">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Incident time (UTC)"><input type="datetime-local" className="inp" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></Field>
            <Field label="Reporting time"><input className="inp" disabled value={fmtDate(new Date())} /></Field>
            <Field label="Accident type"><select className="inp" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}>{net?.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
            <Field label="Severity"><select className="inp" value={form.severityId} onChange={(e) => setForm({ ...form, severityId: Number(e.target.value) })}>{net?.severities.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
            <Field label="Vehicles"><input type="number" min={0} max={20} className="inp" value={form.vehicles} onChange={(e) => setForm({ ...form, vehicles: Number(e.target.value) })} /></Field>
            <Field label="Pedestrians"><input type="number" min={0} max={20} className="inp" value={form.pedestrians} onChange={(e) => setForm({ ...form, pedestrians: Number(e.target.value) })} /></Field>
            <Field label="Weather"><select className="inp" value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })}>{["clear", "cloudy", "rain", "fog", "snow"].map((w) => <option key={w}>{w}</option>)}</select></Field>
            <Field label="Lighting"><select className="inp" value={form.lighting} onChange={(e) => setForm({ ...form, lighting: e.target.value })}>{["daylight", "dusk_dawn", "dark"].map((w) => <option key={w}>{w}</option>)}</select></Field>
          </div>
          <label className="flex items-center gap-2 mt-1.5 text-[11px]"><input type="checkbox" checked={form.emergencyPresent} onChange={(e) => setForm({ ...form, emergencyPresent: e.target.checked })} /> Emergency services present</label>
          <Field label="Narrative"><textarea className="inp" rows={2} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Media attachments (metadata only; EXIF/GPS stripped client-side)"><input type="file" multiple accept="image/*,video/*" className="inp" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5).map((f) => ({ filename: f.name, mimeType: f.type, sizeBytes: f.size })))} /></Field>
          <div className="flex items-center gap-2 mt-2"><button className="btn btn-primary" disabled={!pin || !chosen || busy} onClick={submit}>{busy ? "Submitting…" : "Submit as Unverified / Raw VGI"}</button><span className="text-[10px]" style={{ color: "var(--fg-2)" }}>Coordinates, time-sanity and envelope checks enforced server-side.</span></div>
          {result && <div className="mt-2 text-[11px] p-2 rounded" style={{ background: "var(--bg-2)", color: result.ok ? "var(--ok)" : "var(--bad)" }}>{result.ok ? <>Accepted · report #{result.id} · status <b>raw</b>{result.snap && <> · snapped to segment #{result.snap.segmentId} @ m={fmt(result.snap.offsetM, 1)} (d⊥ {fmt(result.snap.distanceM, 1)} m, P={fmt(result.snap.posterior)})</>}</> : result.error}</div>}
        </Panel>
        <Panel title="Why this matters"><div className="text-[11px] space-y-1" style={{ color: "var(--fg-1)" }}><p>Citizen reports are noisy VGI: positional drift, time lag and duplicate witnesses. The system stores your <i>raw</i> click and σ, computes a posterior over candidate road edges (Gaussian distance × road-class prior × junction topology), and assigns a linear-reference offset <span className="mono">m</span> on the chosen edge.</p><p>Your report enters the steward triage queue as <span className="tag">Unverified / Raw VGI</span> and never pollutes verified analytical layers until reviewed.</p>{catById.size === 0 && <p>Loading lookups…</p>}</div></Panel>
      </aside>
    </div>
  );
}
