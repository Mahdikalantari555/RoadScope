"use client";

/**
 * F. Administration & Data Quality — report review, duplicate triage,
 * dataset registry and audit trail.
 */

import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  History,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useApp } from "@/lib/appState";
import {
  Badge,
  Btn,
  Chip,
  DataTable,
  Field,
  MicroLabel,
  Panel,
  Select,
  Stat,
  TextArea,
  TextInput,
} from "@/components/ui";
import { StatRow } from "@/components/LayerInfo";
import { computeDashboard } from "@/lib/stats";
import type { Accident, DatasetSource, AuditLogEntry, ReportStatus } from "@/lib/types";
import { SEVERITIES } from "@/lib/constants";

type Tab = "queue" | "quality" | "datasets" | "audit";

export default function AdminView() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("queue");
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("pending");
  const [rows, setRows] = useState<Accident[]>(app.accidents);
  const [selected, setSelected] = useState<Accident | null>(null);
  const [notes, setNotes] = useState("");
  const [datasets, setDatasets] = useState<DatasetSource[] | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scenario, setScenario] = useState("mixed");
  const [seed, setSeed] = useState(20240917);

  const queue = useMemo(
    () =>
      rows
        .filter((a) => (statusFilter === "all" ? true : a.status === statusFilter))
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
        .slice(0, 300),
    [rows, statusFilter],
  );

  const stats = useMemo(() => computeDashboard(rows, app.segments), [rows, app.segments]);

  const quality = useMemo(() => {
    const total = rows.length || 1;
    const imprecise = rows.filter((a) => a.positionalAccuracyM > 25).length;
    const noSegment = rows.filter((a) => a.roadSegmentId == null).length;
    const longDelay = rows.filter((a) => a.reportDelayH > 24).length;
    const dups = rows.filter((a) => a.status === "duplicate").length;
    const rejected = rows.filter((a) => a.status === "rejected").length;
    const withAttachments = rows.filter((a) => a.attachmentCount > 0).length;
    return {
      imprecise,
      noSegment,
      longDelay,
      dups,
      rejected,
      withAttachments,
      ratios: {
        imprecise: imprecise / total,
        noSegment: noSegment / total,
        longDelay: longDelay / total,
        dups: dups / total,
        rejected: rejected / total,
        withAttachments: withAttachments / total,
      },
      total,
    };
  }, [rows]);

  const loadDatasets = async () => {
    setBusy(true);
    const res = await fetch("/api/datasets");
    const body = await res.json();
    setDatasets(body.data);
    setBusy(false);
  };

  const loadAudit = async () => {
    setBusy(true);
    const res = await fetch("/api/audit");
    const body = await res.json();
    setAudit(body.audit);
    setBusy(false);
  };

  React.useEffect(() => {
    if (tab === "datasets" && !datasets) void loadDatasets();
    if (tab === "audit" && !audit) void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const decide = async (decision: "verified" | "rejected" | "duplicate") => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/accidents/${selected.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reviewerName: app.role === "administrator" ? "Meridian Traffic Control" : "Contributor",
          reviewerUserId: app.role === "administrator" ? 1 : 3,
          confidence: 0.86,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "Review failed");
        return;
      }
      setRows((rs) =>
        rs.map((r) =>
          r.id === selected.id
            ? { ...r, status: decision, rejectReason: decision === "rejected" ? notes || r.rejectReason : null }
            : r,
        ),
      );
      setMessage(`${selected.publicId} marked ${decision}. Audit entry written.`);
      setNotes("");
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario, seed, actorName: "Meridian Traffic Control" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "Regeneration failed");
        return;
      }
      setMessage(
        `Corpus regenerated: scenario ${scenario}, seed ${seed}, ${body.result.accidents} reports in ${body.result.durationMs} ms. Reload the console to see the new corpus.`,
      );
      setDatasets(null);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "queue", label: "Review queue" },
    { value: "quality", label: "Data quality" },
    { value: "datasets", label: "Dataset registry" },
    { value: "audit", label: "Audit trail" },
  ];

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[318px] shrink-0 flex-col overflow-y-auto border-r border-[var(--rule)] bg-[var(--panel)]">
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative px-3 py-3">
            <MicroLabel rule={false}>Module F</MicroLabel>
            <h2 className="mt-1.5 text-[19px] leading-[1.1] font-bold tracking-[-0.01em] text-[var(--text)]">
              Administration &amp; Data Quality
            </h2>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-[var(--text-3)]">
              Verify, reject, merge and monitor. Role-based permissions gate every mutation and every
              decision is written to the audit trail.
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Console role</MicroLabel>
          <div className="mt-2">
            <Select
              value={app.role}
              onChange={(v) => app.setRole(v as "administrator" | "contributor")}
              options={[
                { value: "administrator", label: "Administrator — review & edit" },
                { value: "contributor", label: "Contributor — report only" },
              ]}
            />
          </div>
          {app.role !== "administrator" && (
            <p className="mt-2 border-l-2 border-[var(--fatal)] px-2 py-1.5 text-[9.5px] leading-[1.6] text-[var(--text-2)]">
              Review actions are disabled for contributors. Verification authority is required to change
              the status of a report.
            </p>
          )}
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Review queue filter</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1">
            {(["pending", "verified", "rejected", "duplicate", "all"] as const).map((s) => (
              <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Corpus summary</MicroLabel>
          <div className="mt-2">
            <StatRow label="Total records" value={String(stats.totals.records)} />
            <StatRow label="Verified" value={String(stats.totals.verified)} tone="var(--cyan)" />
            <StatRow label="Pending review" value={String(stats.totals.pending)} tone="var(--warn)" />
            <StatRow label="Rejected" value={String(stats.totals.rejected)} tone="var(--fatal)" />
            <StatRow label="Flagged duplicate" value={String(stats.totals.duplicate)} />
          </div>
        </div>

        <div className="px-3 py-2.5">
          <MicroLabel>Active vocabulary</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1">
            {SEVERITIES.map((s) => (
              <Chip key={s.code} colour={s.colour} active onClick={() => undefined}>
                {s.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-[1.6] text-[var(--text-3)]">
            Severity weights used in risk indices: fatal 10 · serious 5 · slight 2 · damage only 1. The
            vocabulary is stored in <span className="font-[IBM_Plex_Mono,monospace]">severity_levels</span>{" "}
            and <span className="font-[IBM_Plex_Mono,monospace]">accident_categories</span>.
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative flex flex-wrap items-end justify-between gap-3 px-5 py-4">
            <div>
              <MicroLabel rule={false}>Role-based administration</MicroLabel>
              <h1 className="mt-1.5 text-[27px] leading-[1.05] font-bold tracking-[-0.02em] text-[var(--text)]">
                Data stewardship console
              </h1>
            </div>
            <div className="flex gap-px bg-[var(--rule)]">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  className="h-8 px-3 text-[10px] uppercase tracking-[0.11em] transition-colors"
                  style={{
                    background: tab === t.value ? "var(--panel-3)" : "var(--panel)",
                    color: tab === t.value ? "var(--amber)" : "var(--text-3)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {message && (
          <div className="border-b border-[var(--rule)] bg-[var(--panel-2)] px-5 py-2">
            <span className="text-[10px] text-[var(--cyan)]">{message}</span>
          </div>
        )}

        {tab === "queue" && (
          <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-[1.3fr_1fr]">
            <Panel
              title="Report queue"
              meta={<span className="micro">{queue.length} shown</span>}
              actions={<Clock3 className="h-3.5 w-3.5 text-[var(--text-3)]" />}
            >
              <DataTable
                maxHeight={520}
                activeKey={selected?.id ?? null}
                columns={[
                  { key: "id", label: "Report", width: "126px" },
                  { key: "occ", label: "Occurred (UTC)", width: "118px" },
                  { key: "cat", label: "Category" },
                  { key: "sev", label: "Severity", width: "82px" },
                  { key: "acc", label: "± m", align: "right", width: "52px" },
                  { key: "status", label: "Status", width: "82px" },
                ]}
                rows={queue.map((a) => ({
                  __key: a.id,
                  id: <span className="text-[var(--amber)]">{a.publicId}</span>,
                  occ: new Date(a.occurredAt).toISOString().slice(0, 16).replace("T", " "),
                  cat: <span className="text-[var(--text)]">{a.categoryLabel}</span>,
                  sev: (
                    <span style={{ color: SEVERITIES.find((s) => s.code === a.severityCode)?.colour }}>
                      {a.severityLabel}
                    </span>
                  ),
                  acc: a.positionalAccuracyM.toFixed(0),
                  status: (
                    <span
                      style={{
                        color:
                          a.status === "verified"
                            ? "var(--cyan)"
                            : a.status === "pending"
                              ? "var(--warn)"
                              : a.status === "rejected"
                                ? "var(--fatal)"
                                : "var(--text-3)",
                      }}
                    >
                      {a.status}
                    </span>
                  ),
                }))}
                onRowClick={(row) => setSelected(queue.find((q) => q.id === row.__key) ?? null)}
              />
            </Panel>

            <Panel title="Review decision" meta={<span className="micro">administrator</span>}>
              <div className="p-3">
                {!selected ? (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-center">
                    <ShieldCheck className="h-4 w-4 text-[var(--text-3)]" />
                    <p className="text-[10px] leading-[1.7] text-[var(--text-3)]">
                      Select a report from the queue to inspect its provenance and record a review decision.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="tnum text-[10px] text-[var(--amber)]">{selected.publicId}</div>
                    <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">{selected.categoryLabel}</div>
                    <div className="text-[11px] text-[var(--text-2)]">
                      {selected.streetName ?? "Unassigned"} · {selected.district}
                    </div>
                    <div className="mt-3">
                      <StatRow label="Severity" value={selected.severityLabel} />
                      <StatRow label="Occurred (UTC)" value={new Date(selected.occurredAt).toISOString().slice(0, 16).replace("T", " ")} />
                      <StatRow label="Reported (UTC)" value={new Date(selected.reportedAt).toISOString().slice(0, 16).replace("T", " ")} />
                      <StatRow label="Report delay" value={`${selected.reportDelayH.toFixed(1)} h`} />
                      <StatRow label="Positional accuracy" value={`±${selected.positionalAccuracyM.toFixed(1)} m`} />
                      <StatRow label="Geocode precision" value={selected.geocodePrecision} />
                      <StatRow label="Vehicles / casualties" value={`${selected.vehicles} / ${selected.casualties}`} />
                      <StatRow label="Emergency services" value={selected.emergencyServices ? "yes" : "no"} />
                      <StatRow label="Reporter" value={selected.reporterHandle ?? "anonymous"} />
                      <StatRow label="Attachments" value={String(selected.attachmentCount)} />
                      <StatRow label="Current status" value={selected.status} tone="var(--amber)" />
                    </div>
                    {selected.description && (
                      <p className="mt-3 border border-[var(--rule)] bg-[var(--panel-2)] p-2 text-[10px] leading-[1.7] text-[var(--text-2)]">
                        {selected.description}
                      </p>
                    )}
                    <div className="mt-3">
                      <Field label="Review notes">
                        <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Evidence considered, source cross-checked…" />
                      </Field>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn
                        variant="primary"
                        icon={<CheckCircle2 className="h-3 w-3" />}
                        disabled={busy || app.role !== "administrator"}
                        onClick={() => void decide("verified")}
                      >
                        Verify
                      </Btn>
                      <Btn
                        variant="danger"
                        icon={<XCircle className="h-3 w-3" />}
                        disabled={busy || app.role !== "administrator"}
                        onClick={() => void decide("rejected")}
                      >
                        Reject
                      </Btn>
                      <Btn
                        icon={<Copy className="h-3 w-3" />}
                        disabled={busy || app.role !== "administrator"}
                        onClick={() => void decide("duplicate")}
                      >
                        Mark duplicate
                      </Btn>
                    </div>
                    <div className="mt-3 flex items-start gap-2">
                      <Trash2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-3)]" />
                      <p className="text-[9px] leading-[1.65] text-[var(--text-3)]">
                        Records are never deleted. Rejection retains the report, the reason and the reviewer
                        so the decision can be audited or reversed.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </Panel>
          </div>
        )}

        {tab === "quality" && (
          <>
            <div className="grid grid-cols-2 gap-px bg-[var(--rule)] md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Imprecise geocodes" value={quality.imprecise} tone="warn" sub={`${(quality.ratios.imprecise * 100).toFixed(1)}% of corpus`} />
              <Stat label="Unassigned to network" value={quality.noSegment} sub={`${(quality.ratios.noSegment * 100).toFixed(1)}% of corpus`} />
              <Stat label="Delay > 24 h" value={quality.longDelay} sub={`${(quality.ratios.longDelay * 100).toFixed(1)}% of corpus`} />
              <Stat label="Flagged duplicates" value={quality.dups} tone="amber" sub={`${(quality.ratios.dups * 100).toFixed(1)}% of corpus`} />
              <Stat label="Rejected on review" value={quality.rejected} tone="fatal" sub={`${(quality.ratios.rejected * 100).toFixed(1)}% of corpus`} />
              <Stat label="With evidence" value={quality.withAttachments} tone="cyan" sub={`${(quality.ratios.withAttachments * 100).toFixed(1)}% of corpus`} />
            </div>
            <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-2">
              <Panel title="Data quality indicators">
                <div className="p-3">
                  {[
                    ["Positional accuracy > 25 m", quality.ratios.imprecise],
                    ["Not snapped to the road network", quality.ratios.noSegment],
                    ["Reported more than 24 h late", quality.ratios.longDelay],
                    ["Duplicate candidate", quality.ratios.dups],
                    ["Rejected on verification", quality.ratios.rejected],
                    ["Photographic evidence attached", quality.ratios.withAttachments],
                  ].map(([label, ratio]) => (
                    <div key={label as string} className="border-b border-[var(--rule)] py-2">
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10.5px] text-[var(--text-2)]">{label as string}</span>
                        <span className="tnum text-[10px] text-[var(--amber)]">
                          {((ratio as number) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-1 h-[5px] bg-[var(--panel-2)]">
                        <div
                          className="h-full"
                          style={{
                            width: `${(ratio as number) * 100}%`,
                            background: (ratio as number) > 0.25 ? "var(--warn)" : "var(--cyan)",
                            opacity: 0.85,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Duplicate detection rule">
                <div className="p-3">
                  <div className="border border-[var(--rule-strong)] bg-[var(--panel-2)] p-2">
                    <code className="font-[IBM_Plex_Mono,monospace] text-[10px] leading-relaxed text-[var(--cyan)]">
                      distance(a, b) ≤ 75 m AND |t(a) − t(b)| ≤ 6 h
                    </code>
                  </div>
                  <p className="mt-2 text-[10px] leading-[1.7] text-[var(--text-2)]">
                    Candidates are flagged at submission time and surfaced in this console. The rule is
                    deliberately conservative: it over-flags in dense areas, which is preferable to silently
                    double-counting events. A reviewer decides whether two reports describe the same event.
                  </p>
                  <div className="mt-3">
                    <StatRow label="Flagged in corpus" value={String(quality.dups)} tone="var(--amber)" />
                    <StatRow label="Currently pending" value={String(rows.filter((r) => r.status === "pending").length)} />
                    <StatRow label="Median positional accuracy" value={`${stats.totals.medianAccuracyM.toFixed(1)} m`} />
                  </div>
                </div>
              </Panel>
            </div>
          </>
        )}

        {tab === "datasets" && (
          <>
            <div className="grid grid-cols-1 gap-px bg-[var(--rule)] lg:grid-cols-[1.4fr_1fr]">
              <Panel
                title="Dataset sources"
                meta={<span className="micro">{datasets?.length ?? "…"} registered</span>}
                actions={
                  <Btn variant="ghost" icon={<RefreshCw className="h-3 w-3" />} onClick={loadDatasets}>
                    Refresh
                  </Btn>
                }
              >
                <div className="p-3">
                  {!datasets ? (
                    <div className="micro py-6 text-center">Loading registry…</div>
                  ) : (
                    datasets.map((d) => (
                      <div key={d.slug} className="border-b border-[var(--rule)] py-2.5">
                        <div className="flex items-center gap-2">
                          <Database className="h-3 w-3 text-[var(--text-3)]" />
                          <span className="text-[11px] font-semibold text-[var(--text)]">{d.name}</span>
                          <Badge tone={d.isSynthetic ? "warn" : "cyan"}>{d.kind}</Badge>
                          <span className="tnum ml-auto text-[10px] text-[var(--text-3)]">
                            {d.recordCount.toLocaleString()} records
                          </span>
                        </div>
                        <p className="mt-1.5 text-[9.5px] leading-[1.7] text-[var(--text-3)]">{d.description}</p>
                        <div className="tnum mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-[var(--text-3)]">
                          <span>licence {d.licence}</span>
                          {d.randomSeed != null && <span>seed {d.randomSeed}</span>}
                          {d.generatorVersion && <span>generator v{d.generatorVersion}</span>}
                          {d.coverageStart && (
                            <span>
                              coverage {d.coverageStart.slice(0, 10)} → {d.coverageEnd?.slice(0, 10)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Panel>

              <Panel title="Synthetic corpus generator">
                <div className="p-3">
                  <p className="text-[10px] leading-[1.7] text-[var(--text-2)]">
                    The corpus is fully reproducible: the same seed and scenario always produce identical
                    records. Regenerating replaces all synthetic tables. Real datasets registered in the
                    future are held in separate sources and are never overwritten.
                  </p>
                  <div className="mt-3">
                    <Field label="Scenario">
                      <Select
                        value={scenario}
                        onChange={setScenario}
                        options={[
                          { value: "mixed", label: "Mixed urban pattern (default)" },
                          { value: "uniform", label: "Uniform distribution" },
                          { value: "intersection_dominated", label: "Intersection-dominated" },
                          { value: "rush_hour_dominated", label: "Rush-hour dominated" },
                        ]}
                      />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Field label="Random seed" hint="Deterministic — identical seeds give identical corpora.">
                      <TextInput type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <Btn variant="primary" icon={<RefreshCw className="h-3 w-3" />} onClick={reseed} disabled={busy}>
                      {busy ? "Regenerating…" : "Regenerate synthetic corpus"}
                    </Btn>
                  </div>
                </div>
              </Panel>
            </div>
          </>
        )}

        {tab === "audit" && (
          <Panel
            title="Audit trail"
            meta={<span className="micro">append-only</span>}
            actions={
              <Btn variant="ghost" icon={<History className="h-3 w-3" />} onClick={loadAudit}>
                Refresh
              </Btn>
            }
          >
            <div className="p-3">
              {!audit ? (
                <div className="micro py-6 text-centre text-center">Loading audit trail…</div>
              ) : (
                audit.map((e) => (
                  <div key={e.id} className="flex items-baseline gap-3 border-b border-[var(--rule)] py-1.5">
                    <span className="tnum w-[126px] text-[9.5px] text-[var(--text-3)]">
                      {e.createdAt.slice(0, 19).replace("T", " ")}
                    </span>
                    <span className="tnum w-[128px] text-[9.5px] text-[var(--amber)]">{e.action}</span>
                    <span className="w-[104px] text-[9.5px] text-[var(--text-2)]">{e.actorName}</span>
                    <span className="tnum w-[110px] text-[9.5px] text-[var(--text-3)]">
                      {e.entityType}
                      {e.entityId ? `:${e.entityId}` : ""}
                    </span>
                    <span className="flex-1 truncate font-[IBM_Plex_Mono,monospace] text-[9px] text-[var(--text-3)]">
                      {JSON.stringify(e.detail ?? {})}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        )}
      </main>
    </div>
  );
}
