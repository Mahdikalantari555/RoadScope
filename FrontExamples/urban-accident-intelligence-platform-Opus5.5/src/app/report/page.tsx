"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap } from "maplibre-gl";
import { Camera, CheckCircle2, MapPin, Search, Trash2 } from "lucide-react";
import { MapView, upsertSource } from "@/components/map/MapView";
import { useApp } from "@/components/providers";
import { Badge, Button, Field, Notice, Panel, cx } from "@/components/ui";
import { ClientError, api, fmt } from "@/lib/client/api";

interface CheckResp {
  snap: { lon: number; lat: number; distanceM: number | null; segmentName: string | null; flags: string[] };
  candidates: { trackingCode: string; status: string; score: number; distanceM: number; dtMin: number; likely: boolean }[];
}
interface SubmitResp {
  trackingCode: string;
  status: string;
  flags: string[];
  snap: { distanceM: number | null; segmentName: string | null };
  duplicateCandidates: { trackingCode?: string; score: number }[];
}
interface Photo {
  fileName: string;
  mimeType: "image/jpeg";
  dataBase64: string;
  preview: string;
  size: number;
}

function localNowInput() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/** Re-encode via canvas: strips EXIF (incl. GPS) metadata and bounds size. */
async function reencode(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("Unsupported image"));
    i.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  const dataUrl = c.toDataURL("image/jpeg", 0.82);
  const b64 = dataUrl.split(",")[1];
  return { fileName: file.name.replace(/\.\w+$/, "") + ".jpg", mimeType: "image/jpeg", dataBase64: b64, preview: dataUrl, size: Math.round((b64.length * 3) / 4) };
}

