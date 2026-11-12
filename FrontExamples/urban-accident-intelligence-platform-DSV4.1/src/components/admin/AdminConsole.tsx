"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Database, FileWarning, History, Layers, Search, ShieldCheck, XCircle } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { EChart } from "@/components/charts/EChart";
import { Callout, CoverageBar, Divider, EmptyState, Kpi, LoadingRows, MetricGrid, Panel, SectionLabel, Spinner, StatusBadge, ToggleChip } from "@/components/ui";
import { comparisonOption } from "@/lib/chartOptions";
import { formatDateTime, formatNumber, formatPct, useApi, type NetworkResponse } from "@/lib/client/api";

type QueueItem = {
  id: number;
  publicId: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  categoryCode: string;
  severityCode: number;
  district: string | null;
  roadSegmentId: string | null;
  description: string | null;
  lat: number;
  lng: number;
  positionalUncertaintyM: number;
  duplicateScore: number | null;
  duplicateOfId: number | null;
  qualityFlags: string[] | null;
  reporterName: string | null;
  locationMethod: string;
};

type AdminPayload = {
  queue: QueueItem[];
  audit: { id: number; actor: string; action: string; entityType: string; entityId: string | null; createdAt: string }[];
  datasets: { id: number; slug: string; name: string; kind: string; scenario: string | null; seed: number | null; isActive: boolean; description: string | null }[];
  quality: {
    totalRecords: number;
    pending: number;
    duplicates: number;
    rejected: number;
    verifiedShare: number;
    weatherCompleteness: number;
    segmentCompleteness: number;
    descriptionCompleteness: number;
    lightingCompleteness: number;
    medianDelayHours: number;
    p90DelayHours: number;
    medianUncertaintyM: number;
    uncertaintyOver30m: number;
    qualityFlags: { flag: string; count: number }[];
  };
};

const TABS = [
  { key: "queue", label: "Review queue", icon: ClipboardCheck },
  { key: "quality", label: "Data quality", icon: FileWarning },
  { key: "audit", label: "Audit trail", icon: History },
  { key: "datasets", label: "Datasets", icon: Database },
] as const;

