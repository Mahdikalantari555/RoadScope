"use client";

/**
 * B. Citizen Accident Reporting — map-driven submission with live duplicate
 * detection, coordinate validation and status tracking.
 */

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  ClipboardList,
  FileWarning,
  MapPin,
  Paperclip,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useApp } from "@/lib/appState";
import {
  Badge,
  Btn,
  Chip,
  Field,
  MicroLabel,
  Panel,
  Select,
  Stat,
  TextArea,
  TextInput,
  Toggle,
} from "@/components/ui";
import { CATEGORIES, SEVERITIES, LIGHTING, ROAD_SURFACE, WEATHER, STUDY_BOUNDS } from "@/lib/constants";
import { haversineM } from "@/lib/geo";

const MapPlate = dynamic(() => import("@/components/MapPlate"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-deep)]">
      <div className="micro">Loading console plate…</div>
    </div>
  ),
});

interface Draft {
  lon: number | null;
  lat: number | null;
  date: string;
  time: string;
  categoryCode: string;
  severityCode: string;
  vehicles: number;
  casualties: number;
  description: string;
  emergencyServices: boolean;
  reporterHandle: string;
  weather: string;
  lighting: string;
  roadSurface: string;
  attachments: { filename: string; contentType: string; byteSize: number }[];
}

const EMPTY: Draft = {
  lon: null,
  lat: null,
  date: new Date().toISOString().slice(0, 10),
  time: "08:30",
  categoryCode: "junction_conflict",
  severityCode: "slight",
  vehicles: 2,
  casualties: 1,
  description: "",
  emergencyServices: true,
  reporterHandle: "",
  weather: "clear",
  lighting: "daylight",
  roadSurface: "dry",
  attachments: [],
};

