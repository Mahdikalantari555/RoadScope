"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Map as MLMap } from "maplibre-gl";
import { Check, Copy, RefreshCcw, X } from "lucide-react";
import { AccidentDetail, StatusBadge, type AccidentDetailData } from "@/components/AccidentDetail";
import { EChart, axisStyle, baseOption, chartTheme, type ChartOption } from "@/components/charts/EChart";
import { MapView, removeLayers, upsertSource } from "@/components/map/MapView";
import { useApp } from "@/components/providers";
import { Badge, Button, Empty, Field, KV, Notice, Panel, Segmented, Spinner, Stat, cx } from "@/components/ui";
import { SCENARIOS } from "@/lib/domain";
import { api, fmt } from "@/lib/client/api";

type Tab = "review" | "quality" | "datasets" | "audit";
interface ListItem {
  id: number;
  trackingCode: string;
  occurredAt: string;
  reportedAt: string;
  status: string;
  category: string;
  severity: string;
  flags: string[];
  datasetId: number;
  isSynthetic: boolean;
  duplicateScore: number | null;
  description: string;
}
interface ListResp {
  page: number;
  pages: number;
  total: number;
  items: ListItem[];
}

export default function AdminPage() {
  const { meta } = useApp();
  const [tab, setTab] = useState<Tab>("review");
  if (!meta) return <div className="p-6"><Spinner label="Loading…" /></div>;
  if (meta.user?.role !== "admin")
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-[15px] font-semibold">Administrator access required</h1>
          <p className="text-[12px] text-muted">Review, verification, data-quality and dataset management are restricted to the administrator role.</p>
          <Link href="/login?next=/admin"><Button variant="primary">Sign in</Button></Link>
        </div>
      </div>
    );
  return (
    <div className="h-full flex flex-col">
      <div className="h-10 shrink-0 border-b border-line bg-panel flex items-center px-3 gap-3">
        <h1 className="text-[13px] font-semibold">Administration</h1>
        <Segmented<Tab>
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: "review", label: "Review & records" },
            { value: "quality", label: "Data quality" },
            { value: "datasets", label: "Datasets" },
            { value: "audit", label: "Audit log" },
          ]}
        />
      </div>
      <div className="flex-1 min-h-0">
        {tab === "review" && <Review />}
        {tab === "quality" && <Quality />}
        {tab === "datasets" && <Datasets />}
        {tab === "audit" && <Audit />}
      </div>
    </div>
  );
}

