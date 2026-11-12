"use client";

/**
 * Epic 2 — Uncertainty-aware citizen reporting (VGI acquisition).
 * Raw click provenance is preserved, positional uncertainty is captured
 * explicitly, structured attribution is validated server-side, and a
 * real-time spatiotemporal *network* conflation alert offers corroboration
 * before a duplicate incident is created.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { Badge, Field, Panel, Select, Slider, Toggle } from "@/components/ui";
import { DataTable, RampLegend } from "@/components/charts";
import { MapCanvas, type MapLayerSpec } from "@/components/MapCanvas";
import { apiGet, apiPost, fmt, fmtDate, type GeoCollection } from "@/lib/clientApi";
import { networkLayer, severityColor } from "@/lib/ui";

const SEVERITIES = [
  { value: "fatal", label: "Fatal — someone died" },
  { value: "serious_injury", label: "Serious injury — ambulance needed" },
  { value: "minor_injury", label: "Minor injury" },
  { value: "property_damage", label: "Vehicle damage only" },
  { value: "near_miss", label: "Near miss / conflict" },
];
const CATEGORIES = [
  { value: "rear_end", label: "Rear-end collision" },
  { value: "right_angle", label: "Right-angle / side impact" },
  { value: "sideswipe", label: "Sideswipe" },
  { value: "pedestrian_struck", label: "Pedestrian struck" },
  { value: "cyclist_struck", label: "Cyclist struck" },
  { value: "single_vehicle", label: "Single vehicle run-off" },
  { value: "rollover", label: "Rollover" },
  { value: "fixed_object", label: "Fixed object impact" },
];
const WEATHER = [
  { value: "", label: "Not reported" },
  { value: "clear", label: "Clear" },
  { value: "rain_light", label: "Light rain" },
  { value: "rain_heavy", label: "Heavy rain" },
  { value: "fog", label: "Fog" },
  { value: "snow", label: "Snow" },
  { value: "ice", label: "Ice" },
];
const LIGHTING = [
  { value: "", label: "Not reported" },
  { value: "daylight", label: "Daylight" },
  { value: "dusk", label: "Dawn / dusk" },
  { value: "night_lit", label: "Darkness, street lit" },
  { value: "night_unlit", label: "Darkness, unlit" },
];

export default function ReportPage() {
  const { dataset, datasetId, role } = useApp();
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [incidents, setIncidents] = useState<GeoCollection | null>(null);
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [accuracy, setAccuracy] = useState(15);
  const [occurredAt, setOccurredAt] = useState(() => new Date(Date.now() - 15 * 60000).toISOString().slice(0, 16));
  const [severity, setSeverity] = useState("property_damage");
  const [category, setCategory] = useState("rear_end");
  const [weather, setWeather] = useState("");
  const [lighting, setLighting] = useState("");
  const [trafficState, setTrafficState] = useState("unknown");
  const [vehicles, setVehicles] = useState(2);
  const [pedestrians, setPedestrians] = useState(0);
  const [injured, setInjured] = useState(0);
  const [fatalities, setFatalities] = useState(0);
  const [emergency, setEmergency] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [device, setDevice] = useState<"mobile_app" | "web_form" | "in_vehicle">("web_form");
  const [consent, setConsent] = useState(true);
  const [attachments, setAttachments] = useState<Array<{ filename: string; mimeType: string; bytes: number; sha256: string }>>([]);
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [candidateMeta, setCandidateMeta] = useState<any>(null);
  const [corroborate, setCorroborate] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!datasetId) return;
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=0`, role).then((r) => setNetwork(r.geojson)).catch(() => undefined);
    apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/incidents?limit=3000&status=verified,triaged,unverified`, role)
      .then((r) => setIncidents(r.geojson))
      .catch(() => undefined);
  }, [datasetId, role]);

  // US-2.3 — real-time conflation alert on every pin/time change.
  useEffect(() => {
    if (!datasetId || !pin) {
      setCandidates(null);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await apiPost<any>("/api/reports/candidates", {
          datasetId,
          lon: pin[0],
          lat: pin[1],
          occurrenceTime: new Date(occurredAt).toISOString(),
          networkDistanceM: 220,
          timeWindowMinutes: 120,
        });
        setCandidates(res.candidates);
        setCandidateMeta(res);
      } catch {
        setCandidates([]);
      }
    }, 420);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [datasetId, pin, occurredAt]);

  const submit = useCallback(async () => {
    if (!datasetId || !pin) {
      setError("Place the incident on the map first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiPost<any>(
        "/api/reports",
        {
          datasetId,
          lon: pin[0],
          lat: pin[1],
          positionalAccuracyM: accuracy,
          occurrenceTime: new Date(occurredAt).toISOString(),
          severityCode: severity,
          categoryCode: category || null,
          weatherCode: weather || null,
          lightingCode: lighting || null,
          trafficState,
          vehicleCount: vehicles,
          pedestrianCount: pedestrians,
          injuredCount: injured,
          fatalityCount: fatalities,
          emergencyResponse: emergency || fatalities > 0,
          narrative: narrative || null,
          deviceType: device,
          consentGiven: consent,
          attachments,
          corroborateAccidentId: corroborate,
        },
        role,
      );
      setResult(res);
      setNarrative("");
      setCorroborate(null);
      const inc = await apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/incidents?limit=3000`, role).catch(() => null);
      if (inc) setIncidents(inc.geojson);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [datasetId, pin, accuracy, occurredAt, severity, category, weather, lighting, trafficState, vehicles, pedestrians, injured, fatalities, emergency, narrative, device, consent, attachments, corroborate, role]);

  const layers = useMemo<MapLayerSpec[]>(() => {
    const out: MapLayerSpec[] = [networkLayer(network, "class", 0.85)];
    if (incidents) out.push({ ...networkLayer(null, "class", 1), id: "existing", data: incidents, zIndex: 10, opacity: 0.5, stroke: (p) => severityColor(p.severityCode), fill: (p) => severityColor(p.severityCode), radius: () => 2.6, width: () => 0.6, pickable: true, clusterRadiusPx: 0 });
    if (candidates?.length)
      out.push({
        id: "conflation-neighbourhood",
        data: {
          type: "FeatureCollection",
          features: candidates.filter((c: any) => c.position).map((c: any) => ({ type: "Feature", id: c.accidentId, geometry: { type: "Point", coordinates: c.position }, properties: { kind: "candidate_incident", ...c } })),
        },
        visible: true,
        zIndex: 15,
        stroke: (p) => (p.recommendation === "strong_duplicate_candidate" ? "#f06292" : p.recommendation === "possible_duplicate" ? "#f0a35e" : "#4cc9f0"),
        fill: (p) => (p.recommendation === "strong_duplicate_candidate" ? "#f06292" : p.recommendation === "possible_duplicate" ? "#f0a35e" : "#4cc9f0"),
        radius: (p) => 4 + Math.min(8, p.kernelValue * 12),
        width: () => 1,
        pickable: true,
      });
    if (pin) {
      out.push({
        id: "pin",
        data: { type: "FeatureCollection", features: [{ type: "Feature", id: "pin", geometry: { type: "Point", coordinates: pin }, properties: { kind: "raw_observation", accuracyM: accuracy } }] },
        visible: true,
        zIndex: 18,
        stroke: () => "#ffffff",
        fill: () => "#4cc9f0",
        radius: () => 6,
        width: () => 1.6,
        pickable: false,
      });
      out.push({
        id: "uncertainty-disc",
        data: { type: "FeatureCollection", features: uncertaintyDisc(pin, accuracy) },
        visible: true,
        zIndex: 17,
        stroke: () => "rgba(76,201,240,0.9)",
        fill: () => "rgba(76,201,240,0.10)",
        width: () => 1.2,
        pickable: false,
      });
    }
    if (result?.snapped) {
      out.push({
        id: "snap",
        data: { type: "FeatureCollection", features: [
          { type: "Feature", id: "snap", geometry: { type: "Point", coordinates: result.snapped.lonLat }, properties: { kind: "network_snap", ...result.snapped } },
          { type: "Feature", id: "drift", geometry: { type: "LineString", coordinates: [(pin ?? (result.rawPosition ? [result.rawPosition.lon, result.rawPosition.lat] : null)) as [number, number], result.snapped.lonLat].filter(Boolean) as Array<[number, number]> }, properties: { kind: "residual_vector", metres: result.snapped.perpDistanceM } },
        ] },
        visible: true,
        zIndex: 19,
        stroke: (p) => (p.kind === "network_snap" ? "#7bd88f" : "#f0a35e"),
        fill: () => "#7bd88f",
        radius: () => 5,
        width: () => 1.6,
        dashed: false,
        pickable: true,
      });
    }
    return out;
  }, [network, incidents, candidates, pin, accuracy, result]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-hidden p-2 xl:grid-cols-[330px_minmax(0,1fr)_360px]">
      {/* ---------------- form ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto">
        <Panel title="Incident geolocation" subtitle="Raw observation is never overwritten">
          <div className="space-y-2 p-2">
            <div className="mono grid grid-cols-2 gap-2 text-[10.5px]">
              <div className="rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--border)" }}>
                <div className="text-[9px] uppercase" style={{ color: "var(--text-mute)" }}>longitude</div>
                <div>{pin ? pin[0].toFixed(6) : "—"}</div>
              </div>
              <div className="rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--border)" }}>
                <div className="text-[9px] uppercase" style={{ color: "var(--text-mute)" }}>latitude</div>
                <div>{pin ? pin[1].toFixed(6) : "—"}</div>
              </div>
            </div>
            <Field label="Coordinate / address search" hint="Numeric lon,lat or a free-text hint that is geocoded against the persisted network names.">
              <div className="flex gap-1">
                <input type="text" className="w-full" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="e.g. 13.4050,52.5201 or “Juniper Boulevard”" />
                <button type="button" className="btn" onClick={() => resolveSearch(searchQ, network, setPin)}>Locate</button>
              </div>
            </Field>
            <Slider label="Observational radius / positional uncertainty σ" value={accuracy} min={2} max={250} step={1} unit="m" onChange={setAccuracy} />
            <Field label="Incident timestamp (UTC)">
              <input type="datetime-local" className="w-full" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </Field>
            <div className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
              reporting timestamp = submission time ({new Date().toISOString().slice(0, 19).replace("T", " ")}) → lag is recorded, never back-dated.
            </div>
          </div>
        </Panel>

        <Panel title="Structured attribution" subtitle="Validated against the controlled vocabularies">
          <div className="space-y-2 p-2">
            <Select label="Severity" value={severity} onChange={setSeverity} options={SEVERITIES} />
            <Select label="Accident taxonomy" value={category} onChange={setCategory} options={[{ value: "", label: "Unknown / not sure" }, ...CATEGORIES]} />
            <div className="grid grid-cols-2 gap-2">
              <Select label="Weather" value={weather} onChange={setWeather} options={WEATHER} />
              <Select label="Lighting" value={lighting} onChange={setLighting} options={LIGHTING} />
            </div>
            <Select label="Traffic state" value={trafficState} onChange={setTrafficState} options={[
              { value: "free_flow", label: "Free flow" },
              { value: "dense", label: "Dense" },
              { value: "congested", label: "Congested" },
              { value: "queue", label: "Queue / stop-and-go" },
              { value: "unknown", label: "Unknown" },
            ]} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Vehicles involved"><input type="number" className="w-full" min={0} max={50} value={vehicles} onChange={(e) => setVehicles(Number(e.target.value))} /></Field>
              <Field label="Pedestrians involved"><input type="number" className="w-full" min={0} max={50} value={pedestrians} onChange={(e) => setPedestrians(Number(e.target.value))} /></Field>
              <Field label="Injured"><input type="number" className="w-full" min={0} max={100} value={injured} onChange={(e) => setInjured(Number(e.target.value))} /></Field>
              <Field label="Fatalities"><input type="number" className="w-full" min={0} max={100} value={fatalities} onChange={(e) => setFatalities(Number(e.target.value))} /></Field>
            </div>
            <Toggle label="Emergency services on scene" checked={emergency} onChange={setEmergency} />
            <Field label="Narrative (max 2000 characters)">
              <textarea className="w-full" rows={3} maxLength={2000} value={narrative} onChange={(e) => setNarrative(e.target.value)} placeholder="What did you observe? Avoid names, licence plates or any personal data." />
            </Field>
            <div className="flex items-center justify-between gap-2">
              <Select value={device} onChange={(v) => setDevice(v)} options={[{ value: "web_form", label: "Web form" }, { value: "mobile_app", label: "Mobile app" }, { value: "in_vehicle", label: "In-vehicle unit" }]} />
              <button type="button" className="btn" onClick={() => setAttachments((a) => [...a, { filename: `photo_${a.length + 1}.jpg`, mimeType: "image/jpeg", bytes: 184320 + a.length * 4096, sha256: `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(0, 64) }])}>
                + attachment
              </button>
            </div>
            {attachments.length > 0 && (
              <div className="mono rounded-[3px] border p-1.5 text-[9.5px]" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
                {attachments.map((a) => (
                  <div key={a.sha256} className="flex justify-between gap-2">
                    <span>{a.filename} · {(a.bytes / 1024).toFixed(0)} kB · {a.sha256.slice(0, 10)}…</span>
                    <span style={{ color: "var(--accent-2)" }}>EXIF/GPS stripped</span>
                  </div>
                ))}
              </div>
            )}
            <Toggle label="I consent to anonymous processing of this report" checked={consent} onChange={setConsent} />
            <button type="button" className="btn btn-primary w-full" disabled={busy || !consent || !pin} onClick={() => void submit()}>
              {busy ? "Submitting…" : corroborate ? "Corroborate existing incident" : "Submit as Unverified / Raw VGI"}
            </button>
            {error && <div className="mono rounded-[3px] border p-2 text-[10.5px]" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}
          </div>
        </Panel>
      </div>

      {/* ---------------- map ---------------- */}
      <Panel
        title="Interactive geolocation canvas"
        subtitle="Click to place the pin · the dashed disc is your declared uncertainty σ"
        right={<div className="flex gap-1">{pin && <button type="button" className="btn" onClick={() => setPin(null)}>Clear pin</button>}<Badge tone="info">{dataset?.name?.slice(0, 34)}</Badge></div>}
        className="min-h-0"
        bodyClass="relative min-h-0"
      >
        <MapCanvas
          layers={layers}
          origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
          fitKey={`${datasetId ?? ""}|report`}
          onMapClick={(ll) => setPin(ll)}
          className="h-full min-h-[460px] w-full"
          legend={
            <div className="flex flex-wrap items-end gap-2">
              <RampLegend ramp="viridis" min={0} max={Math.max(1, (candidateMeta?.candidates?.length ?? 0))} unit="conflation kernel" />
              <div className="rounded-[3px] border px-2 py-1.5 text-[10px]" style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text-dim)" }}>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#4cc9f0" }} /> your raw observation + σ disc</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#f06292" }} /> strong duplicate candidate</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#f0a35e" }} /> possible duplicate</div>
                <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "#7bd88f" }} /> accepted network snap</div>
              </div>
            </div>
          }
        />
      </Panel>

      {/* ---------------- conflation + result ---------------- */}
      <div className="scroll-thin flex min-h-0 flex-col gap-2 overflow-auto">
        <Panel title="Real-time conflation alert" subtitle="Spatiotemporal network neighbourhood Δd_net = 220 m, Δt = 120 min" right={candidateMeta && <Badge tone={candidateMeta.duplicateLikely ? "bad" : "good"}>{candidateMeta.duplicateLikely ? "DUPLICATE LIKELY" : "NO MATCH"}</Badge>}>
          <div className="space-y-2 p-2">
            {!pin && <div className="text-[11px]" style={{ color: "var(--text-mute)" }}>Place a pin on the map to query the network neighbourhood.</div>}
            {pin && candidateMeta && (
              <>
                <div className="mono grid grid-cols-2 gap-x-2 text-[10px]" style={{ color: "var(--text-mute)" }}>
                  <span>reachable lixels</span><span className="text-right" style={{ color: "var(--text)" }}>{fmt(candidateMeta.search?.reachableLixels)}</span>
                  <span>anchor lixel</span><span className="mono text-right" style={{ color: "var(--text)" }}>{String(candidateMeta.anchor?.lixelId ?? "—").slice(-10)}</span>
                  <span>kernel</span><span className="text-right" style={{ color: "var(--text)" }}>{candidateMeta.search?.kernel}</span>
                </div>
                <DataTable
                  rows={candidates ?? []}
                  rowKey={(r: any) => r.accidentId}
                  maxHeight={190}
                  columns={[
                    { key: "occurredAt", label: "Occurred", format: (v) => fmtDate(v) },
                    { key: "roadName", label: "Edge", format: (v, r: any) => `${v ?? "—"} · ${r.roadClass ?? ""}` },
                    { key: "networkDistanceM", label: "d_net", align: "right", format: (v) => `${fmt(v, 0)} m` },
                    { key: "timeDeltaMinutes", label: "Δt", align: "right", format: (v) => `${fmt(v, 0)}′` },
                    { key: "kernelValue", label: "K", align: "right", format: (v) => fmt(v, 3), tone: (v) => (v >= 0.55 ? "var(--danger)" : v >= 0.3 ? "var(--warn)" : undefined) },
                    { key: "recommendation", label: "verdict", format: (v) => String(v).replace(/_/g, " ") },
                  ]}
                />
                {(candidates ?? []).length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Corroborate an existing incident (increases multi-witness trust)</div>
                    {(candidates ?? []).slice(0, 4).map((c: any) => (
                      <label key={c.accidentId} className="flex items-center gap-2 rounded-[3px] border px-2 py-1 text-[10.5px]" style={{ borderColor: corroborate === c.accidentId ? "var(--accent)" : "var(--border)", color: "var(--text-dim)" }}>
                        <input type="radio" name="corroborate" checked={corroborate === c.accidentId} onChange={() => setCorroborate(corroborate === c.accidentId ? null : c.accidentId)} />
                        <span className="truncate">{c.roadName ?? "—"} · {fmtDate(c.occurredAt)} · K={fmt(c.kernelValue, 3)}</span>
                        <span className="mono ml-auto" style={{ color: "var(--text-mute)" }}>{fmt(c.networkDistanceM, 0)} m</span>
                      </label>
                    ))}
                    <button type="button" className="btn w-full" onClick={() => setCorroborate(null)}>Submit as a distinct incident instead</button>
                  </div>
                )}
              </>
            )}
          </div>
        </Panel>

        {result && (
          <Panel title="Submission receipt" subtitle={`${result.reportId} · state = ${result.status}`} right={<Badge tone={result.status === "corroborated" ? "good" : "warn"}>{result.status}</Badge>}>
            <div className="space-y-2 p-2.5 text-[10.5px]">
              <div className="grid grid-cols-2 gap-2">
                <Info k="Raw coordinate (preserved)" v={`${result.rawPosition.lon.toFixed(6)}, ${result.rawPosition.lat.toFixed(6)}`} />
                <Info k="Canonical metric CRS" v={`EPSG:${result.rawPosition.srid} E ${fmt(result.rawPosition.x, 1)} N ${fmt(result.rawPosition.y, 1)}`} />
                <Info k="Snapped edge" v={`${result.snapped.roadName ?? "—"} (${result.snapped.roadClass})`} />
                <Info k="Linear offset m" v={`${fmt(result.snapped.m, 2)} m`} />
                <Info k="Orthogonal residual" v={`${fmt(result.snapped.perpDistanceM, 2)} m`} tone={result.snapped.perpDistanceM > 35 ? "bad" : "good"} />
                <Info k="Snap posterior" v={fmt(result.snapped.posterior, 4)} tone={result.snapped.posterior > 0.7 ? "good" : "warn"} />
                <Info k="Posterior entropy" v={`${fmt(result.matchDiagnostics.entropyNats, 3)} nats`} />
                <Info k="Ambiguity" v={fmt(result.matchDiagnostics.ambiguity, 3)} tone={result.matchDiagnostics.ambiguity > 0.7 ? "warn" : "good"} />
              </div>
              <DataTable
                rows={result.candidates as any[]}
                rowKey={(r: any) => `${r.segmentId}-${r.m}`}
                maxHeight={140}
                columns={[
                  { key: "roadClass", label: "class" },
                  { key: "perpDistanceM", label: "d⊥ (m)", align: "right", format: (v) => fmt(v, 2) },
                  { key: "classPrior", label: "π_class", align: "right", format: (v) => fmt(v, 3) },
                  { key: "topologyBonus", label: "τ_topo", align: "right", format: (v) => fmt(v, 3) },
                  { key: "posterior", label: "P(e,m|z)", align: "right", format: (v) => fmt(v, 4) },
                ]}
              />
              <div className="rounded-[3px] border p-2" style={{ borderColor: "var(--border)" }}>
                <div className="text-[9.5px] uppercase tracking-[0.08em]" style={{ color: "var(--text-mute)" }}>Privacy preservation</div>
                <div className="mono mt-1" style={{ color: "var(--text-dim)" }}>
                  {Object.entries(result.privacy).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("  ")}
                </div>
              </div>
              <p className="leading-snug" style={{ color: "var(--text-mute)" }}>
                The report is now <span className="mono" style={{ color: "var(--warn)" }}>Unverified / Raw VGI</span>. It is excluded from confirmed
                analytical layers until a Geospatial Data Steward verifies it. Both the raw observation and the probabilistic network reference are
                persisted, so no provenance is destroyed.
              </p>
            </div>
          </Panel>
        )}

        <Panel title="Acquisition protocol" subtitle="What the platform records and why">
          <ul className="space-y-1.5 p-2.5 text-[10.5px] leading-snug" style={{ color: "var(--text-dim)" }}>
            <li>▸ <b>Raw provenance</b> — your clicked coordinate is stored in the metric CRS (EPSG:{dataset?.srid}) and never overwritten by the snap.</li>
            <li>▸ <b>Uncertainty capture</b> — σ is propagated into the Gaussian snap likelihood 𝒩(d⊥;0,σ²), so a vague pin yields a flatter, more honest posterior.</li>
            <li>▸ <b>Temporal sanity</b> — occurrence ≤ report time ≤ now + 5 min; violations are rejected with HTTP 400.</li>
            <li>▸ <b>Spatial validity</b> — coordinates outside the study extent (±2.5 km buffer) are rejected with HTTP 422.</li>
            <li>▸ <b>Privacy</b> — EXIF/GPS/device metadata is stripped before persistence; consent is recorded; no IP address is retained on the report.</li>
            <li>▸ <b>Conflation</b> — the duplicate check uses shortest-path network distance, so an incident on the opposite carriageway or under an overpass is not merged.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Info({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>{k}</div>
      <div style={{ color: tone === "good" ? "var(--accent-2)" : tone === "bad" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--text)" }}>{v}</div>
    </div>
  );
}

/** Uncertainty disc rendered as a 48-gon in geographic coordinates. */
function uncertaintyDisc(pin: [number, number], radiusM: number): any[] {
  const ring: Array<[number, number]> = [];
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((pin[1] * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([pin[0] + Math.cos(a) * dLon, pin[1] + Math.sin(a) * dLat]);
  }
  return [{ type: "Feature", id: "sigma-disc", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "uncertainty_disc", radiusM } }];
}

/** Geocode a numeric lon,lat or match a persisted street name. */
function resolveSearch(q: string, network: GeoCollection | null, setPin: (p: [number, number]) => void) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const parts = trimmed.split(",").map((s) => Number(s.trim()));
  if (parts.length === 2 && parts.every((p) => Number.isFinite(p))) {
    if (Math.abs(parts[0]) <= 180 && Math.abs(parts[1]) <= 90) {
      setPin([parts[0], parts[1]]);
      return;
    }
  }
  const hit = (network?.features ?? []).find((f) => String(f.properties?.name ?? "").toLowerCase().includes(trimmed.toLowerCase()));
  if (hit && hit.geometry.type === "LineString") {
    const coords = hit.geometry.coordinates as Array<[number, number]>;
    const mid = coords[Math.floor(coords.length / 2)];
    setPin([mid[0], mid[1]]);
  }
}