export default function ReportView() {
  const app = useApp();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    publicId: string;
    status: string;
    snappedSegment: { segmentCode: string; streetName: string } | null;
    snapDistanceM: number;
    duplicateCandidates: { publicId: string; distanceM: number; occurredAt: string; status: string }[];
  } | null>(null);
  const [submissions, setSubmissions] = useState<
    { publicId: string; category: string; severity: string; occurredAt: string; status: string }[]
  >([]);

  const roadCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: app.segments.map((s) => ({
        type: "Feature" as const,
        id: s.id,
        geometry: { type: "LineString" as const, coordinates: s.coordinates },
        properties: {
          id: s.id,
          roadClass: s.roadClass,
          streetName: s.streetName,
          segmentCode: s.segmentCode,
          district: s.district,
          lengthM: s.lengthM,
          speedLimitKph: s.speedLimitKph,
          lanes: s.lanes,
          lighting: s.lighting,
          hasCycleLane: s.hasCycleLane,
          hasJunctionControl: s.hasJunctionControl,
        },
      })),
    }),
    [app.segments],
  );

  // --- live duplicate detection (client-side pre-check) -----------------
  const duplicates = useMemo(() => {
    if (draft.lon == null || draft.lat == null) return [];
    const when = Date.parse(`${draft.date}T${draft.time}:00Z`);
    if (!Number.isFinite(when)) return [];
    return app.accidents
      .map((a) => {
        const dt = Math.abs(Date.parse(a.occurredAt) - when) / 3600000;
        const d = haversineM(draft.lon!, draft.lat!, a.lon, a.lat);
        return { a, dt, d };
      })
      .filter((r) => r.dt <= 6 && r.d <= 75)
      .sort((x, y) => x.d - y.d)
      .slice(0, 4);
  }, [draft.lon, draft.lat, draft.date, draft.time, app.accidents]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (draft.lon == null || draft.lat == null) e.location = "Select the accident location on the map.";
    else if (
      draft.lon < STUDY_BOUNDS.minLon - 0.02 ||
      draft.lon > STUDY_BOUNDS.maxLon + 0.02 ||
      draft.lat < STUDY_BOUNDS.minLat - 0.02 ||
      draft.lat > STUDY_BOUNDS.maxLat + 0.02
    )
      e.location = "Coordinates fall outside the Meridian District study area.";
    const when = Date.parse(`${draft.date}T${draft.time}:00Z`);
    if (!Number.isFinite(when)) e.time = "Enter a valid date and time.";
    else if (when > Date.now()) e.time = "The occurrence time cannot be in the future.";
    else if (when < Date.parse("2023-01-01")) e.time = "Outside the configured dataset coverage window.";
    if (draft.vehicles < 1 || draft.vehicles > 30) e.vehicles = "Vehicles must be between 1 and 30.";
    if (draft.casualties < 0 || draft.casualties > 30) e.casualties = "Casualties must be between 0 and 30.";
    if (draft.description.trim().length < 12)
      e.description = "Provide at least 12 characters of description so the report can be assessed.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/accidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lon: draft.lon,
          lat: draft.lat,
          occurredAt: new Date(`${draft.date}T${draft.time}:00Z`).toISOString(),
          categoryCode: draft.categoryCode,
          severityCode: draft.severityCode,
          vehicles: draft.vehicles,
          casualties: draft.casualties,
          description: draft.description,
          emergencyServices: draft.emergencyServices,
          reporterHandle: draft.reporterHandle || undefined,
          weather: draft.weather,
          lighting: draft.lighting,
          roadSurface: draft.roadSurface,
          attachments: draft.attachments,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrors({
          submit:
            body.error === "Validation failed"
              ? body.issues?.map((i: { message: string }) => i.message).join(" ")
              : body.error ?? "Submission failed.",
        });
        return;
      }
      setResult(body);
      setSubmissions((s) => [
        {
          publicId: body.publicId,
          category: CATEGORIES.find((c) => c.code === draft.categoryCode)?.label ?? draft.categoryCode,
          severity: SEVERITIES.find((s) => s.code === draft.severityCode)?.label ?? draft.severityCode,
          occurredAt: `${draft.date} ${draft.time}`,
          status: "pending",
        },
        ...s,
      ]);
    } catch (err) {
      setErrors({ submit: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      {/* map picker */}
      <div className="relative min-w-0 flex-1">
        <MapPlate
          roads={roadCollection as never}
          pickMode
          pickedPoint={draft.lon != null && draft.lat != null ? { lon: draft.lon, lat: draft.lat } : null}
          onMapClick={(p) => {
            setDraft((d) => ({ ...d, lon: p.lon, lat: p.lat }));
            setErrors((e) => ({ ...e, location: "" }));
            setResult(null);
          }}
        />
        <div className="pointer-events-none absolute top-2 left-2 border border-[var(--rule)] bg-[var(--panel)]/92 px-3 py-2">
          <MicroLabel rule={false}>Location picker</MicroLabel>
          <div className="mt-1 text-[11px] font-semibold text-[var(--amber)]">
            Click the plate to place the incident
          </div>
          <div className="tnum mt-1 text-[9.5px] text-[var(--text-3)]">
            {draft.lon != null && draft.lat != null
              ? `${draft.lon.toFixed(6)}° E, ${draft.lat.toFixed(6)}° N`
              : "no coordinate selected"}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-1">
          {[
            ["Northgate", 13.3815, 52.5305],
            ["Meridian Core", 13.3815, 52.5145],
            ["Harbour Ward", 13.4105, 52.5145],
            ["Foundry Quarter", 13.4105, 52.5305],
            ["Ellis Yards", 13.4415, 52.5145],
            ["Southbank", 13.4105, 52.4995],
          ].map(([name, lon, lat]) => (
            <button
              key={name as string}
              type="button"
              className="pointer-events-auto border border-[var(--rule-strong)] bg-[var(--panel)]/85 px-2 py-1 text-[9.5px] uppercase tracking-[0.1em] text-[var(--text-2)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)]"
              onClick={() => {
                setDraft((d) => ({ ...d, lon: lon as number, lat: lat as number }));
                setResult(null);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* form bay */}
      <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-[var(--rule)] bg-[var(--panel)]">
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative px-4 py-3">
            <MicroLabel rule={false}>Module B</MicroLabel>
            <h2 className="mt-1.5 text-[19px] leading-[1.1] font-bold tracking-[-0.01em] text-[var(--text)]">
              Report an accident
            </h2>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-[var(--text-3)]">
              Reports enter the queue as <span className="text-[var(--warn)]">pending</span>. They are not
              counted as confirmed accidents until an administrator verifies them.
            </p>
          </div>
        </div>

        {result ? (
          <div className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[var(--cyan)]" />
              <span className="text-[13px] font-semibold text-[var(--cyan)]">Report submitted</span>
            </div>
            <div className="mt-3">
              <div className="micro">Report identifier</div>
              <div className="tnum mt-1 text-[17px] text-[var(--amber)]">{result.publicId}</div>
            </div>
            <div className="mt-3">
              <Stat label="Status" value={result.status} tone="warn" sub="awaiting administrator review" />
            </div>
            <div className="mt-2 border border-[var(--rule)] bg-[var(--panel-2)] p-2">
              <MicroLabel>Nearest road segment</MicroLabel>
              <div className="mt-1.5 text-[11px] text-[var(--text)]">
                {result.snappedSegment ? result.snappedSegment.streetName : "No segment within 120 m"}
              </div>
              <div className="tnum mt-0.5 text-[9.5px] text-[var(--text-3)]">
                {result.snappedSegment?.segmentCode} · snap distance {result.snapDistanceM.toFixed(1)} m
              </div>
            </div>

            {result.duplicateCandidates.length > 0 && (
              <div className="mt-3 border-l-2 border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-2 py-2">
                <div className="micro mb-1.5 text-[var(--warn)]">
                  {result.duplicateCandidates.length} possible duplicate(s) detected
                </div>
                {result.duplicateCandidates.map((d) => (
                  <div key={d.publicId} className="flex items-baseline justify-between border-b border-[var(--rule)] py-1">
                    <span className="tnum text-[9.5px] text-[var(--text-2)]">{d.publicId}</span>
                    <span className="tnum text-[9px] text-[var(--text-3)]">
                      {d.distanceM} m · {d.occurredAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                ))}
                <p className="mt-1.5 text-[9px] leading-[1.6] text-[var(--text-3)]">
                  Duplicate rule: within 75 m and 6 h of an existing record. Reviewers decide whether these
                  describe the same event.
                </p>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Btn
                variant="primary"
                icon={<ClipboardList className="h-3 w-3" />}
                onClick={() => {
                  setResult(null);
                  setDraft(EMPTY);
                }}
              >
                File another report
              </Btn>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <Field label="Accident location" error={errors.location}>
              <div className="flex gap-2">
                <TextInput
                  value={draft.lon?.toFixed(6) ?? ""}
                  readOnly
                  placeholder="longitude"
                  aria-label="Longitude"
                />
                <TextInput
                  value={draft.lat?.toFixed(6) ?? ""}
                  readOnly
                  placeholder="latitude"
                  aria-label="Latitude"
                />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Date of occurrence" error={errors.date}>
                <TextInput
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="Local time (UTC)" error={errors.time}>
                <TextInput
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Accident category">
              <Select
                value={draft.categoryCode}
                onChange={(v) => setDraft({ ...draft, categoryCode: v })}
                options={CATEGORIES.map((c) => ({ value: c.code, label: `${c.label} — ${c.group}` }))}
              />
            </Field>

            <Field label="Severity">
              <div className="flex flex-wrap gap-1">
                {SEVERITIES.map((s) => (
                  <Chip
                    key={s.code}
                    colour={s.colour}
                    active={draft.severityCode === s.code}
                    onClick={() => setDraft({ ...draft, severityCode: s.code })}
                    title={s.definition}
                  >
                    {s.label}
                  </Chip>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Vehicles involved" error={errors.vehicles}>
                <TextInput
                  type="number"
                  min={1}
                  max={30}
                  value={draft.vehicles}
                  onChange={(e) => setDraft({ ...draft, vehicles: Number(e.target.value) })}
                />
              </Field>
              <Field label="Casualties" error={errors.casualties}>
                <TextInput
                  type="number"
                  min={0}
                  max={30}
                  value={draft.casualties}
                  onChange={(e) => setDraft({ ...draft, casualties: Number(e.target.value) })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Weather">
                <Select
                  value={draft.weather}
                  onChange={(v) => setDraft({ ...draft, weather: v })}
                  options={WEATHER.map((w) => ({ value: w, label: w.replace("_", " ") }))}
                />
              </Field>
              <Field label="Lighting">
                <Select
                  value={draft.lighting}
                  onChange={(v) => setDraft({ ...draft, lighting: v })}
                  options={LIGHTING.map((w) => ({ value: w, label: w.replace("_", " ") }))}
                />
              </Field>
              <Field label="Surface">
                <Select
                  value={draft.roadSurface}
                  onChange={(v) => setDraft({ ...draft, roadSurface: v })}
                  options={ROAD_SURFACE.map((w) => ({ value: w, label: w.replace("_", " ") }))}
                />
              </Field>
            </div>

            <Field label="Description of the incident" error={errors.description} hint="Minimum 12 characters. Avoid personal data.">
              <TextArea
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What happened, in what order, and what was the immediate outcome?"
              />
            </Field>

            <div>
              <Toggle
                label="Emergency services attended the scene"
                checked={draft.emergencyServices}
                onChange={(v) => setDraft({ ...draft, emergencyServices: v })}
              />
            </div>

            <Field label="Photographic evidence" hint="Metadata is recorded; binary upload is stubbed in this build.">
              <div className="flex flex-wrap gap-1.5">
                <Btn
                  icon={<Paperclip className="h-3 w-3" />}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      attachments: [
                        ...draft.attachments,
                        {
                          filename: `evidence-${draft.attachments.length + 1}.jpg`,
                          contentType: "image/jpeg",
                          byteSize: 320000 + Math.floor(Math.random() * 1800000),
                        },
                      ],
                    })
                  }
                >
                  Attach photo
                </Btn>
                {draft.attachments.map((a, i) => (
                  <span
                    key={a.filename}
                    className="inline-flex items-center gap-1 border border-[var(--rule-strong)] px-1.5 py-1 text-[9px] text-[var(--text-2)]"
                  >
                    {a.filename}
                    <button
                      type="button"
                      className="text-[var(--fatal)]"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          attachments: draft.attachments.filter((_, idx) => idx !== i),
                        })
                      }
                      aria-label={`Remove ${a.filename}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </Field>

            <Field label="Reporter handle (optional)" hint="Stored pseudonymously. Do not enter your real name.">
              <TextInput
                value={draft.reporterHandle}
                onChange={(e) => setDraft({ ...draft, reporterHandle: e.target.value })}
                placeholder="anonymous"
              />
            </Field>

            {duplicates.length > 0 && (
              <div className="border-l-2 border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <FileWarning className="h-3 w-3 text-[var(--warn)]" />
                  <span className="micro text-[var(--warn)]">Possible duplicates nearby</span>
                </div>
                {duplicates.map(({ a, d, dt }) => (
                  <div key={a.id} className="mt-1 flex items-baseline justify-between">
                    <span className="tnum text-[9.5px] text-[var(--text-2)]">{a.publicId}</span>
                    <span className="tnum text-[9px] text-[var(--text-3)]">
                      {d.toFixed(0)} m · {dt.toFixed(1)} h apart
                    </span>
                  </div>
                ))}
              </div>
            )}

            {errors.submit && (
              <div className="border-l-2 border-[var(--fatal)] px-2 py-2 text-[10px] text-[var(--fatal)]">
                {errors.submit}
              </div>
            )}

            <Btn
              variant="primary"
              icon={<Send className="h-3 w-3" />}
              onClick={submit}
              disabled={submitting}
              className="h-9"
            >
              {submitting ? "Submitting…" : "Submit report for review"}
            </Btn>
          </div>
        )}

        {/* tracking */}
        <div className="border-t border-[var(--rule)] p-4">
          <MicroLabel>Your submissions in this session</MicroLabel>
          {submissions.length === 0 ? (
            <div className="mt-2 flex items-start gap-2 text-[10px] leading-[1.7] text-[var(--text-3)]">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              No reports filed yet in this session. Submitted reports appear here with their review state.
            </div>
          ) : (
            <div className="mt-2">
              {submissions.map((s) => (
                <div key={s.publicId} className="flex items-center justify-between border-b border-[var(--rule)] py-1.5">
                  <div>
                    <div className="tnum text-[10px] text-[var(--amber)]">{s.publicId}</div>
                    <div className="text-[9.5px] text-[var(--text-3)]">
                      {s.category} · {s.severity} · {s.occurredAt}
                    </div>
                  </div>
                  <Badge tone="warn">{s.status}</Badge>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-3)]" />
            <p className="text-[9px] leading-[1.7] text-[var(--text-3)]">
              Privacy: reports are stored with a pseudonymous handle. Location is retained at the precision
              you supplied; positional accuracy is recorded alongside the coordinate so downstream analysis
              can account for geocoding uncertainty.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