export function AdminConsole({ actor }: { actor: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("queue");
  const [status, setStatus] = useState<string[]>(["reported"]);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [notes, setNotes] = useState("");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [editSeverity, setEditSeverity] = useState<string>("");
  const [editDescription, setEditDescription] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const statusParam = status.join(",");
  const admin = useApi<AdminPayload>(`/api/admin?view=${tab}&status=${statusParam}`, [statusParam, refreshKey, tab]);
  const network = useApi<NetworkResponse>("/api/network");

  useEffect(() => {
    if (selected) {
      setEditSeverity(String(selected.severityCode));
      setEditDescription(selected.description ?? "");
      setDuplicateOf("");
      setNotes("");
    }
  }, [selected]);

  const selectedFeature = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!selected) return { type: "FeatureCollection", features: [] };
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [selected.lng, selected.lat] },
          properties: {
            publicId: selected.publicId,
            severity: selected.severityCode,
            status: selected.status,
            category: selected.categoryCode,
            occurredAt: selected.occurredAt,
          },
        },
      ],
    };
  }, [selected]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Action failed");
      setMessage({ tone: "ok", text: `Action applied. Record state: ${payload.status ?? "updated"}.` });
      setSelected(null);
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const quality = admin.data?.quality;
  const queue = admin.data?.queue ?? [];

  return (
    <div className="mx-auto max-w-[1680px] space-y-2.5 p-2.5">
      <header className="panel flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div>
          <h1 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <ShieldCheck size={15} className="text-accent" /> Moderation & data quality
          </h1>
          <p className="text-[11px] text-muted">Signed in as {actor}. Every moderation action is recorded in the audit trail with previous and new state.</p>
        </div>
        <div className="flex items-center gap-2">
          {admin.loading && <Spinner label="loading" />}
          <span className="badge badge-warn">admin</span>
          <Link href="/" className="btn btn-xs">
            Explorer
          </Link>
        </div>
      </header>

      {message && (
        <Callout tone={message.tone === "ok" ? "info" : "danger"} title={message.tone === "ok" ? "Moderation updated" : "Action failed"}>
          {message.text}
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Total records" value={formatNumber(quality?.totalRecords ?? 0)} detail="excl. duplicates" tone="accent" />
        <Kpi label="Pending" value={formatNumber(quality?.pending ?? 0)} detail="awaiting review" tone="warn" />
        <Kpi label="Duplicates flagged" value={formatNumber(quality?.duplicates ?? 0)} detail="linked to originals" />
        <Kpi label="Rejected" value={formatNumber(quality?.rejected ?? 0)} detail="retained for audit" />
        <Kpi label="Verified share" value={formatPct(quality?.verifiedShare ?? 0, 1)} detail="of filtered records" tone="ok" />
        <Kpi label="Median delay" value={`${(quality?.medianDelayHours ?? 0).toFixed(1)} h`} detail={`P90 ${(quality?.p90DelayHours ?? 0).toFixed(0)} h`} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1.5 text-[11.5px] focus-ring ${
                tab === item.key ? "border-accent bg-[var(--accent-soft)] text-accent" : "border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              <Icon size={12} /> {item.label}
            </button>
          );
        })}
      </div>

      {tab === "queue" && (
        <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Panel
            title="Review queue"
            icon={<ClipboardCheck size={12} />}
            actions={
              <div className="flex flex-wrap gap-1">
                {["reported", "verified", "rejected", "duplicate"].map((value) => (
                  <ToggleChip key={value} active={status.includes(value)} onClick={() => setStatus((current) => (current.includes(value) ? current.filter((s) => s !== value) : [...current, value]))}>
                    {value}
                  </ToggleChip>
                ))}
              </div>
            }
            flush
          >
            {admin.loading && !admin.data ? (
              <div className="p-2"><LoadingRows rows={8} /></div>
            ) : queue.length === 0 ? (
              <EmptyState title="Queue empty" message="No records match the selected states. Try adding verified or rejected." icon={<CheckCircle2 size={22} />} />
            ) : (
              <div className="max-h-[520px] overflow-auto scroll-thin">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Occurred (UTC)</th>
                      <th>Category</th>
                      <th>Sev</th>
                      <th>District</th>
                      <th className="num">± m</th>
                      <th className="num">dup</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((item) => (
                      <tr key={item.id} className={`cursor-pointer ${selected?.id === item.id ? "bg-panel2" : ""}`} onClick={() => setSelected(item)}>
                        <td className="mono text-ink">{item.publicId}</td>
                        <td className="mono">{formatDateTime(item.occurredAt)}</td>
                        <td>{item.categoryCode.replace(/_/g, " ")}</td>
                        <td className="num">{item.severityCode}</td>
                        <td className="max-w-[100px] truncate">{item.district ?? "—"}</td>
                        <td className="num">{item.positionalUncertaintyM.toFixed(0)}</td>
                        <td className="num">{item.duplicateScore ? item.duplicateScore.toFixed(2) : "—"}</td>
                        <td><StatusBadge status={item.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-line px-2 py-1 text-[9.5px] text-faint">
              Showing {queue.length} records. Queue is ordered oldest-first to prevent starvation of the review backlog.
            </div>
          </Panel>

          <div className="space-y-2.5">
            {selected ? (
              <>
                <Panel title="Moderation detail" icon={<Search size={12} />} actions={<StatusBadge status={selected.status} />}>
                  <div className="space-y-2">
                    <div>
                      <div className="mono text-[12.5px] font-semibold text-ink">{selected.publicId}</div>
                      <div className="text-[10.5px] text-faint">
                        {selected.categoryCode.replace(/_/g, " ")} · severity {selected.severityCode} · {selected.district ?? "—"}
                      </div>
                    </div>
                    <p className="border-l-2 border-line pl-2 text-[11px] leading-relaxed text-muted">{selected.description}</p>
                    <MetricGrid
                      metrics={[
                        { label: "Occurred", value: formatDateTime(selected.occurredAt) },
                        { label: "Reported", value: formatDateTime(selected.reportedAt) },
                        { label: "Location method", value: selected.locationMethod },
                        { label: "Position ±", value: `${selected.positionalUncertaintyM.toFixed(0)} m` },
                        { label: "Segment", value: selected.roadSegmentId ?? "unmatched" },
                        { label: "Reporter", value: selected.reporterName ?? "anonymous" },
                        { label: "Duplicate score", value: selected.duplicateScore ? selected.duplicateScore.toFixed(3) : "—" },
                        { label: "Linked duplicate of", value: selected.duplicateOfId ? `#${selected.duplicateOfId}` : "—" },
                      ]}
                    />
                    <div className="h-[190px] overflow-hidden rounded border border-line">
                      <MapView
                        mode="points"
                        accidents={selectedFeature}
                        network={network.data}
                        basemap="night"
                        toggles={{ roads: true, districts: true, water: true, parks: false, intersections: false }}
                        selectedPublicId={selected.publicId}
                        legend={[{ label: "Selected report", color: "#2dd4bf" }]}
                        fitBounds={[[selected.lng - 0.012, selected.lat - 0.008], [selected.lng + 0.012, selected.lat + 0.008]]}
                        fitNonce={selected.id}
                        onSelectAccident={() => undefined}
                      />
                    </div>
                    {(selected.qualityFlags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {(selected.qualityFlags ?? []).map((flag) => (
                          <span key={flag} className="badge badge-warn">{flag.replace(/_/g, " ")}</span>
                        ))}
                      </div>
                    )}
                    <label className="block">
                      <span className="label-caps mb-1 block">Moderator notes (stored in timeline)</span>
                      <textarea className="textarea" style={{ minHeight: 60 }} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Evidence used, e.g. police log cross-check, duplicate cluster confirmed…" />
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" className="btn btn-primary btn-xs" disabled={busy} onClick={() => act({ action: "verify", publicId: selected.publicId, notes })}>
                        <CheckCircle2 size={11} /> Verify
                      </button>
                      <button type="button" className="btn btn-danger btn-xs" disabled={busy} onClick={() => act({ action: "reject", publicId: selected.publicId, notes })}>
                        <XCircle size={11} /> Reject
                      </button>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1">
                      <input className="input" placeholder="Original reference (e.g. VNT-2025-00012)" value={duplicateOf} onChange={(event) => setDuplicateOf(event.target.value)} />
                      <button type="button" className="btn btn-xs" disabled={busy || !duplicateOf} onClick={() => act({ action: "mark_duplicate", publicId: selected.publicId, duplicateOfPublicId: duplicateOf, notes })}>
                        Mark duplicate
                      </button>
                    </div>
                    <button type="button" className="btn btn-xs" disabled={busy} onClick={() => act({ action: "reopen", publicId: selected.publicId, notes })}>
                      Reopen as pending
                    </button>
                    <Divider label="edit record" />
                    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-1">
                      <select className="select" value={editSeverity} onChange={(event) => setEditSeverity(event.target.value)}>
                        {[1, 2, 3, 4].map((value) => (
                          <option key={value} value={value}>Severity {value}</option>
                        ))}
                      </select>
                      <input className="input" value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="Corrected description" />
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs w-full"
                      disabled={busy}
                      onClick={() =>
                        act({
                          action: "edit",
                          publicId: selected.publicId,
                          severityCode: Number(editSeverity),
                          description: editDescription,
                          notes: notes || "Record corrected during moderation.",
                        })
                      }
                    >
                      Save correction
                    </button>
                    <p className="text-[9.5px] leading-relaxed text-faint">
                      Corrections preserve the original submission values in the audit log. Verification means a moderator checked the record — it is
                      not a legal determination of fault.
                    </p>
                  </div>
                </Panel>
              </>
            ) : (
              <Panel title="Moderation detail" icon={<Search size={12} />}>
                <EmptyState title="Select a record" message="Choose a record from the queue to inspect its provenance, duplicate score and quality flags, then verify, reject or merge." icon={<ClipboardCheck size={22} />} />
              </Panel>
            )}
          </div>
        </div>
      )}

      {tab === "quality" && quality && (
        <div className="grid gap-2.5 lg:grid-cols-3">
          <Panel title="Completeness" icon={<FileWarning size={12} />}>
            <div className="space-y-2">
              <CoverageBar label="Verified records" value={quality.verifiedShare} hint="Published verification state" />
              <CoverageBar label="Environmental context" value={quality.weatherCompleteness} hint="Weather joined to incident" />
              <CoverageBar label="Lighting context" value={quality.lightingCompleteness} />
              <CoverageBar label="Road-segment matched" value={quality.segmentCompleteness} hint="Within 70 m of the network" />
              <CoverageBar label="Narrative description" value={quality.descriptionCompleteness} />
            </div>
            <Divider label="uncertainty" />
            <MetricGrid
              metrics={[
                { label: "Median positional ±", value: `${quality.medianUncertaintyM.toFixed(1)} m` },
                { label: "Share > 30 m", value: formatPct(quality.uncertaintyOver30m, 1) },
                { label: "Median reporting delay", value: `${quality.medianDelayHours.toFixed(1)} h` },
                { label: "P90 delay", value: `${quality.p90DelayHours.toFixed(0)} h` },
              ]}
            />
          </Panel>
          <Panel title="Quality flags" icon={<Layers size={12} />}>
            {quality.qualityFlags.length === 0 ? (
              <EmptyState title="No flags" message="All records passed the automated quality checks." />
            ) : (
              <div className="space-y-1.5">
                {quality.qualityFlags.map((flag) => (
                  <div key={flag.flag}>
                    <div className="mb-0.5 flex justify-between text-[10.5px]">
                      <span className="text-muted">{flag.flag.replace(/_/g, " ")}</span>
                      <span className="mono text-ink">{flag.count}</span>
                    </div>
                    <div className="progress">
                      <span style={{ width: `${Math.min(100, (flag.count / Math.max(1, quality.totalRecords)) * 100)}%`, background: "var(--warn)" }} />
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-[9.5px] leading-relaxed text-faint">Flags are advisory; a flagged record can still be verified after review.</p>
              </div>
            )}
          </Panel>
          <Panel title="Review throughput" icon={<ClipboardCheck size={12} />}>
            <EChart
              option={comparisonOption(
                ["Pending", "Verified", "Rejected", "Duplicates"],
                [
                  {
                    name: "Records",
                    data: [quality.pending, quality.totalRecords - quality.pending - quality.rejected, quality.rejected, quality.duplicates],
                    color: "#22d3ee",
                  },
                ],
              )}
              height={170}
            />
            <Callout tone="warn" title="Workflow discipline">
              Unverified crowdsourced reports must not be merged into official statistics without independent corroboration. The platform keeps
              pending records distinct everywhere.
            </Callout>
          </Panel>
        </div>
      )}

      {tab === "audit" && (
        <Panel title="Audit trail" icon={<History size={12} />} flush>
          {admin.loading ? (
            <div className="p-2"><LoadingRows rows={8} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto scroll-thin">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When (UTC)</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {(admin.data?.audit ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono">{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.actor}</td>
                      <td className="mono text-accent">{entry.action}</td>
                      <td>{entry.entityType}</td>
                      <td className="mono">{entry.entityId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === "datasets" && (
        <div className="grid gap-2.5 lg:grid-cols-3">
          {(admin.data?.datasets ?? []).map((dataset) => (
            <Panel key={dataset.id} title={dataset.name} icon={<Database size={12} />} actions={<span className={`badge ${dataset.kind === "synthetic" ? "badge-warn" : "badge-accent"}`}>{dataset.kind}</span>}>
              <div className="space-y-2">
                <p className="text-[10.5px] leading-relaxed text-muted">{dataset.description}</p>
                <MetricGrid
                  metrics={[
                    { label: "Slug", value: dataset.slug },
                    { label: "Scenario", value: dataset.scenario ?? "—" },
                    { label: "Seed", value: String(dataset.seed ?? "—") },
                    { label: "Active", value: dataset.isActive ? "published" : "retired" },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-xs w-full"
                  disabled={busy}
                  onClick={() => act({ action: dataset.isActive ? "deactivate_dataset" : "activate_dataset", datasetId: dataset.id })}
                >
                  {dataset.isActive ? "Retire dataset" : "Publish dataset"}
                </button>
                <p className="text-[9.5px] leading-relaxed text-faint">
                  Synthetic and observed datasets are managed separately. Retiring a dataset hides it from catalogue consumers without deleting its
                  records.
                </p>
              </div>
            </Panel>
          ))}
          <Panel title="Generator provenance" icon={<Database size={12} />}>
            <p className="text-[10.5px] leading-relaxed text-muted">
              All records originate from <span className="mono text-ink">src/lib/seed</span> with a fixed seed. The generator injects reporting
              delays, coarse geocoding, missing environmental context and duplicate clusters so that the moderation workflow can be exercised and
              audited. Reseeding requires an explicit database reset.
            </p>
            <SectionLabel right={<span className="mono text-[10px] text-accent">v1.0</span>}>interfaces</SectionLabel>
            <div className="space-y-1 text-[10px] text-muted">
              <div className="flex justify-between"><span>Accident table</span><span className="mono text-ink">accidents</span></div>
              <div className="flex justify-between"><span>Verification events</span><span className="mono text-ink">report_verifications</span></div>
              <div className="flex justify-between"><span>Change history</span><span className="mono text-ink">audit_logs</span></div>
              <div className="flex justify-between"><span>Analysis provenance</span><span className="mono text-ink">spatial_analysis_jobs</span></div>
            </div>
          </Panel>
        </div>
      )}

      <div className="pb-2 text-[9.5px] text-faint">
        {admin.error ? `Error: ${admin.error}` : "Moderation queue updates on action. Rejected records are retained for audit and excluded from analytics unless explicitly selected."}
      </div>
    </div>
  );
}
