"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Check, Crosshair, FileWarning, Pencil, ShieldCheck, Undo2, X } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import EChart, { CHART_AXIS, CHART_TOOLTIP } from "@/components/EChart";
import { Alert, Badge, Button, Chip, Field, KeyValue, Panel, Segmented, Spinner, StatusBadge, cx, inputCls, labelCls, textareaCls } from "@/components/ui";
import { useApi } from "@/components/hooks";
import { apiGet, apiPatch, apiPost, errorMessage } from "@/lib/client-api";
import { CATEGORY_CODES, CATEGORY_META, QUALITY_FLAG_META, SEVERITY_IDS, SEVERITY_META, STUDY_AREA, type CategoryCode, type GeoFeatureCollection, type AccidentStatus } from "@/lib/domain";
import { localParts } from "@/lib/time";
import { formatInt } from "@/lib/format";
import type { AccidentDetail, AccidentListItem, AuditEntryView, DuplicateCandidate, Paginated } from "@/lib/api-types";
import { MapLegend } from "@/components/MapLegend";
import { legendFor } from "@/components/map-style";
import type { MapSelection } from "@/components/MapView";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-[12px] text-muted">Loading map…</div>,
});

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(iso: string): string {
  const p = localParts(new Date(iso), STUDY_AREA.timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

interface EditForm {
  categoryCode: CategoryCode;
  severityId: number;
  occurredLocal: string;
  vehiclesInvolved: number;
  emergencyServices: boolean;
  description: string;
  lon: number;
  lat: number;
}

function toForm(d: AccidentDetail): EditForm {
  return {
    categoryCode: d.categoryCode,
    severityId: d.severityId,
    occurredLocal: toLocalInput(d.occurredAt),
    vehiclesInvolved: d.vehiclesInvolved,
    emergencyServices: d.emergencyServices,
    description: d.description ?? "",
    lon: d.lon,
    lat: d.lat,
  };
}

export default function AdminPage() {
  const { isAdmin, meta } = useApp();
  const [view, setView] = useState<"queue" | "audit">("queue");

  if (!meta) return <div className="p-6"><Spinner label="Loading" /></div>;
  if (!isAdmin) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4 p-8">
        <Alert tone="warn" title="Administrator sign-in required">
          Review, editing, and audit views contain personal narrative details and are restricted to administrators.
        </Alert>
        <Link href="/login" className="inline-flex h-8 w-fit items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:brightness-110">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-accent" />
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Review & administration</h1>
            <p className="text-[11.5px] text-muted">Verify, reject or de-duplicate citizen reports; correct records; inspect the audit trail.</p>
          </div>
        </div>
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "queue", label: "Review queue" },
            { value: "audit", label: "Audit trail" },
          ]}
        />
      </div>
      {view === "queue" ? <ReviewQueue /> : <AuditTrail />}
    </div>
  );
}