export default function ReportPage() {
  const { meta } = useApp();
  const [map, setMap] = useState<MLMap | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [loc, setLoc] = useState<{ lon: number; lat: number } | null>(null);
  const [when, setWhen] = useState(localNowInput());
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [vehicles, setVehicles] = useState(2);
  const [description, setDescription] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [check, setCheck] = useState<CheckResp | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<SubmitResp | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; kind: string; lon: number; lat: number }[]>([]);

  const placeMarker = useCallback(
    (lon: number, lat: number, fly = false) => {
      setLoc({ lon, lat });
      if (!map) return;
      if (!marker.current) {
        const el = document.createElement("div");
        el.innerHTML = `<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.2 0 13.9 0 24.3 14 36 14 36s14-11.7 14-22.1C28 6.2 21.7 0 14 0z" fill="#4fd1c5" stroke="#04201d" stroke-width="1.5"/><circle cx="14" cy="14" r="5" fill="#04201d"/></svg>`;
        marker.current = new maplibregl.Marker({ element: el, draggable: true, anchor: "bottom" }).setLngLat([lon, lat]).addTo(map);
        marker.current.on("dragend", () => {
          const p = marker.current!.getLngLat();
          setLoc({ lon: p.lng, lat: p.lat });
        });
      } else marker.current.setLngLat([lon, lat]);
      if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16.5) });
    },
    [map],
  );

  const onReady = useCallback((m: MLMap) => {
    setMap(m);
    m.getCanvas().style.cursor = "crosshair";
  }, []);
  useEffect(() => {
    if (!map) return;
    const h = (e: maplibregl.MapMouseEvent) => placeMarker(e.lngLat.lng, e.lngLat.lat);
    map.on("click", h);
    return () => {
      map.off("click", h);
    };
  }, [map, placeMarker]);

  // Live validation: snapping + duplicate candidates
  useEffect(() => {
    if (!loc) return;
    const t = setTimeout(() => {
      api<CheckResp>("/api/accidents/check", { method: "POST", json: { lon: loc.lon, lat: loc.lat, occurredAt: new Date(when).toISOString(), category: category || "other", severity: severity || "pdo" } })
        .then((r) => {
          setCheck(r);
          if (map) {
            const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: r.snap.distanceM !== null && r.snap.distanceM <= 60 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: [[loc.lon, loc.lat], [r.snap.lon, r.snap.lat]] }, properties: {} }, { type: "Feature", geometry: { type: "Point", coordinates: [r.snap.lon, r.snap.lat] }, properties: {} }] : [] };
            upsertSource(map, "snap", fc);
            if (!map.getLayer("snap-line")) {
              map.addLayer({ id: "snap-line", type: "line", source: "snap", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f5a524", "line-width": 1.5, "line-dasharray": [2, 1.5] } });
              map.addLayer({ id: "snap-pt", type: "circle", source: "snap", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#f5a524" } });
            }
          }
        })
        .catch(() => setCheck(null));
    }, 350);
    return () => clearTimeout(t);
  }, [loc, when, category, severity, map]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => api<{ items: typeof results }>(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => setResults(r.items)).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!loc) e.loc = "Select the accident location on the map.";
    else if (check && (check.snap.distanceM === null || check.snap.distanceM > 1500)) e.loc = "Location is outside the covered study area.";
    const t = Date.parse(when);
    if (Number.isNaN(t)) e.when = "Enter a valid date and time.";
    else if (t > Date.now() + 15 * 60000) e.when = "Time cannot be in the future.";
    if (!category) e.category = "Select a collision type.";
    if (!severity) e.severity = "Select the most severe outcome.";
    if (vehicles < 0 || vehicles > 60) e.vehicles = "0–60 vehicles.";
    if (description.trim().length < 10) e.description = "Please describe what happened (≥ 10 characters).";
    if (contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$|^\+?[0-9 ()-]{6,20}$/.test(contact)) e.contact = "Enter a valid e-mail or phone number, or leave empty.";
    if (!consent) e.consent = "Consent is required to submit.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setServerError(null);
    if (!validate() || !loc) return;
    setSubmitting(true);
    try {
      const r = await api<SubmitResp>("/api/accidents", {
        method: "POST",
        json: { lon: loc.lon, lat: loc.lat, occurredAt: new Date(when).toISOString(), category, severity, vehicles, description, emergencyServices: emergency, contact, consent, attachments: photos.map(({ fileName, mimeType, dataBase64 }) => ({ fileName, mimeType, dataBase64 })) },
      });
      setDone(r);
    } catch (e) {
      const ce = e as ClientError;
      const det = Array.isArray(ce.details) ? (ce.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join("; ") : "";
      setServerError(`${ce.message}${det ? ` — ${det}` : ""}`);
    } finally {
      setSubmitting(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const list = await Promise.all([...files].slice(0, 3 - photos.length).map((f) => reencode(f).catch(() => null)));
    setPhotos((p) => [...p, ...list.filter((x): x is Photo => !!x && x.size < 1_500_000)]);
  };

  if (done)
    return (
      <div className="h-full overflow-y-auto grid place-items-center p-6">
        <div className="max-w-lg w-full border border-line bg-panel rounded-[4px] p-6 space-y-4">
          <div className="flex items-center gap-2 text-ok">
            <CheckCircle2 className="size-5" />
            <h1 className="text-[16px] font-semibold text-fg">Report received</h1>
          </div>
          <p className="text-muted text-[13px]">Thank you. Your report has been recorded as <b className="text-fg">unverified</b> and will be reviewed by an administrator before it is used in any analysis.</p>
          <div className="border border-line rounded-[4px] p-3 bg-panel2">
            <div className="label">Tracking code</div>
            <div className="num text-[22px] font-semibold text-accent tracking-wider">{done.trackingCode}</div>
            <p className="text-[11px] text-faint">Keep this code to check the status of your report. No personal account is required.</p>
          </div>
          <div className="text-[12px] space-y-1">
            <div>Matched to: <b>{done.snap.segmentName ?? "no road segment (off-network)"}</b> {done.snap.distanceM !== null && <span className="text-faint">({done.snap.distanceM.toFixed(1)} m from your pin)</span>}</div>
            {done.flags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                Quality flags:{" "}
                {done.flags.map((f) => (
                  <Badge key={f} color="#f5a524">
                    {f.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Link href={`/track?code=${done.trackingCode}`}>
              <Button variant="primary">Track status</Button>
            </Link>
            <Button onClick={() => window.location.reload()}>Submit another</Button>
          </div>
        </div>
      </div>
    );

  const step = !loc ? 1 : !category || !severity ? 2 : description.trim().length < 10 ? 3 : 4;
  return (
    <div className="h-full flex flex-col-reverse md:flex-row">
      <div className="md:w-[420px] shrink-0 border-r border-line bg-panel overflow-y-auto h-[55%] md:h-full">
        <div className="p-4 space-y-4">
          <div>
            <h1 className="text-[15px] font-semibold">Report a road accident</h1>
            <p className="text-[12px] text-muted mt-1">Reports are reviewed before they appear as verified incidents. In an emergency, call your local emergency number first.</p>
          </div>
          <div className="flex gap-1">
            {["Location", "What", "Details", "Submit"].map((s, i) => (
              <div key={s} className="flex-1">
                <div className={cx("h-[3px] rounded-full", i + 1 <= step ? "bg-accent" : "bg-line")} />
                <div className={cx("text-[10.5px] mt-1", i + 1 === step ? "text-accent" : "text-faint")}>
                  {i + 1}. {s}
                </div>
              </div>
            ))}
          </div>

          <Panel title="1 · Location">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-2 text-faint" />
              <input className="field pl-7" placeholder="Street, intersection (A & B) or lat, lon" value={q} onChange={(e) => setQ(e.target.value)} />
              {results.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-elev border border-line-strong rounded-[4px] shadow-lg max-h-56 overflow-y-auto">
                  {results.map((r) => (
                    <button
                      key={`${r.label}-${r.lon}`}
                      className="w-full text-left px-2 py-1.5 text-[12px] hover:bg-accent-soft flex justify-between"
                      onClick={() => {
                        placeMarker(r.lon, r.lat, true);
                        setResults([]);
                        setQ(r.label);
                      }}
                    >
                      <span>{r.label}</span>
                      <span className="text-faint text-[10.5px]">{r.kind}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11.5px] text-muted mt-2 flex items-center gap-1">
              <MapPin className="size-3.5 text-accent" /> Click the map to place the pin; drag it to refine.
            </p>
            {loc && (
              <div className="mt-2 text-[12px] space-y-1">
                <div className="num text-muted">
                  {loc.lat.toFixed(6)}, {loc.lon.toFixed(6)}
                </div>
                {check && (
                  <div>
                    {check.snap.distanceM !== null && check.snap.distanceM <= 60 ? (
                      <span>
                        Nearest road: <b>{check.snap.segmentName}</b> <span className="text-faint">({check.snap.distanceM.toFixed(1)} m)</span>
                      </span>
                    ) : (
                      <Notice tone="warn">Pin is not on a mapped road (nearest {check.snap.distanceM ? `${check.snap.distanceM.toFixed(0)} m` : "unknown"}). Please check the location.</Notice>
                    )}
                  </div>
                )}
              </div>
            )}
            {errors.loc && <p className="text-[11px] text-danger mt-1">{errors.loc}</p>}
          </Panel>

          <Panel title="2 · What happened">
            <div className="space-y-3">
              <Field label="Date & time (local)" error={errors.when}>
                <input type="datetime-local" className="field num" value={when} max={localNowInput()} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label="Collision type" error={errors.category}>
                <div className="grid grid-cols-2 gap-1">
                  {meta?.categories.map((c) => (
                    <button key={c.code} type="button" title={c.description} onClick={() => setCategory(c.code)} className={cx("text-left px-2 py-1.5 border rounded-[3px] text-[11.5px] flex items-center gap-1.5", category === c.code ? "border-accent bg-accent-soft" : "border-line text-muted hover:text-fg")}>
                      <span className="size-2 rounded-full" style={{ background: c.color }} />
                      {c.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Most severe outcome" error={errors.severity}>
                <div className="grid grid-cols-2 gap-1">
                  {meta?.severities.map((s) => (
                    <button key={s.code} type="button" onClick={() => setSeverity(s.code)} className={cx("text-left px-2 py-1.5 border rounded-[3px] text-[11.5px] flex items-center gap-1.5", severity === s.code ? "border-accent bg-accent-soft" : "border-line text-muted hover:text-fg")}>
                      <span className="size-2 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Vehicles involved" error={errors.vehicles}>
                  <input type="number" min={0} max={60} className="field num" value={vehicles} onChange={(e) => setVehicles(Number(e.target.value))} />
                </Field>
                <Field label="Emergency services">
                  <label className="flex items-center gap-2 h-[30px] text-[12px]">
                    <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} /> attended / called
                  </label>
                </Field>
              </div>
            </div>
          </Panel>

          {check && check.candidates.some((c) => c.likely) && (
            <Notice tone="warn">
              <b>Possible duplicate.</b> {check.candidates.filter((c) => c.likely).length} existing report(s) within {Math.round(Math.max(...check.candidates.map((c) => c.distanceM)))} m and ±3 h look similar (best score {check.candidates[0].score.toFixed(2)}). You may still submit — reviewers will reconcile duplicates.
            </Notice>
          )}

          <Panel title="3 · Details">
            <div className="space-y-3">
              <Field label="Description" error={errors.description} hint={`${description.length}/2000 · Do not include names or licence plates.`}>
                <textarea className="field min-h-[84px]" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened? Road conditions, manoeuvres, visibility…" />
              </Field>
              <Field label="Photographs (optional, max 3)" hint="Images are re-encoded in your browser; EXIF/GPS metadata is removed before upload.">
                <div className="flex gap-2 flex-wrap">
                  {photos.map((p, i) => (
                    <div key={i} className="relative size-16">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.preview} alt={p.fileName} className="size-16 object-cover rounded-[3px] border border-line" />
                      <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 size-5 grid place-items-center bg-elev border border-line rounded-full text-danger" aria-label="Remove photo">
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 3 && (
                    <label className="size-16 grid place-items-center border border-dashed border-line-strong rounded-[3px] text-muted hover:text-accent cursor-pointer">
                      <Camera className="size-5" />
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
                    </label>
                  )}
                </div>
              </Field>
            </div>
          </Panel>

          <Panel title="4 · Privacy & submit">
            <div className="space-y-3">
              <Field label="Contact (optional)" error={errors.contact} hint="Stored only as a salted one-way hash to link follow-ups; never displayed.">
                <input className="field" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e-mail or phone" />
              </Field>
              <label className="flex gap-2 text-[12px] text-muted leading-snug">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>I confirm the information is accurate to my knowledge and agree that the anonymised report may be used for road-safety analysis. No account or personal data is required.</span>
              </label>
              {errors.consent && <p className="text-[11px] text-danger">{errors.consent}</p>}
              {serverError && <Notice tone="danger">{serverError}</Notice>}
              <Button variant="primary" size="md" className="w-full" loading={submitting} onClick={submit}>
                Submit report
              </Button>
              <p className="text-[11px] text-faint">
                Already reported? <Link className="text-accent" href="/track">Track your report</Link>. Time is interpreted in your browser&apos;s local time zone ({fmt.dt(new Date()).slice(-5)} now).
              </p>
            </div>
          </Panel>
        </div>
      </div>
      <MapView onReady={onReady} className="flex-1 min-h-[45%]">
        <div className="absolute top-2 left-2 z-10 bg-panel/90 border border-line rounded-[4px] px-2 py-1 text-[11.5px] text-muted">Click to place the accident location · amber dashed line = snap to nearest road</div>
      </MapView>
    </div>
  );
}
