"use client";
import { useState } from "react";
import { useAppStore } from "@/lib/store";

export default function ReportModal() {
  const open = useAppStore(s => s.reportModalOpen);
  const coord = useAppStore(s => s.reportModalCoord);
  const close = useAppStore(s => s.closeReportModal);
  const loadSummary = useAppStore(s => s.loadSummary);

  const [severity, setSeverity] = useState("pdo");
  const [category, setCategory] = useState("vehicle");
  const [vehicleCount, setVehicleCount] = useState(2);
  const [pedCount, setPedCount] = useState(0);
  const [cycCount, setCycCount] = useState(0);
  const [fatalities, setFatalities] = useState(0);
  const [injuries, setInjuries] = useState(0);
  const [emergency, setEmergency] = useState(false);
  const [weather, setWeather] = useState("clear");
  const [lighting, setLighting] = useState("daylight");
  const [surface, setSurface] = useState("dry");
  const [uncertainty, setUncertainty] = useState(25);
  const [narrative, setNarrative] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; suggestion?: string; id?: number; snap?: any; nearbyDuplicates?: any[] } | null>(null);

  if (!open || !coord) return null;
  const lon = coord.lon;
  const lat = coord.lat;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          longitude: lon,
          latitude: lat,
          incidentTime: new Date().toISOString(),
          reportTime: new Date().toISOString(),
          positionalUncertaintyM: uncertainty,
          severityCode: severity,
          categoryCode: category,
          vehicleCount,
          pedestrianCount: pedCount,
          cyclistCount: cycCount,
          fatalities,
          injuries,
          emergencyResponse: emergency,
          weather,
          lightingCondition: lighting,
          roadSurface: surface,
          narrative,
        }),
      });
      const json = await res.json();
      setResult(json);
      if (json.ok) loadSummary();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="panel w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="panel-header !text-sm">
          <span>Submit Citizen Incident Report (VGI)</span>
          <button onClick={close} className="text-slate-400 hover:text-white text-base leading-none">×</button>
        </div>
        <form onSubmit={submit} className="panel-body space-y-3 text-xs">
          <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded p-2 text-[11px]">
            <div className="text-slate-400 mb-0.5">Clicked coordinate (WGS84):</div>
            <div className="font-mono text-cyan-400">
              {lat.toFixed(5)}, {lon.toFixed(5)}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              System will automatically snap this to the nearest road edge and check for duplicate reports.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Severity</label>
              <select className="select" value={severity} onChange={e => setSeverity(e.target.value)}>
                <option value="pdo">Property Damage Only</option>
                <option value="injury">Injury</option>
                <option value="severe">Severe Injury</option>
                <option value="fatal">Fatal</option>
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select className="select" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="vehicle">Vehicle-Vehicle</option>
                <option value="pedestrian">Pedestrian Involved</option>
                <option value="cyclist">Cyclist Involved</option>
                <option value="single">Single Vehicle</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label"># Vehicles</label>
              <input type="number" min={0} max={20} className="input" value={vehicleCount}
                onChange={e => setVehicleCount(+e.target.value)} />
            </div>
            <div>
              <label className="label"># Pedestrians</label>
              <input type="number" min={0} max={20} className="input" value={pedCount}
                onChange={e => setPedCount(+e.target.value)} />
            </div>
            <div>
              <label className="label"># Cyclists</label>
              <input type="number" min={0} max={20} className="input" value={cycCount}
                onChange={e => setCycCount(+e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Fatalities</label>
              <input type="number" min={0} max={10} className="input" value={fatalities}
                onChange={e => setFatalities(+e.target.value)} />
            </div>
            <div>
              <label className="label">Injuries</label>
              <input type="number" min={0} max={30} className="input" value={injuries}
                onChange={e => setInjuries(+e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Weather</label>
              <select className="select" value={weather} onChange={e => setWeather(e.target.value)}>
                <option value="clear">Clear</option>
                <option value="rain">Rain</option>
                <option value="fog">Fog</option>
                <option value="snow">Snow</option>
              </select>
            </div>
            <div>
              <label className="label">Lighting</label>
              <select className="select" value={lighting} onChange={e => setLighting(e.target.value)}>
                <option value="daylight">Daylight</option>
                <option value="dusk">Dusk/Dawn</option>
                <option value="dark_lit">Dark - Lit</option>
                <option value="dark_unlit">Dark - Unlit</option>
              </select>
            </div>
            <div>
              <label className="label">Surface</label>
              <select className="select" value={surface} onChange={e => setSurface(e.target.value)}>
                <option value="dry">Dry</option>
                <option value="wet">Wet</option>
                <option value="ice">Ice</option>
                <option value="snow">Snow</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Positional uncertainty radius: {uncertainty} m</label>
            <input type="range" min={5} max={100} step={5} value={uncertainty}
              onChange={e => setUncertainty(+e.target.value)} />
          </div>

          <div>
            <label className="label">Narrative / notes</label>
            <textarea className="input" rows={2} value={narrative}
              onChange={e => setNarrative(e.target.value)}
              placeholder="Describe what you observed..." />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={emergency} onChange={e => setEmergency(e.target.checked)} className="accent-cyan-500" />
            Emergency services were present
          </label>

          {result && (
            <div className={`rounded p-2 text-[11px] border ${result.ok ? "bg-emerald-950 border-emerald-700 text-emerald-300" : "bg-red-950 border-red-700 text-red-300"}`}>
              <div className="font-semibold mb-1">{result.ok ? "✓ Report submitted" : "Error"}</div>
              {result.suggestion && <div>{result.suggestion}</div>}
              {result.snap && (
                <div className="font-mono text-[10px] mt-1">
                  snap distance: {result.snap.distanceM} m · confidence: {(result.snap.confidence * 100).toFixed(0)}%
                </div>
              )}
              {result.nearbyDuplicates && result.nearbyDuplicates.length > 0 && (
                <div className="mt-2 text-[10px]">
                  <div className="font-semibold text-orange-400 mb-0.5">Nearby existing reports:</div>
                  {result.nearbyDuplicates.slice(0, 3).map(d => (
                    <div key={d.id}>• Report #{d.id}: {d.networkDistanceM} m away · {d.timeDiffMin.toFixed(0)} min difference</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" className="btn flex-1" onClick={close}>Cancel</button>
            <button type="submit" className="btn btn-accent flex-1" disabled={submitting}>
              {submitting ? "Submitting & snapping..." : "Submit Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
