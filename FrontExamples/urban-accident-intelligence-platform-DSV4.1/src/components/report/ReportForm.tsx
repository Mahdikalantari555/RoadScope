"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, Crosshair, LocateFixed, MapPin, ShieldCheck, Trash2, Upload } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { Callout, Divider, Field, LoadingRows, MetricGrid, Panel, SectionLabel, Spinner, ToggleChip } from "@/components/ui";
import { formatDateTime, useApi, type NetworkResponse } from "@/lib/client/api";

type Category = { code: string; label: string; color: string | null; description: string | null };
type Severity = { code: number; label: string; weight: number; color: string; description: string | null };
type District = { name: string; code: string; centroid: { lat: number; lng: number } | null };

type DuplicateCandidate = {
  publicId: string;
  distanceM: number;
  hoursApart: number;
  duplicateScore: number;
  categoryCode: string;
  severityCode: number;
  status: string;
};

type SubmitResult = {
  publicId: string;
  status: string;
  message: string;
  duplicateCandidates: DuplicateCandidate[];
  nearestSegment: { id: string; name: string | null; distanceM: number } | null;
  district: string | null;
  qualityFlags: string[];
  positionalUncertaintyM: number;
};

const MAX_FILE_BYTES = 1_000_000;

export function ReportForm({ categories, severities, districts }: { categories: Category[]; severities: Severity[]; districts: District[] }) {
  const network = useApi<NetworkResponse>("/api/network");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [category, setCategory] = useState(categories[0]?.code ?? "rear_end");
  const [severity, setSeverity] = useState(2);
  const [vehicles, setVehicles] = useState(2);
  const [casualties, setCasualties] = useState(0);
  const [emergency, setEmergency] = useState(false);
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<{ filename: string; mimeType: string; dataUrl: string; size: number }[]>([]);
  const [reporterName, setReporterName] = useState("");
  const [reporterContact, setReporterContact] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<DuplicateCandidate[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const now = new Date();
    setDate(now.toISOString().slice(0, 10));
    setTime(`${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`);
    const centre = districts[0]?.centroid;
    if (centre) setLocation({ lat: centre.lat, lng: centre.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const occurredAt = useMemo(() => (date && time ? `${date}T${time}:00Z` : ""), [date, time]);

  useEffect(() => {
    if (!location || !occurredAt) return;
    const controller = new AbortController();
    setChecking(true);
    const timer = setTimeout(() => {
      fetch("/api/accidents/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ lat: location.lat, lng: location.lng, occurredAt, categoryCode: category }),
      })
        .then((response) => response.json())
        .then((payload) => setCandidates(payload.candidates ?? []))
        .catch(() => undefined)
        .finally(() => setChecking(false));
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [location, occurredAt, category]);

  const pick = (lat: number, lng: number) => {
    setLocation({ lat, lng });
    setErrors((current) => ({ ...current, location: "" }));
  };

  const useCurrentPosition = () => {
    if (!navigator.geolocation) {
      setErrors((current) => ({ ...current, location: "Geolocation is unavailable in this browser." }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => pick(position.coords.latitude, position.coords.longitude),
      () => setErrors((current) => ({ ...current, location: "Location permission denied. Pick the incident on the map instead." })),
      { enableHighAccuracy: true, timeout: 6000 },
    );
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: typeof attachments = [];
    for (const file of Array.from(files).slice(0, 2 - attachments.length)) {
      if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
        setErrors((current) => ({ ...current, attachments: "Only PNG, JPEG or WebP images are accepted." }));
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setErrors((current) => ({ ...current, attachments: "Each image must be smaller than 1 MB." }));
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      next.push({ filename: file.name, mimeType: file.type, dataUrl, size: file.size });
    }
    setAttachments((current) => [...current, ...next].slice(0, 2));
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!location) next.location = "Place the incident on the map to continue.";
    if (!date || !time) next.occurredAt = "Provide the incident date and time (UTC).";
    if (occurredAt && new Date(occurredAt).getTime() > Date.now() + 3_600_000) next.occurredAt = "Incident time cannot be in the future.";
    if (occurredAt && new Date(occurredAt).getTime() < Date.UTC(2024, 0, 1)) next.occurredAt = "Reporting accepts incidents from 1 January 2024.";
    if (description.trim().length < 12) next.description = "Describe the incident in at least 12 characters.";
    if (vehicles < 1 || vehicles > 12) next.vehicles = "Between 1 and 12 vehicles.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate() || !location) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const response = await fetch("/api/accidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: location.lat,
          lng: location.lng,
          occurredAt,
          categoryCode: category,
          severityCode: severity,
          vehicles,
          casualties,
          emergencyServices: emergency,
          description,
          reporterName: reporterName || undefined,
          reporterContact: reporterContact || undefined,
          attachments: attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, dataUrl: a.dataUrl })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Submission failed");
      setSubmitted(payload as SubmitResult);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setServerError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-3xl space-y-2.5 p-3">
        <Panel title="Report submitted" icon={<CheckCircle2 size={13} className="text-ok" />}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-panel2 px-3 py-2">
              <div>
                <div className="label-caps">Tracking reference</div>
                <div className="mono text-[18px] font-semibold text-accent">{submitted.publicId}</div>
              </div>
              <span className={`badge ${submitted.status === "verified" ? "badge-ok" : submitted.status === "duplicate" ? "badge-danger" : "badge-warn"}`}>
                {submitted.status}
              </span>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">{submitted.message}</p>
            <MetricGrid
              metrics={[
                { label: "District", value: submitted.district ?? "unassigned" },
                { label: "Nearest segment", value: submitted.nearestSegment ? `${submitted.nearestSegment.id} (${submitted.nearestSegment.distanceM} m)` : "unmatched" },
                { label: "Positional uncertainty", value: `± ${submitted.positionalUncertaintyM} m` },
                { label: "Quality flags", value: submitted.qualityFlags.length ? submitted.qualityFlags.join(", ") : "none" },
              ]}
            />
            {submitted.duplicateCandidates.length > 0 && (
              <Callout tone="warn" title="Possible duplicate detected">
                The report is within 250 m and 24 h of {submitted.duplicateCandidates.length} existing record(s), highest similarity{" "}
                {(submitted.duplicateCandidates[0].duplicateScore * 100).toFixed(0)}%. A moderator will decide whether to merge or keep it separate.
                Records flagged as duplicates are excluded from analysis.
              </Callout>
            )}
            <Callout tone="info" title="What happens next">
              Your report is <b>pending</b>. It is visible on the map as an unverified hollow marker but is excluded from verified statistics until a
              moderator reviews it. Track the status at any time with your reference.
            </Callout>
            <div className="flex flex-wrap gap-1.5">
              <Link href={`/track?publicId=${submitted.publicId}`} className="btn btn-primary btn-xs">
                Track this report
              </Link>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  setSubmitted(null);
                  setDescription("");
                  setAttachments([]);
                }}
              >
                Submit another
              </button>
              <Link href="/" className="btn btn-xs">
                Back to explorer
              </Link>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-48px)] flex-col bg-bg lg:h-[calc(100vh-48px)] lg:flex-row lg:overflow-hidden">
      <aside className="order-2 w-full flex-none space-y-2.5 overflow-y-auto border-line bg-surface p-2.5 scroll-thin lg:order-1 lg:h-full lg:w-[420px] lg:border-r">
        <Panel title="Citizen accident report" icon={<MapPin size={12} />}>
          <p className="text-[11px] leading-relaxed text-muted">
            Report a road traffic collision inside the Vantia study area. Submissions are citizen-reported, moderated, and never published as
            confirmed accidents until verified. This is a synthetic demonstration environment — do not submit personal data.
          </p>
        </Panel>

        <Panel title="1 · Location" icon={<Crosshair size={12} />}>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              <button type="button" className="btn btn-xs" onClick={useCurrentPosition}>
                <LocateFixed size={11} /> Use my coordinates
              </button>
              <span className="badge">map pick active</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Latitude" error={errors.location}>
                <input
                  className="input mono"
                  type="number"
                  step="0.00001"
                  value={location?.lat ?? ""}
                  onChange={(event) => setLocation({ lat: Number(event.target.value), lng: location?.lng ?? 4.951 })}
                />
              </Field>
              <Field label="Longitude">
                <input
                  className="input mono"
                  type="number"
                  step="0.00001"
                  value={location?.lng ?? ""}
                  onChange={(event) => setLocation({ lat: location?.lat ?? 52.301, lng: Number(event.target.value) })}
                />
              </Field>
            </div>
            <p className="text-[10px] text-faint">Click the map to reposition the incident marker. Coordinates are stored in WGS 84 with ± 25 m uncertainty for map picks.</p>
          </div>
        </Panel>

        <Panel title="2 · Incident" icon={<AlertTriangle size={12} />}>
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Date (UTC)" error={errors.occurredAt}>
                <input className="input" type="date" max="2025-12-31" min="2024-01-01" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field label="Time (UTC)">
                <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </Field>
            </div>
            <Field label="Accident category">
              <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </Field>
            <div>
              <span className="label-caps mb-1 block">Highest severity</span>
              <div className="flex flex-wrap gap-1">
                {[...severities].sort((a, b) => b.code - a.code).map((item) => (
                  <ToggleChip key={item.code} active={severity === item.code} onClick={() => setSeverity(item.code)}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </ToggleChip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Vehicles involved" error={errors.vehicles}>
                <input className="input" type="number" min={1} max={12} value={vehicles} onChange={(event) => setVehicles(Number(event.target.value))} />
              </Field>
              <Field label="Casualties (incl. fatalities)">
                <input className="input" type="number" min={0} max={40} value={casualties} onChange={(event) => setCasualties(Number(event.target.value))} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />
              Emergency services attended the scene
            </label>
            <Field label="Description" error={errors.description} hint={`${description.length}/1500 characters — what happened, road conditions, visibility, other parties.`}>
              <textarea
                className="textarea"
                maxLength={1500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="e.g. Two vehicles collided on the eastbound approach; traffic queueing, wet carriageway, no visible injuries."
              />
            </Field>
          </div>
        </Panel>

        <Panel title="3 · Evidence & contact (optional)" icon={<Camera size={12} />}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" className="btn btn-xs" onClick={() => fileRef.current?.click()}>
                <Upload size={11} /> Attach photo
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(event) => onFiles(event.target.files)} />
              <span className="text-[10px] text-faint">{attachments.length}/2 · max 1 MB each</span>
            </div>
            {errors.attachments && <div className="text-[10.5px] text-danger">{errors.attachments}</div>}
            {attachments.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">
                {attachments.map((attachment, index) => (
                  <div key={attachment.filename + index} className="relative overflow-hidden rounded border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachment.dataUrl} alt={attachment.filename} className="h-20 w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded bg-bg/80 p-0.5 text-danger"
                      onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                      aria-label={`Remove ${attachment.filename}`}
                    >
                      <Trash2 size={11} />
                    </button>
                    <div className="truncate bg-panel2 px-1 py-0.5 text-[9px] text-faint">{attachment.filename}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Display name (optional)">
                <input className="input" value={reporterName} onChange={(event) => setReporterName(event.target.value)} placeholder="Not published" />
              </Field>
              <Field label="Contact (optional)">
                <input className="input" value={reporterContact} onChange={(event) => setReporterContact(event.target.value)} placeholder="Moderator use only" />
              </Field>
            </div>
            <Callout tone="info" title="Privacy">
              Contact details are never returned by public endpoints or shown on the map. Only the reference number is public. Photos are stored
              with the report for moderation and are not exposed in analytics.
            </Callout>
            {serverError && <Callout tone="danger" title="Submission failed">{serverError}</Callout>}
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[10px] text-faint">Service errors are logged; validation failures are shown inline.</span>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                {submitting ? <Spinner label="Submitting…" /> : <><ShieldCheck size={13} /> Submit report</>}
              </button>
            </div>
          </div>
        </Panel>
      </aside>

      <div className="relative order-1 h-[44vh] min-h-[300px] w-full flex-none lg:order-2 lg:h-full lg:min-h-0 lg:flex-1">
        <MapView
          mode="points"
          accidents={{ type: "FeatureCollection", features: [] }}
          network={network.data}
          basemap="night"
          toggles={{ roads: true, districts: true, water: true, parks: true, intersections: true }}
          pickMode
          pickedLocation={location}
          onPick={pick}
          fitBounds={location ? [[location.lng - 0.02, location.lat - 0.012], [location.lng + 0.02, location.lat + 0.012]] : null}
          fitNonce={location ? 1 : 0}
          legend={[{ label: "Selected incident location", color: "#2dd4bf" }]}
        />
        <div className="pointer-events-none absolute right-2 top-2 w-[248px] space-y-1.5">
          <div className="panel pointer-events-auto px-2 py-1.5">
            <SectionLabel right={checking ? <Spinner label="" /> : null}>Duplicate screen</SectionLabel>
            {candidates === null ? (
              <p className="text-[10px] text-faint">Pick a location and time to run proximity checks.</p>
            ) : candidates.length === 0 ? (
              <p className="text-[10px] text-ok">No similar reports within 250 m / 24 h.</p>
            ) : (
              <div className="space-y-1">
                {candidates.slice(0, 3).map((candidate) => (
                  <div key={candidate.publicId} className="text-[10px]">
                    <div className="flex items-center justify-between gap-1">
                      <span className="mono text-ink">{candidate.publicId}</span>
                      <span className={candidate.duplicateScore >= 0.85 ? "text-danger" : "text-warn"}>{(candidate.duplicateScore * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-faint">{candidate.distanceM} m · {candidate.hoursApart} h apart · {candidate.status}</div>
                  </div>
                ))}
                <p className="text-[9px] text-faint">High similarity is provisionally flagged as a duplicate for moderator review.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="order-3 hidden w-[300px] flex-none space-y-2.5 overflow-y-auto border-l border-line bg-surface p-2.5 scroll-thin lg:block">
        <Panel title="Submission checklist" icon={<CheckCircle2 size={12} />}>
          <div className="space-y-1.5 text-[10.5px]">
            {[
              { label: "Location placed on map", done: Boolean(location) },
              { label: "Date and time supplied", done: Boolean(date && time) },
              { label: "Category selected", done: Boolean(category) },
              { label: "Description ≥ 12 chars", done: description.trim().length >= 12 },
              { label: "Duplicate screen run", done: candidates !== null },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2">
                <span className={item.done ? "text-muted" : "text-faint"}>{item.label}</span>
                {item.done ? <CheckCircle2 size={11} className="text-ok" /> : <span className="text-[9px] text-warn">pending</span>}
              </div>
            ))}
          </div>
          <Divider />
          <p className="text-[9.5px] leading-relaxed text-faint">
            Reports are validated on the server as well. Out-of-area coordinates, future timestamps and undersized descriptions are rejected with
            field-level errors.
          </p>
        </Panel>
        <Panel title="Study area" icon={<MapPin size={12} />}>
          <div className="space-y-1 text-[10.5px] text-muted">
            <div className="flex justify-between"><span>Centre</span><span className="mono text-ink">52.301 N · 4.951 E</span></div>
            <div className="flex justify-between"><span>Extent</span><span className="mono text-ink">≈13.6 × 10.8 km</span></div>
            <div className="flex justify-between"><span>Districts</span><span className="mono text-ink">{districts.length}</span></div>
            <div className="flex justify-between"><span>Segments</span><span className="mono text-ink">{network.data?.segments.features.length ?? "…"}</span></div>
          </div>
        </Panel>
        <Callout tone="warn" title="Do not submit real incidents">
          This is a research demonstration on synthetic data. In a real deployment, emergency reports belong with the emergency services.
        </Callout>
      </aside>
    </div>
  );
}