function ReviewQueue() {
  const [status, setStatus] = useState<AccidentStatus>("reported");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useApi<Paginated<AccidentListItem>>(`/accidents?statuses=${status}&sort=reported&order=desc&pageSize=30&page=${page}`);
  const items = (list.data?.items ?? []).filter((i) => !flaggedOnly || i.qualityFlags.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <aside className="scroll-thin flex w-full shrink-0 flex-col gap-2.5 overflow-y-auto border-line bg-panel p-3 xl:w-[360px] xl:border-r">
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "reported", label: "Pending" },
            { value: "duplicate", label: "Duplicates" },
            { value: "rejected", label: "Rejected" },
            { value: "verified", label: "Verified" },
          ]}
        />
        <div className="flex items-center justify-between">
          <Chip active={flaggedOnly} onClick={() => setFlaggedOnly((v) => !v)}>
            Flagged only
          </Chip>
          <span className="font-mono text-[11px] text-muted">{list.data ? `${formatInt(list.data.total)} records` : ""}</span>
        </div>
        {list.loading && !list.data ? <Spinner /> : null}
        {list.error ? <Alert tone="error">{list.error}</Alert> : null}
        <ul className="flex flex-col gap-1">
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={cx("flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors", selectedId === r.id ? "border-accent/60 bg-accent/10" : "border-line hover:border-faint")}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] font-medium">#{r.id} · {r.categoryLabel}</span>
                  <StatusBadge status={r.status} />
                </span>
                <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                  <span>{r.occurredAt.slice(0, 16).replace("T", " ")} UTC · {r.severityLabel}</span>
                  <span className="font-mono">{r.datasetKind === "citizen" ? "citizen" : r.isSynthetic ? "synthetic" : "real"}</span>
                </span>
                {r.qualityFlags.length ? (
                  <span className="flex flex-wrap gap-1">
                    {r.qualityFlags.map((f) => (
                      <Badge key={f} tone="warn" className="!text-[10px]">
                        {f.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {!items.length && list.data ? <p className="py-6 text-center text-[12px] text-muted">Nothing in this view.</p> : null}
        <div className="flex items-center justify-between pt-1">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="text-[11px] text-muted">
            Page {page} / {list.data?.totalPages ?? 1}
          </span>
          <Button size="sm" variant="secondary" disabled={!list.data || page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </aside>
      <section className="scroll-thin min-w-0 flex-1 overflow-y-auto p-4">
        {selectedId ? <RecordReview id={selectedId} onChanged={() => list.reload()} /> : (
          <div className="grid h-full place-items-center text-center text-[12.5px] text-muted">
            <div className="flex flex-col items-center gap-2">
              <FileWarning size={22} className="text-faint" />
              Select a record to review its details, location, duplicates and history.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RecordReview({ id, onChanged }: { id: number; onChanged: () => void }) {
  const detail = useApi<AccidentDetail>(`/accidents/${id}`);
  const [form, setForm] = useState<EditForm | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [note, setNote] = useState("");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [similar, setSimilar] = useState<DuplicateCandidate[] | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);

  useEffect(() => {
    if (detail.data) setForm(toForm(detail.data));
    setFeedback(null);
    setSimilar(null);
  }, [detail.data]);

  const d = detail.data;
  const original = useMemo(() => (d ? toForm(d) : null), [d]);
  const changedKeys = form && original ? (Object.keys(form) as (keyof EditForm)[]).filter((k) => form[k] !== original[k]) : [];

  const act = async (action: "verify" | "reject" | "mark_duplicate" | "reopen", extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setFeedback(null);
    try {
      await apiPost(`/accidents/${id}/review`, { action, note: note || undefined, ...extra });
      setFeedback({ tone: "ok", text: `Recorded: ${action.replace(/_/g, " ")}.` });
      setNote("");
      detail.reload();
      onChanged();
    } catch (err) {
      setFeedback({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form || changedKeys.length === 0) return;
    setBusy(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = {};
      for (const k of changedKeys) body[k] = form[k];
      if (changedKeys.includes("lon") || changedKeys.includes("lat")) {
        body.lon = form.lon;
        body.lat = form.lat;
      }
      if (note) body.note = note;
      await apiPatch(`/accidents/${id}`, body);
      setFeedback({ tone: "ok", text: `Saved ${changedKeys.length} change(s) with an audit entry.` });
      setNote("");
      detail.reload();
      onChanged();
    } catch (err) {
      setFeedback({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const findSimilar = async () => {
    if (!d) return;
    try {
      const r = await apiPost<{ candidates: DuplicateCandidate[] }>("/accidents/check-duplicates", {
        lon: d.lon,
        lat: d.lat,
        occurredLocal: toLocalInput(d.occurredAt),
        categoryCode: d.categoryCode,
      });
      setSimilar(r.candidates.filter((c) => c.id !== id));
    } catch (err) {
      setFeedback({ tone: "error", text: errorMessage(err) });
    }
  };

  if (detail.loading && !d) return <Spinner label="Loading record" />;
  if (detail.error) return <Alert tone="error">{detail.error}</Alert>;
  if (!d || !form) return null;

  const pointFc: GeoFeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [d.reportedLon, d.reportedLat] }, properties: { id: d.id, status: d.status, severityId: d.severityId } }],
  };
  const canVerify = d.status !== "verified";
  const canReject = d.status !== "rejected";
  const canDuplicate = d.status !== "duplicate";
  const canReopen = d.status !== "reported";
  const field = (k: keyof EditForm) => form[k] as string | number;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">Record #{d.id} · {d.categoryLabel}</h2>
          <p className="text-[12px] text-muted">
            {d.occurredAt.slice(0, 16).replace("T", " ")} UTC · reported after {d.reportingDelayMin} min · {d.datasetName}
            {d.trackingCode ? <> · tracking <span className="font-mono">{d.trackingCode}</span></> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={d.status} />
          {d.isSynthetic ? <Badge tone="synthetic">Synthetic</Badge> : <Badge tone="neutral">Real / citizen</Badge>}
        </div>
      </div>

      {feedback ? <Alert tone={feedback.tone === "ok" ? "ok" : "error"}>{feedback.text}</Alert> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          <Panel title="Decision" subtitle="Each decision is recorded in the verification history and the audit trail">
            <div className="flex flex-col gap-3">
              <Field label="Reviewer note (optional)">
                <textarea className={textareaCls} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Evidence or reason for this decision" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<Check size={13} />} disabled={!canVerify} busy={busy} onClick={() => void act("verify")}>
                  Verify
                </Button>
                <Button variant="danger" icon={<X size={13} />} disabled={!canReject} busy={busy} onClick={() => void act("reject")}>
                  Reject
                </Button>
                <Button variant="secondary" icon={<Undo2 size={13} />} disabled={!canReopen} busy={busy} onClick={() => void act("reopen")}>
                  Reopen
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <Field label="Duplicate of record #" className="w-44">
                  <input className={inputCls} inputMode="numeric" value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 1234" />
                </Field>
                <Button variant="secondary" disabled={!canDuplicate || !duplicateOf} busy={busy} onClick={() => void act("mark_duplicate", { duplicateOfId: Number(duplicateOf) })}>
                  Mark as duplicate
                </Button>
                <Button variant="ghost" icon={<Crosshair size={13} />} onClick={() => void findSimilar()}>
                  Find similar incidents
                </Button>
              </div>
              {d.duplicateCandidate ? (
                <Alert tone="warn" title={`Possible duplicate of record #${d.duplicateCandidate.id}`}>
                  <span className="flex flex-wrap items-center gap-2">
                    {d.duplicateCandidate.categoryLabel} · {d.duplicateCandidate.occurredAt.slice(0, 16).replace("T", " ")} UTC · {d.duplicateCandidate.status}
                    <Button size="sm" variant="secondary" onClick={() => setDuplicateOf(String(d.duplicateCandidate!.id))}>
                      Use as original
                    </Button>
                  </span>
                </Alert>
              ) : null}
              {similar ? (
                similar.length ? (
                  <ul className="flex flex-col gap-1 rounded-md border border-line p-2 text-[12px]">
                    {similar.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="font-mono">#{c.id} · {c.distanceM} m · {c.deltaMinutes} min · score {c.score.toFixed(2)} · {c.status}</span>
                        <Button size="sm" variant="ghost" onClick={() => setDuplicateOf(String(c.id))}>
                          Use
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12px] text-muted">No similar incidents within 120 m and 2 hours in the same category.</p>
                )
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Edit record"
            subtitle="Corrections are versioned: original reported coordinates are never overwritten"
            actions={
              <Button size="sm" variant="primary" icon={<Pencil size={12} />} disabled={changedKeys.length === 0} busy={busy} onClick={() => void save()}>
                Save {changedKeys.length ? `${changedKeys.length} change(s)` : ""}
              </Button>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Category">
                <select className={inputCls} value={field("categoryCode")} onChange={(e) => setForm({ ...form, categoryCode: e.target.value as CategoryCode })}>
                  {CATEGORY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Severity">
                <select className={inputCls} value={field("severityId")} onChange={(e) => setForm({ ...form, severityId: Number(e.target.value) })}>
                  {SEVERITY_IDS.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_META[s].label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Occurred (local, ${STUDY_AREA.timeZone})`}>
                <input type="datetime-local" className={inputCls} value={field("occurredLocal")} onChange={(e) => setForm({ ...form, occurredLocal: e.target.value })} />
              </Field>
              <Field label="Vehicles / road users">
                <input type="number" min={1} max={50} className={inputCls} value={field("vehiclesInvolved")} onChange={(e) => setForm({ ...form, vehiclesInvolved: Number(e.target.value) })} />
              </Field>
              <Field label="Emergency services">
                <Segmented
                  size="sm"
                  value={field("emergencyServices") ? "yes" : "no"}
                  options={[
                    { value: "no", label: "Not involved" },
                    { value: "yes", label: "Attended" },
                  ]}
                  onChange={(v) => setForm({ ...form, emergencyServices: v === "yes" })}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className={labelCls}>Analysis location</span>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" step="0.00001" className={cx(inputCls, "font-mono")} value={field("lon")} onChange={(e) => setForm({ ...form, lon: Number(e.target.value) })} aria-label="Longitude" />
                  <input type="number" step="0.00001" className={cx(inputCls, "font-mono")} value={field("lat")} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} aria-label="Latitude" />
                </div>
                <Button size="sm" variant={pickMode ? "primary" : "secondary"} onClick={() => setPickMode((v) => !v)}>
                  {pickMode ? "Click the map to move the point" : "Move on map"}
                </Button>
              </div>
              <Field label="Narrative" className="md:col-span-2">
                <textarea className={textareaCls} rows={3} maxLength={1000} value={field("description")} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
            <p className="mt-3 text-[11px] text-faint">Reported location: {d.reportedLon.toFixed(5)}, {d.reportedLat.toFixed(5)} · source {d.locationSource} · snap {d.snapDistanceM === null ? "—" : `${d.snapDistanceM.toFixed(0)} m`}</p>
          </Panel>

          <Panel title="Verification history">
            {d.verifications && d.verifications.length ? (
              <ol className="flex flex-col gap-2 border-l border-line pl-3 text-[12px]">
                {d.verifications.map((v) => (
                  <li key={v.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{v.action.replace(/_/g, " ")}</span>
                      <span className="font-mono text-[10.5px] text-faint">{v.createdAt.slice(0, 16).replace("T", " ")} UTC</span>
                    </div>
                    <div className="text-muted">
                      {v.previousStatus ?? "—"} → {v.newStatus ?? "—"} · {v.reviewerEmail ?? "system"}
                    </div>
                    {v.note ? <div className="text-[11.5px] italic text-muted">“{v.note}”</div> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12px] text-muted">No review actions yet.</p>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="Location">
            <div className="relative h-56 overflow-hidden rounded-md border border-line">
              <MapView
                basemap="dark"
                points={pointFc}
                pointsMode="points"
                roads={null}
                roadsMode="hidden"
                analysis={null}
                analysisKind={null}
                picked={pickMode ? [form.lon, form.lat] : null}
                pickMode={pickMode}
                focus={{ lon: d.reportedLon, lat: d.reportedLat, zoom: 15, nonce: focusNonce + id }}
                onPick={(lon, lat) => {
                  setForm({ ...form, lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) });
                  setPickMode(false);
                }}
                onSelect={(_sel: MapSelection | null) => setFocusNonce((n) => n + 1)}
                className="h-full"
              />
            </div>
            <div className="mt-2">
              <MapLegend spec={legendFor("points")} />
            </div>
          </Panel>

          <Panel title="Details">
            <KeyValue
              rows={[
                ["Vehicles", String(d.vehiclesInvolved)],
                ["Severity", d.severityLabel],
                ["Reporter", d.trackingCode ? "pseudonymous" : "—"],
                ["Reported", d.reportedAt.slice(0, 16).replace("T", " ") + " UTC"],
                ["Quality flags", d.qualityFlags.length ? d.qualityFlags.map((f) => f.replace(/_/g, " ")).join(", ") : "none"],
              ]}
            />
            {d.qualityFlags.length ? (
              <ul className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
                {d.qualityFlags.map((f) => (
                  <li key={f}>• {QUALITY_FLAG_META[f as keyof typeof QUALITY_FLAG_META] ?? f}</li>
                ))}
              </ul>
            ) : null}
          </Panel>

          <Panel title="Photographs">
            {d.attachments.length ? (
              <ul className="flex flex-col gap-1 text-[12px]">
                {d.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded px-1.5 py-1 hover:bg-panel-2">
                      <span className="truncate">{a.filename}</span>
                      <span className="font-mono text-[10.5px] text-muted">{formatInt(a.byteSize / 1024)} KB</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-muted">No photographs attached.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AuditTrail() {
  const audit = useApi<{ items: AuditEntryView[] }>("/audit?limit=200");
  return (
    <div className="scroll-thin flex-1 overflow-auto p-4">
      <Panel title="Audit trail" subtitle="Append-only record of administrative and submission events; IP addresses are stored only as keyed hashes" actions={<Button size="sm" variant="secondary" onClick={() => audit.reload()}>Refresh</Button>}>
        {audit.loading && !audit.data ? <Spinner /> : null}
        {audit.data ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead className="text-left text-[10.5px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">When (UTC)</th>
                  <th className="py-1.5 pr-3 font-medium">Action</th>
                  <th className="py-1.5 pr-3 font-medium">Entity</th>
                  <th className="py-1.5 pr-3 font-medium">Actor</th>
                  <th className="py-1.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11px] text-muted">{e.createdAt.slice(0, 19).replace("T", " ")}</td>
                    <td className="py-1.5 pr-3 font-medium">{e.action}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11px]">
                      {e.entityType}
                      {e.entityId ? ` #${e.entityId}` : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{e.actorEmail ?? "public"}</td>
                    <td className="max-w-[360px] truncate py-1.5 font-mono text-[10.5px] text-muted" title={JSON.stringify(e.changes)}>
                      {Object.keys(e.changes).length ? JSON.stringify(e.changes) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}


