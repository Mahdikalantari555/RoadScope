"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, LocateFixed, MapPin, Search, Upload, X, Clock, FileWarning, Info } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Alert, Badge, Button, Chip, Field, KeyValue, Panel, Segmented, StatusBadge, Stat, cx, inputCls, labelCls, textareaCls } from "@/components/ui";
import { useApi, useDebounced } from "@/components/hooks";
import { apiGet, apiPost, errorMessage } from "@/lib/client-api";
import { CATEGORY_CODES, CATEGORY_META, SEVERITY_IDS, SEVERITY_META, STUDY_AREA, type CategoryCode, type GeoFeatureCollection } from "@/lib/domain";
import { reportSchema } from "@/lib/validation";
import { lonLatToUtm } from "@/lib/geo";
import { localParts } from "@/lib/time";
import type { DuplicateCandidate, ReportResult, TrackResult } from "@/lib/api-types";
import { formatInt } from "@/lib/format";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Loading map…</div>,
});

const pad = (n: number) => String(n).padStart(2, "0");
function localNowInput(): string {
  const p = localParts(new Date(), STUDY_AREA.timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

const MAX_PHOTOS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export default function ReportPage() {
  const { meta } = useApp();
  const segments = useApi<GeoFeatureCollection>("/segments");
  const verified = useApi<GeoFeatureCollection>("/accidents/geojson?limit=5000");

  const [lon, setLon] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [occurredLocal, setOccurredLocal] = useState(localNowInput);
  const [category, setCategory] = useState<CategoryCode | null>(null);
  const [severityId, setSeverityId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState(1);
  const [emergency, setEmergency] = useState(false);
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dupes, setDupes] = useState<DuplicateCandidate[]>([]);
  const [locating, setLocating] = useState(false);
  const [trackCode, setTrackCode] = useState("");
  const [track, setTrack] = useState<TrackResult | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pickMode, setPickMode] = useState(true);

  const dupeKey = lon !== null && lat !== null && category ? JSON.stringify({ lon, lat, occurredLocal, category }) : null;
  const debouncedDupeKey = useDebounced(dupeKey, 500);
  useEffect(() => {
    if (!debouncedDupeKey) {
      setDupes([]);
      return;
    }
    const k = JSON.parse(debouncedDupeKey) as { lon: number; lat: number; occurredLocal: string; category: CategoryCode };
    let cancelled = false;
    apiPost<{ candidates: DuplicateCandidate[] }>("/accidents/check-duplicates", {
      lon: k.lon,
      lat: k.lat,
      occurredLocal: k.occurredLocal,
      categoryCode: k.category,
    })
      .then((r) => !cancelled && setDupes(r.candidates))
      .catch(() => !cancelled && setDupes([]));
    return () => {
      cancelled = true;
    };
  }, [debouncedDupeKey]);

  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2 || !segments.data) return [];
    return segments.data.features.filter((f) => String(f.properties.name).toLowerCase().includes(q)).slice(0, 6);
  }, [search, segments.data]);

  const pickFrom = (x: number, y: number) => {
    setLon(Number(x.toFixed(6)));
    setLat(Number(y.toFixed(6)));
  };

  const applySearch = () => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(search);
    if (m) pickFrom(Number(m[1]), Number(m[2]));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setFormError("Geolocation is not available in this browser. Click the map instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pickFrom(pos.coords.longitude, pos.coords.latitude);
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
      },
      () => {
        setFormError("Your location could not be determined. Click the map to place the incident.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const onSelectSegment = (f: GeoFeatureCollection["features"][number]) => {
    const coords = f.geometry.type === "LineString" ? f.geometry.coordinates : [];
    if (coords.length >= 2) {
      const a = coords[0]!;
      const b = coords[coords.length - 1]!;
      pickFrom((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    setSearch(String(f.properties.name));
  };

  const payload = {
    lon,
    lat,
    accuracyM: accuracy ?? undefined,
    occurredLocal,
    categoryCode: category,
    severityId,
    vehiclesInvolved: vehicles,
    emergencyServices: emergency,
    description,
    privacyConsent: consent,
  };

  const submit = async () => {
    setFormError(null);
    setUploadNote(null);
    const parsed = reportSchema.safeParse({
      ...payload,
      lon: lon ?? Number.NaN,
      lat: lat ?? Number.NaN,
      categoryCode: category ?? undefined,
      severityId: severityId ?? undefined,
      privacyConsent: consent,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError("Please correct the highlighted fields before submitting.");
      return;
    }
    setErrors({});
    if (photos.some((p) => p.size > MAX_BYTES || !ACCEPTED.includes(p.type))) {
      setFormError("Photographs must be JPEG, PNG or WebP files of 8 MB or less.");
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { ...parsed.data };
      if (body.accuracyM === undefined) delete body.accuracyM;
      const created = await apiPost<ReportResult>("/accidents", body);
      setResult(created);
      const notes: string[] = [];
      for (const photo of photos) {
        const form = new FormData();
        form.append("file", photo);
        form.append("trackingCode", created.trackingCode);
        try {
          await apiPost(`/accidents/${created.id}/attachments`, form);
        } catch (err) {
          notes.push(`${photo.name}: ${errorMessage(err)}`);
        }
      }
      if (notes.length) setUploadNote(`Some photographs were not stored — ${notes.join("; ")}`);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setDescription("");
    setConsent(false);
    setPhotos([]);
    setCategory(null);
    setSeverityId(null);
    setVehicles(1);
    setEmergency(false);
    setErrors({});
    setOccurredLocal(localNowInput());
  };

  const lookup = async () => {
    setTrackError(null);
    setTrack(null);
    try {
      setTrack(await apiGet<TrackResult>(`/accidents/track?code=${encodeURIComponent(trackCode.trim())}`));
    } catch (err) {
      setTrackError(errorMessage(err));
    }
  };

  const utm = lon !== null && lat !== null ? lonLatToUtm(lon, lat) : null;
  const picked: [number, number] | null = lon !== null && lat !== null ? [lon, lat] : null;
  const fieldErr = (k: string) => errors[k] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="scroll-thin flex w-full flex-col gap-4 overflow-y-auto p-4 lg:w-[480px] lg:shrink-0 lg:border-r lg:border-line">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Report an accident</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Reports are <span className="text-fg">pending</span> until reviewed. They are not treated as confirmed accidents, and they do not appear in analytics unless verified.
          </p>
          <div className="mt-2">
            <Badge tone="synthetic">Synthetic demonstration · do not report real incidents here</Badge>
          </div>
        </div>

        {result ? (
          <Panel title="Report received" subtitle="Keep your tracking code to follow the review" actions={<StatusBadge status={result.status} />}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-canvas/50 px-3 py-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-muted">Tracking code</div>
                  <div className="font-mono text-[18px] font-semibold tracking-wider">{result.trackingCode}</div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copied ? <Check size={12} /> : <Copy size={12} />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(result.trackingCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Alert tone="ok" title="Submission confirmed">
                Your report is queued for verification. Anyone with the tracking code can check its status below.
              </Alert>
              {result.nearestSegment ? (
                <KeyValue rows={[["Nearest road", result.nearestSegment.name], ["Distance to road", `${result.nearestSegment.distanceM} m`]]} />
              ) : null}
              {result.duplicateCandidates.length ? (
                <Alert tone="warn" title="Possible duplicate of an existing record">
                  Similar incidents were found nearby. A reviewer will decide whether this report duplicates them.
                </Alert>
              ) : null}
              {uploadNote ? <Alert tone="warn">{uploadNote}</Alert> : null}
              <Button variant="primary" onClick={reset}>
                Submit another report
              </Button>
            </div>
          </Panel>
        ) : (
          <>
            <Panel title="1 · Location" subtitle="Click the map, search a road, or enter coordinates">
              <div className="flex flex-col gap-2.5">
                <div className="flex gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <Search size={13} className="pointer-events-none absolute left-2 top-2.5 text-faint" />
                    <input
                      className={cx(inputCls, "pl-7")}
                      placeholder="Road name or “lon, lat”"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && applySearch()}
                      aria-label="Search road or coordinates"
                    />
                  </div>
                  <Button variant="secondary" onClick={applySearch}>
                    Go
                  </Button>
                </div>
                {hits.length ? (
                  <ul className="flex flex-col rounded-md border border-line">
                    {hits.map((f) => (
                      <li key={String(f.properties.segmentId)}>
                        <button type="button" onClick={() => onSelectSegment(f)} className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[12px] hover:bg-panel-2">
                          <span className="truncate">{String(f.properties.name)}</span>
                          <span className="shrink-0 text-[10.5px] text-muted">{String(f.properties.roadClass)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Longitude" error={fieldErr("lon")}>
                    <input
                      type="number"
                      step="0.00001"
                      className={cx(inputCls, "font-mono")}
                      value={lon ?? ""}
                      onChange={(e) => setLon(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Latitude" error={fieldErr("lat")}>
                    <input
                      type="number"
                      step="0.00001"
                      className={cx(inputCls, "font-mono")}
                      value={lat ?? ""}
                      onChange={(e) => setLat(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-faint">
                    {utm ? `EPSG:32633 · E ${formatInt(utm[0])} · N ${formatInt(utm[1])}` : "No location selected"}
                  </span>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" icon={<LocateFixed size={12} />} onClick={useMyLocation} busy={locating}>
                      Use my location
                    </Button>
                    <Button size="sm" variant={pickMode ? "primary" : "secondary"} icon={<MapPin size={12} />} onClick={() => setPickMode((v) => !v)}>
                      {pickMode ? "Picking on map" : "Pick on map"}
                    </Button>
                  </div>
                </div>
                {accuracy !== null ? <span className="text-[11px] text-muted">Device accuracy ≈ {accuracy} m</span> : null}
              </div>
            </Panel>

            <Panel title="2 · When and what" subtitle={`Local time, ${STUDY_AREA.timeZone}`}>
              <div className="flex flex-col gap-3">
                <Field label="Date and time of the incident" error={fieldErr("occurredLocal")}>
                  <input type="datetime-local" className={inputCls} value={occurredLocal} onChange={(e) => setOccurredLocal(e.target.value)} />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Category</span>
                  <div className="grid gap-1.5">
                    {CATEGORY_CODES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={category === code}
                        onClick={() => setCategory(code)}
                        className={cx(
                          "flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                          category === code ? "border-accent/60 bg-accent/10" : "border-line hover:border-faint",
                        )}
                      >
                        <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: CATEGORY_META[code].colorHex }} />
                        <span>
                          <span className="block text-[12.5px] font-medium">{CATEGORY_META[code].label}</span>
                          <span className="block text-[11px] text-muted">{CATEGORY_META[code].description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {fieldErr("categoryCode") ? <span className="text-[11px] text-danger">{fieldErr("categoryCode")}</span> : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className={labelCls}>Severity</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SEVERITY_IDS.map((id) => (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={severityId === id}
                        onClick={() => setSeverityId(id)}
                        className={cx("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px]", severityId === id ? "border-accent/60 bg-accent/10" : "border-line hover:border-faint")}
                      >
                        <span className="size-2 rounded-full" style={{ background: SEVERITY_META[id].colorHex }} />
                        {SEVERITY_META[id].label}
                      </button>
                    ))}
                  </div>
                  {fieldErr("severityId") ? <span className="text-[11px] text-danger">{fieldErr("severityId")}</span> : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Vehicles / road users" error={fieldErr("vehiclesInvolved")}>
                    <input type="number" min={1} max={50} className={inputCls} value={vehicles} onChange={(e) => setVehicles(Number(e.target.value))} />
                  </Field>
                  <div className="flex flex-col gap-1">
                    <span className={labelCls}>Emergency services</span>
                    <Segmented
                      size="sm"
                      value={emergency ? "yes" : "no"}
                      options={[
                        { value: "no", label: "Not involved" },
                        { value: "yes", label: "Attended" },
                      ]}
                      onChange={(v) => setEmergency(v === "yes")}
                    />
                  </div>
                </div>
                <Field label="Description" error={fieldErr("description")} hint={`${description.length}/1000 — what happened, without personal details`}>
                  <textarea className={textareaCls} rows={4} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe the incident in your own words." />
                </Field>
              </div>
            </Panel>

            <Panel title="3 · Photographs (optional)" subtitle={`Up to ${MAX_PHOTOS} images, 8 MB each. Do not include faces or number plates.`}>
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-4 text-[12px] text-muted hover:border-faint hover:text-fg">
                  <Upload size={14} />
                  <span>Choose JPEG, PNG or WebP files</span>
                  <input
                    type="file"
                    accept={ACCEPTED.join(",")}
                    multiple
                    className="sr-only"
                    onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS))}
                  />
                </label>
                {photos.length ? (
                  <ul className="flex flex-col gap-1 text-[12px]">
                    {photos.map((p) => (
                      <li key={p.name} className="flex items-center justify-between rounded border border-line px-2 py-1">
                        <span className="truncate">{p.name}</span>
                        <span className="flex items-center gap-2 text-muted">
                          {formatInt(p.size / 1024)} KB
                          <button type="button" onClick={() => setPhotos((arr) => arr.filter((x) => x !== p))} aria-label={`Remove ${p.name}`}>
                            <X size={12} />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Panel>

            <Panel title="4 · Privacy and submission">
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2 text-[12px] leading-relaxed text-muted">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--c-accent)]" />
                  <span>
                    I confirm the information is accurate to my knowledge and I consent to its processing for road-safety analysis. The platform stores a daily-rotating pseudonymous
                    identifier for abuse prevention, never my IP address or contact details.
                  </span>
                </label>
                {fieldErr("privacyConsent") ? <span className="text-[11px] text-danger">{fieldErr("privacyConsent")}</span> : null}
                {formError ? <Alert tone="error">{formError}</Alert> : null}
                {dupes.length ? (
                  <Alert tone="warn" title={`${dupes.length} similar incident${dupes.length === 1 ? "" : "s"} nearby`}>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {dupes.map((d) => (
                        <li key={d.id} className="font-mono text-[11px]">
                          #{d.id} · {CATEGORY_META[d.categoryCode].label} · {d.distanceM} m · {d.deltaMinutes} min · score {d.score.toFixed(2)} · {d.status}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-1 block text-[11px]">You can still submit; a reviewer will assess duplicates.</span>
                  </Alert>
                ) : null}
                <Button variant="primary" size="md" onClick={() => void submit()} busy={submitting} disabled={submitting}>
                  Submit report
                </Button>
              </div>
            </Panel>
          </>
        )}

        <Panel title="Track a report" subtitle="Enter the tracking code you received">
          <div className="flex flex-col gap-2.5">
            <div className="flex gap-1.5">
              <input className={cx(inputCls, "font-mono uppercase")} placeholder="UAI-XXXX-XXXX" value={trackCode} onChange={(e) => setTrackCode(e.target.value)} aria-label="Tracking code" />
              <Button variant="secondary" onClick={() => void lookup()} disabled={trackCode.trim().length < 6}>
                Check
              </Button>
            </div>
            {trackError ? <Alert tone="warn">{trackError}</Alert> : null}
            {track ? (
              <div className="flex flex-col gap-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{track.trackingCode}</span>
                  <StatusBadge status={track.status} />
                </div>
                <KeyValue rows={[["Category", track.categoryLabel], ["Severity", track.severityLabel], ["Reported", track.reportedAt.slice(0, 16).replace("T", " ") + " UTC"]]} />
                <ol className="flex flex-col gap-1.5 border-l border-line pl-3">
                  <li className="flex items-center gap-2 text-muted">
                    <Clock size={11} /> Received
                  </li>
                  {track.history.map((h, i) => (
                    <li key={i} className="flex items-center gap-2">
                      {h.action === "verify" ? <Check size={11} className="text-ok" /> : h.action === "reject" ? <X size={11} className="text-danger" /> : <Info size={11} className="text-muted" />}
                      <span>
                        {h.action.replace(/_/g, " ")} → <span className="font-medium">{h.newStatus ?? "updated"}</span>
                      </span>
                      <span className="ml-auto font-mono text-[10.5px] text-faint">{h.createdAt.slice(0, 10)}</span>
                    </li>
                  ))}
                </ol>
                {track.status === "reported" ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    <FileWarning size={11} /> Still awaiting verification.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <section className="relative min-h-[420px] flex-1 lg:min-h-0">
        <MapView
          basemap="dark"
          points={verified.data}
          pointsMode="points"
          roads={segments.data}
          roadsMode="base"
          analysis={null}
          analysisKind={null}
          picked={picked}
          pickMode={pickMode}
          onPick={(x, y) => {
            pickFrom(x, y);
            setPickMode(true);
          }}
          className="h-full"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
          <span className="rounded-md border border-line bg-panel/90 px-2 py-1 text-[12px] font-medium shadow">
            {pickMode ? "Click the map to place the incident" : "Pick mode off"}
          </span>
          <span className="rounded-md border border-warn/50 bg-panel/90 px-2 py-1 text-[10.5px] font-semibold tracking-[0.1em] text-warn shadow">SYNTHETIC</span>
        </div>
        <div className="absolute bottom-3 left-3 max-w-[300px] rounded-md border border-line bg-panel/95 p-2.5 text-[11px] text-muted shadow-xl">
          <div className="mb-1 font-semibold text-fg">Legend</div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-accent" /> Selected location
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[#94a3b8]" /> Verified incidents (context)
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-4 bg-[#cbd5e1]" /> Arterial road
          </div>
          <p className="mt-1.5 text-[10.5px] text-faint">Reports are validated against the study-area coverage and matched to the nearest road segment.</p>
        </div>
        {meta ? (
          <div className="absolute bottom-3 right-3 hidden rounded-md border border-line bg-panel/90 px-2 py-1 text-[10.5px] text-muted shadow md:block">
            Coverage: {meta.study.coverageBBox.map((v) => v.toFixed(3)).join(", ")}
          </div>
        ) : null}
      </section>
    </div>
  );
}