function Review() {
  const { meta } = useApp();
  const [status, setStatus] = useState("reported");
  const [flag, setFlag] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<ListResp | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<AccidentDetailData | null>(null);
  const [note, setNote] = useState("");
  const [dupId, setDupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<{ category: string; severity: string; vehicles: number; description: string } | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: "40", sort: status === "reported" ? "oldest" : "newest" });
    if (status !== "all") p.set("statuses", status);
    if (flag) p.set("flag", flag);
    if (q) p.set("q", q);
    const ds = meta?.datasets.map((d) => d.id).join(",");
    if (ds) p.set("datasets", ds);
    setList(await api<ListResp>(`/api/accidents?${p}`));
  }, [page, status, flag, q, meta?.datasets]);
  useEffect(() => {
    void load();
  }, [load, reload]);

  useEffect(() => {
    if (!map || !detail) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "LineString", coordinates: [[detail.reportedLon, detail.reportedLat], [detail.lon, detail.lat]] }, properties: { k: "snap" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [detail.reportedLon, detail.reportedLat] }, properties: { k: "reported" } },
        { type: "Feature", geometry: { type: "Point", coordinates: [detail.lon, detail.lat] }, properties: { k: "validated" } },
      ],
    };
    const draw = () => {
      removeLayers(map, ["adm-line", "adm-pt"]);
      upsertSource(map, "adm", fc);
      map.addLayer({ id: "adm-line", type: "line", source: "adm", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#f5a524", "line-width": 1.5, "line-dasharray": [2, 1] } });
      map.addLayer({ id: "adm-pt", type: "circle", source: "adm", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": ["match", ["get", "k"], "reported", "rgba(0,0,0,0)", "#4fd1c5"], "circle-stroke-color": ["match", ["get", "k"], "reported", "#f5a524", "#04201d"], "circle-stroke-width": 2 } });
      map.jumpTo({ center: [detail.lon, detail.lat], zoom: 16.5 });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("idle", draw);
  }, [map, detail]);

  const act = async (action: "verify" | "reject" | "mark_duplicate" | "reopen") => {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/accidents/${sel}/review`, { method: "POST", json: { action, note, duplicateOfId: action === "mark_duplicate" ? (dupId ? Number(dupId) : detail?.duplicateOf?.id) : undefined } });
      setMsg({ tone: "info", text: `${detail?.trackingCode}: ${action.replace("_", " ")} ✓` });
      setNote("");
      setDupId("");
      const idx = list?.items.findIndex((i) => i.id === sel) ?? -1;
      const next = list?.items[idx + 1]?.id ?? null;
      setReload((r) => r + 1);
      setSel(status === "reported" ? next : sel);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!sel || !edit) return;
    setBusy(true);
    try {
      await api(`/api/accidents/${sel}`, { method: "PATCH", json: { ...edit, note: note || "Corrected by reviewer" } });
      setEdit(null);
      setMsg({ tone: "info", text: "Record updated (original coordinates preserved)." });
      setReload((r) => r + 1);
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row">
      <div className="md:w-[380px] shrink-0 border-r border-line bg-panel flex flex-col min-h-0 max-h-[45%] md:max-h-none">
        <div className="p-2 space-y-1.5 border-b border-line">
          <div className="flex gap-1 flex-wrap">
            {["reported", "verified", "rejected", "duplicate", "all"].map((s) => (
              <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={cx("h-6 px-2 rounded-[3px] border text-[11px]", status === s ? "border-accent bg-accent-soft" : "border-line text-muted")}>
                {s === "reported" ? "queue (unverified)" : s}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <select className="field" value={flag} onChange={(e) => { setFlag(e.target.value); setPage(1); }}>
              <option value="">any quality flag</option>
              {["possible_duplicate", "off_network", "low_positional_confidence", "late_report"].map((f) => <option key={f} value={f}>{f.replace(/_/g, " ")}</option>)}
            </select>
            <input className="field num" placeholder="tracking code" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list?.items.map((i) => (
            <button key={i.id} onClick={() => { setSel(i.id); setEdit(null); setMsg(null); }} className={cx("w-full text-left px-2.5 py-1.5 border-b border-line/60 hover:bg-panel2", sel === i.id && "bg-accent-soft")}>
              <div className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: meta?.severities.find((s) => s.code === i.severity)?.color }} />
                <span className="num text-[12px]">{i.trackingCode}</span>
                <StatusBadge status={i.status} />
                {i.isSynthetic && <span className="text-[10px] text-faint">syn</span>}
                <span className="ml-auto text-[10.5px] text-faint num">{fmt.date(i.reportedAt)}</span>
              </div>
              <div className="text-[11px] text-muted truncate">{i.category.replace("_", " ")} · {i.description}</div>
              {i.flags.length > 0 && (
                <div className="flex gap-1 mt-0.5 flex-wrap">
                  {i.flags.map((f) => <Badge key={f} color="#f5a524">{f.replace(/_/g, " ")}</Badge>)}
                </div>
              )}
            </button>
          ))}
          {list && !list.items.length && <Empty title="Queue is empty">No records match the current filter.</Empty>}
        </div>
        {list && (
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-line text-[11px] text-muted">
            <span className="num">{fmt.int(list.total)} records</span>
            <div className="flex gap-1 items-center">
              <Button size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹</Button>
              <span className="num">{list.page}/{Math.max(1, list.pages)}</span>
              <Button size="xs" disabled={page >= list.pages} onClick={() => setPage((p) => p + 1)}>›</Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col lg:flex-row min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {sel ? (
            <div className="space-y-3 max-w-xl">
              {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              <AccidentDetail id={sel} reloadKey={reload} onData={setDetail} />
              <Panel title="Review decision">
                <div className="space-y-2">
                  <Field label="Reviewer note (stored in audit trail)">
                    <textarea className="field min-h-[50px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Evidence, sources consulted, reason…" />
                  </Field>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button variant="ok" loading={busy} onClick={() => act("verify")}><Check className="size-3.5" /> Verify</Button>
                    <Button variant="danger" loading={busy} onClick={() => act("reject")}><X className="size-3.5" /> Reject</Button>
                    <div className="flex gap-1">
                      <input className="field num w-24" placeholder={detail?.duplicateOf ? `#${detail.duplicateOf.id}` : "orig. id"} value={dupId} onChange={(e) => setDupId(e.target.value.replace(/\D/g, ""))} />
                      <Button loading={busy} disabled={!dupId && !detail?.duplicateOf} onClick={() => act("mark_duplicate")}><Copy className="size-3.5" /> Mark duplicate</Button>
                    </div>
                    {detail && detail.status !== "reported" && <Button variant="ghost" onClick={() => act("reopen")}><RefreshCcw className="size-3.5" /> Reopen</Button>}
                  </div>
                </div>
              </Panel>
              <Panel title="Correct record" actions={!edit && detail ? <Button size="xs" onClick={() => setEdit({ category: detail.category, severity: detail.severity, vehicles: detail.vehicles, description: detail.description })}>Edit</Button> : null}>
                {edit ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Category">
                        <select className="field" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                          {meta?.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Severity">
                        <select className="field" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>
                          {meta?.severities.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Vehicles"><input type="number" className="field num" min={0} max={60} value={edit.vehicles} onChange={(e) => setEdit({ ...edit, vehicles: Number(e.target.value) })} /></Field>
                    <Field label="Description"><textarea className="field" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
                    <div className="flex gap-1.5">
                      <Button variant="primary" loading={busy} onClick={saveEdit}>Save</Button>
                      <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-faint">Edits are versioned in the review history and audit log; submitted coordinates are never overwritten.</p>
                )}
              </Panel>
            </div>
          ) : (
            <Empty title="Select a record">Pick a report from the queue to inspect positional quality, duplicate candidates and photos, then verify, reject or merge it.</Empty>
          )}
        </div>
        <div className="lg:w-[360px] h-[260px] lg:h-auto shrink-0 border-l border-line relative">
          <MapView onReady={setMap} basemap="synthetic" className="absolute inset-0">
            <div className="absolute top-2 left-2 z-10 bg-panel/90 border border-line rounded-[3px] px-1.5 py-0.5 text-[10.5px] text-muted">hollow amber = reported · teal = validated</div>
          </MapView>
        </div>
      </div>
    </div>
  );
}

interface QualityResp {
  total: number;
  completeness: Record<string, number>;
  positional: { median: number; p90: number; p99: number; offNetwork: number; histogram: { bin: string; count: number }[] };
  reportingDelay: { medianMin: number; p90Min: number; histogram: { bin: string; count: number }[] };
  flags: Record<string, number>;
  perDataset: { id: number; code: string; kind: string; total: number; byStatus: Record<string, number> }[];
  pending: number;
  possibleDuplicates: number;
  duplicateDetector: { options: { radius: number; windowMin: number; threshold: number }; evaluated: number; actualDuplicates: number; evaluation: { threshold: number; tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }[] };
  grossErrorDetection: { injected: number; flagged: number; recall: number | null };
  activity: { reviews: { day: string; n: number }[]; submissions: { day: string; n: number }[] };
}

function Quality() {
  const { theme } = useApp();
  const t = chartTheme(theme);
  const [d, setD] = useState<QualityResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<QualityResp>("/api/admin/quality").then(setD).catch((e) => setErr(e.message));
  }, []);
  const bar = useCallback((h: { bin: string; count: number }[], color: string): ChartOption => ({ ...baseOption(theme), tooltip: { ...baseOption(theme).tooltip, trigger: "axis" }, xAxis: { type: "category", data: h.map((x) => x.bin), ...axisStyle(theme) }, yAxis: { type: "value", ...axisStyle(theme) }, series: [{ type: "bar", data: h.map((x) => x.count), itemStyle: { color } }] }), [theme]);
  const pr = useMemo<ChartOption | null>(() => {
    if (!d) return null;
    const ev = d.duplicateDetector.evaluation;
    return {
      ...baseOption(theme),
      legend: { textStyle: { color: t.text, fontSize: 10 }, top: 0 },
      grid: { left: 36, right: 12, top: 26, bottom: 26 },
      tooltip: { ...baseOption(theme).tooltip, trigger: "axis" },
      xAxis: { type: "category", data: ev.map((e) => e.threshold.toFixed(2)), ...axisStyle(theme), name: "threshold", nameLocation: "middle", nameGap: 18, nameTextStyle: { color: t.faint, fontSize: 10 } },
      yAxis: { type: "value", min: 0, max: 1, ...axisStyle(theme) },
      series: [
        { name: "precision", type: "line", data: ev.map((e) => +e.precision.toFixed(3)), lineStyle: { color: t.accent }, itemStyle: { color: t.accent } },
        { name: "recall", type: "line", data: ev.map((e) => +e.recall.toFixed(3)), lineStyle: { color: "#f5a524" }, itemStyle: { color: "#f5a524" } },
        { name: "F1", type: "line", data: ev.map((e) => +e.f1.toFixed(3)), lineStyle: { color: "#a78bfa", type: "dashed" }, itemStyle: { color: "#a78bfa" } },
      ],
    };
  }, [d, theme, t.accent, t.text, t.faint]);
  if (err) return <div className="p-4"><Notice tone="danger">{err}</Notice></div>;
  if (!d) return <div className="p-4"><Spinner label="Computing data-quality indicators…" /></div>;
  const op = d.duplicateDetector.evaluation.find((e) => e.threshold === d.duplicateDetector.options.threshold);
  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-line border border-line rounded-[4px] overflow-hidden">
        {[
          <Stat key="a" label="Records" value={fmt.int(d.total)} />,
          <Stat key="b" label="Review queue" value={fmt.int(d.pending)} tone="warn" />,
          <Stat key="c" label="Possible duplicates" value={fmt.int(d.possibleDuplicates)} sub="pending" />,
          <Stat key="d" label="Median snap" value={`${fmt.dec(d.positional.median, 1)} m`} sub={`p90 ${fmt.dec(d.positional.p90, 1)} m`} />,
          <Stat key="e" label="Off-network" value={fmt.int(d.positional.offNetwork)} tone="danger" />,
          <Stat key="f" label="Median delay" value={`${fmt.dec(d.reportingDelay.medianMin / 60, 1)} h`} sub={`p90 ${fmt.dec(d.reportingDelay.p90Min / 60, 1)} h`} />,
        ].map((x, i) => <div key={i} className="bg-panel p-2.5">{x}</div>)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Panel title="Duplicate detector vs synthetic ground truth" subtitle={`${d.duplicateDetector.evaluated} synthetic reports · ${d.duplicateDetector.actualDuplicates} injected duplicates · radius ${d.duplicateDetector.options.radius} m, window ±${d.duplicateDetector.options.windowMin} min`} className="xl:col-span-2">
          {pr && <EChart option={pr} height={200} />}
          {op && <p className="text-[11.5px] text-muted mt-1">Operating threshold {op.threshold}: precision <b className="num">{fmt.pct(op.precision)}</b>, recall <b className="num">{fmt.pct(op.recall)}</b>, F1 <b className="num">{fmt.dec(op.f1, 3)}</b> (TP {op.tp}, FP {op.fp}, FN {op.fn}). Evaluated against generator labels — a reproducible benchmark for crowdsourced QA.</p>}
        </Panel>
        <Panel title="Completeness & detection">
          {Object.entries(d.completeness).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[11.5px] py-0.5">
              <span className="w-28 text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
              <div className="flex-1 h-[6px] bg-panel2 rounded-sm overflow-hidden"><div className="h-full bg-accent" style={{ width: `${v * 100}%` }} /></div>
              <span className="num w-12 text-right">{fmt.pct(v, 0)}</span>
            </div>
          ))}
          <div className="mt-2">
            <KV k="Injected gross position errors" v={d.grossErrorDetection.injected} />
            <KV k="…flagged by snapping rules" v={`${d.grossErrorDetection.flagged} (${fmt.pct(d.grossErrorDetection.recall)})`} />
          </div>
          <div className="label mt-2 mb-1">Quality flags</div>
          {Object.entries(d.flags).map(([k, v]) => <KV key={k} k={k.replace(/_/g, " ")} v={v} />)}
        </Panel>
        <Panel title="Positional accuracy" subtitle="distance between reported and network-snapped location">
          <EChart option={bar(d.positional.histogram, t.accent)} height={170} />
        </Panel>
        <Panel title="Reporting delay" subtitle="reported_at − occurred_at">
          <EChart option={bar(d.reportingDelay.histogram, "#a78bfa")} height={170} />
        </Panel>
        <Panel title="Datasets by status">
          <table className="w-full text-[11.5px]">
            <thead className="text-faint"><tr><th className="text-left font-medium">dataset</th>{["verified", "reported", "rejected", "duplicate"].map((s) => <th key={s} className="text-right font-medium">{s}</th>)}</tr></thead>
            <tbody>
              {d.perDataset.map((p) => (
                <tr key={p.id} className="border-t border-line/60">
                  <td className="py-1">{p.code} <Badge color={p.kind === "synthetic" ? "#f5a524" : "#4fd1c5"}>{p.kind}</Badge></td>
                  {["verified", "reported", "rejected", "duplicate"].map((s) => <td key={s} className="text-right num">{p.byStatus[s] ?? 0}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="label mt-3 mb-1">Reporting activity (citizen dataset, last 30 days)</div>
          {d.activity.submissions.length ? d.activity.submissions.map((s) => <KV key={s.day} k={s.day} v={s.n} />) : <p className="text-[11px] text-faint">No citizen submissions yet.</p>}
          <div className="label mt-2 mb-1">Reviews (last 30 days)</div>
          {d.activity.reviews.length ? d.activity.reviews.map((s) => <KV key={s.day} k={s.day} v={s.n} />) : <p className="text-[11px] text-faint">No reviews yet.</p>}
        </Panel>
      </div>
    </div>
  );
}

interface DatasetItem {
  id: number;
  code: string;
  name: string;
  kind: string;
  description: string;
  scenario: string | null;
  seed: number | null;
  crs: string;
  license: string;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  records: number;
}

function Datasets() {
  const { reloadMeta } = useApp();
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [form, setForm] = useState({ scenario: "mixed", seed: 42, accidents: 2600, duplicateRate: 0.05, gpsSigmaM: 12, pendingShare: 0.12 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const load = useCallback(() => api<{ items: DatasetItem[] }>("/api/datasets").then((r) => setItems(r.items)), []);
  useEffect(() => {
    void load();
  }, [load]);
  const regen = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ code: string; accidents: number; segments: number }>("/api/datasets", { method: "POST", json: form });
      setMsg({ tone: "info", text: `Generated ${r.code}: ${r.accidents} reports on ${r.segments} road segments. Reload other views to see the new data.` });
      await load();
      await reloadMeta();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (d: DatasetItem) => {
    try {
      await api(`/api/datasets/${d.id}`, { method: "PATCH", json: { isActive: !d.isActive } });
      await load();
      await reloadMeta();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  };
  return (
    <div className="h-full overflow-y-auto p-3 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-3 items-start">
      <div className="space-y-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {items.map((d) => (
          <Panel key={d.id} title={d.name} subtitle={`${d.code} · ${d.crs} · ${d.license}`} actions={<><Badge color={d.kind === "synthetic" ? "#f5a524" : "#4fd1c5"}>{d.kind}</Badge><Button size="xs" onClick={() => toggle(d)}>{d.isActive ? "Deactivate" : "Activate"}</Button></>}>
            <p className="text-[12px] text-muted">{d.description}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
              <KV k="Records" v={fmt.int(d.records)} />
              <KV k="Active" v={d.isActive ? "yes" : "no"} />
              <KV k="Scenario" v={d.scenario ?? "—"} />
              <KV k="Seed" v={d.seed ?? "—"} />
            </div>
            {d.kind === "synthetic" && d.config.injectedEffects ? (
              <details className="mt-2">
                <summary className="text-[11.5px] text-muted cursor-pointer">Generator configuration & injected effects (ground truth)</summary>
                <pre className="text-[10.5px] num text-muted bg-panel2 border border-line rounded-[3px] p-2 mt-1 overflow-x-auto">{JSON.stringify(d.config, null, 2)}</pre>
              </details>
            ) : null}
          </Panel>
        ))}
      </div>
      <Panel title="Regenerate synthetic dataset" subtitle="Replaces network, observations and synthetic reports; citizen reports are kept and re-snapped.">
        <div className="space-y-2.5">
          <Field label="Scenario">
            <div className="space-y-1">
              {SCENARIOS.map((s) => (
                <label key={s.code} className={cx("block border rounded-[3px] p-2 cursor-pointer", form.scenario === s.code ? "border-accent bg-accent-soft" : "border-line")}>
                  <div className="flex items-center gap-2 text-[12px]"><input type="radio" checked={form.scenario === s.code} onChange={() => setForm({ ...form, scenario: s.code })} />{s.label}</div>
                  <div className="text-[11px] text-muted mt-0.5">{s.description}</div>
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Random seed"><input type="number" className="field num" value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) })} /></Field>
            <Field label="Reports"><input type="number" className="field num" min={200} max={8000} value={form.accidents} onChange={(e) => setForm({ ...form, accidents: Number(e.target.value) })} /></Field>
            <Field label="Duplicate rate"><input type="number" step={0.01} className="field num" min={0} max={0.3} value={form.duplicateRate} onChange={(e) => setForm({ ...form, duplicateRate: Number(e.target.value) })} /></Field>
            <Field label="GPS σ (m)"><input type="number" className="field num" min={0} max={100} value={form.gpsSigmaM} onChange={(e) => setForm({ ...form, gpsSigmaM: Number(e.target.value) })} /></Field>
            <Field label="Pending share"><input type="number" step={0.01} className="field num" min={0} max={0.8} value={form.pendingShare} onChange={(e) => setForm({ ...form, pendingShare: Number(e.target.value) })} /></Field>
          </div>
          <Button variant="primary" size="md" className="w-full" loading={busy} onClick={regen}>Generate (≈10–30 s)</Button>
          <p className="text-[11px] text-faint">Identical scenario + seed reproduces the identical dataset (mulberry32 PRNG).</p>
        </div>
      </Panel>
    </div>
  );
}

function Audit() {
  const [items, setItems] = useState<{ id: number; action: string; entityType: string; entityId: string | null; details: Record<string, unknown>; createdAt: string; actor: string | null }[]>([]);
  useEffect(() => {
    api<{ items: typeof items }>("/api/admin/audit").then((r) => setItems(r.items)).catch(() => undefined);
  }, []);
  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full text-[11.5px]">
        <thead className="text-faint sticky top-0 bg-bg"><tr>{["Time", "Actor", "Action", "Entity", "Details"].map((h) => <th key={h} className="text-left font-medium py-1 px-2">{h}</th>)}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-line/60">
              <td className="px-2 py-1 num whitespace-nowrap">{fmt.dt(i.createdAt)}</td>
              <td className="px-2">{i.actor ?? "anonymous / system"}</td>
              <td className="px-2"><Badge color="#4fd1c5">{i.action}</Badge></td>
              <td className="px-2 num">{i.entityType}#{i.entityId}</td>
              <td className="px-2 num text-muted truncate max-w-[420px]">{JSON.stringify(i.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
