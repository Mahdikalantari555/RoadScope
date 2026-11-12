"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Database, Trash2, Upload, Wand2, Power } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import EChart, { CHART_AXIS, CHART_TOOLTIP } from "@/components/EChart";
import { Alert, Badge, Button, Field, KeyValue, PageHeader, Panel, Spinner, Stat, cx, inputCls, labelCls, Segmented } from "@/components/ui";
import { useApi } from "@/components/hooks";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/client-api";
import { SCENARIO_IDS, SCENARIO_META, STUDY_AREA, type ScenarioId } from "@/lib/domain";
import { formatInt, formatPct } from "@/lib/format";
import type { DatasetGenerationResult, DatasetInfo, ImportResult, QualityReport } from "@/lib/api-types";

interface NetworkSummary {
  segments: number;
  networkKm: number;
  intersections: number;
  trafficObservations: number;
  weatherObservations: number;
  stations: { code: string; name: string; lon: number; lat: number }[];
}

const KIND_LABEL: Record<DatasetInfo["kind"], string> = { synthetic: "Synthetic", citizen: "Citizen simulation", real_import: "Real import" };

export default function DataPage() {
  const { isAdmin, meta } = useApp();
  const datasets = useApi<{ items: DatasetInfo[] }>("/datasets");
  const network = useApi<NetworkSummary>("/network");
  const quality = useApi<QualityReport>(isAdmin ? "/quality" : null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);

  const toggleActive = async (d: DatasetInfo) => {
    try {
      await apiPatch(`/datasets/${d.id}`, { isActive: !d.isActive });
      datasets.reload();
      quality.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  };

  const remove = async (d: DatasetInfo) => {
    if (!window.confirm(`Delete dataset “${d.name}” and all ${formatInt(d.recordCount)} of its records? This cannot be undone.`)) return;
    try {
      await apiDelete(`/datasets/${d.id}`);
      setNotice({ tone: "ok", text: `Deleted “${d.name}”.` });
      datasets.reload();
      quality.reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  };

  const onSynthetic = () => {
    setNotice(null);
    datasets.reload();
    quality.reload();
  };

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <PageHeader
        title="Datasets & data quality"
        description="Synthetic and real datasets are stored as separate sources. Only active datasets feed the analyses. Every generated record is labelled synthetic."
      />
      <Alert tone="warn" title="Synthetic environment">
        {meta?.study.disclaimer ?? "Fictional study area with synthetic data."} Synthetic datasets are reproducible from their scenario and seed.
      </Alert>

      {notice ? <Alert tone={notice.tone === "ok" ? "ok" : notice.tone === "warn" ? "warn" : "error"}>{notice.text}</Alert> : null}

      {network.data ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Road segments" value={formatInt(network.data.segments)} hint={`${network.data.networkKm.toFixed(1)} km network`} />
          <Stat label="Junctions" value={formatInt(network.data.intersections)} hint="Nodes with ≥ 3 approaches" />
          <Stat label="Traffic records" value={formatInt(network.data.trafficObservations)} hint="AADT per segment & year" />
          <Stat label="Weather records" value={formatInt(network.data.weatherObservations)} hint={`${network.data.stations.length} stations · hourly`} />
        </div>
      ) : null}

      <Panel
        title="Dataset sources"
        subtitle={isAdmin ? "Activate or deactivate datasets for analysis; delete synthetic or imported sources" : "Dataset metadata (administrators see review status counts)"}
        actions={<Button size="sm" variant="secondary" onClick={() => datasets.reload()}>Refresh</Button>}
      >
        {datasets.loading && !datasets.data ? <Spinner /> : null}
        {datasets.error ? <Alert tone="error">{datasets.error}</Alert> : null}
        {datasets.data ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead className="text-left text-[10.5px] uppercase tracking-[0.08em] text-muted">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Dataset</th>
                  <th className="py-1.5 pr-3 font-medium">Kind</th>
                  <th className="py-1.5 pr-3 font-medium">Scenario · seed</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Records</th>
                  <th className="py-1.5 pr-3 font-medium">Review (admin)</th>
                  <th className="py-1.5 pr-3 font-medium">Analysis</th>
                  <th className="py-1.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {datasets.data.items.map((d) => (
                  <tr key={d.id} className="border-t border-line align-middle">
                    <td className="max-w-[300px] py-2 pr-3">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="truncate font-mono text-[10.5px] text-faint">{d.code}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={d.kind === "real_import" ? "neutral" : "synthetic"}>{KIND_LABEL[d.kind]}</Badge>
                      {!d.isSynthetic ? <span className="ml-1 text-[10.5px] text-muted">real records</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {d.scenario ? (SCENARIO_META[d.scenario as ScenarioId]?.label ?? d.scenario) : "—"}
                      {d.seed !== null ? <span className="font-mono text-faint"> · {d.seed}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{d.isNetwork ? "—" : formatInt(d.recordCount)}</td>
                    <td className="py-2 pr-3 text-[11px] text-muted">
                      {isAdmin && !d.isNetwork ? (
                        <span className="font-mono">
                          {d.statusCounts.verified}v · {d.statusCounts.reported}p · {d.statusCounts.rejected}r · {d.statusCounts.duplicate}d
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {d.isNetwork ? <Badge tone="accent">Always on</Badge> : <Badge tone={d.isActive ? "ok" : "muted"}>{d.isActive ? "Active" : "Inactive"}</Badge>}
                    </td>
                    <td className="py-2 text-right">
                      {isAdmin && !d.isNetwork ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" icon={<Power size={12} />} onClick={() => void toggleActive(d)}>
                            {d.isActive ? "Deactivate" : "Activate"}
                          </Button>
                          <Button size="sm" variant="danger" icon={<Trash2 size={12} />} onClick={() => void remove(d)}>
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      {isAdmin ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <GenerateForm onDone={(r) => {
            setNotice({ tone: "ok", text: `Generated “${r.dataset.name}” with ${formatInt(r.accidentsInserted)} records (${r.injected.duplicates} duplicates, ${r.injected.inaccurate} displaced).` });
            onSynthetic();
          }} onError={(t) => setNotice({ tone: "error", text: t })} scenarios={meta?.scenarios ?? []} />
          <ImportForm onDone={(r) => {
            setNotice({ tone: r.accepted ? "ok" : "warn", text: `Imported “${r.dataset.name}”: ${formatInt(r.accepted)} accepted, ${formatInt(r.rejected.length)} rejected.` });
            datasets.reload();
            quality.reload();
          }} onError={(t) => setNotice({ tone: "error", text: t })} />
        </div>
      ) : (
        <Alert tone="info" title="Administrator features">
          Synthetic generation, GeoJSON import, activation and deletion require administrator access. Sign in to manage datasets.
        </Alert>
      )}

      {isAdmin ? <QualityPanel report={quality.data} loading={quality.loading} error={quality.error} /> : null}
    </div>
  );
}

function GenerateForm({ onDone, onError, scenarios }: { onDone: (r: DatasetGenerationResult) => void; onError: (t: string) => void; scenarios: { id: ScenarioId; label: string; description: string }[] }) {
  const [scenario, setScenario] = useState<ScenarioId>("mixed");
  const [kind, setKind] = useState<"synthetic" | "citizen">("synthetic");
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(20260110);
  const [count, setCount] = useState(3000);
  const [busy, setBusy] = useState(false);
  const meta = scenarios.find((s) => s.id === scenario);

  return (
    <Panel title="Generate synthetic dataset" subtitle="Reproducible: the same scenario, seed and size always produce identical records">
      <div className="flex flex-col gap-3">
        <Field label="Scenario">
          <select className={inputCls} value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioId)}>
            {(scenarios.length ? scenarios : SCENARIO_IDS.map((id) => ({ id, label: SCENARIO_META[id].label, description: "" }))).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[11.5px] leading-relaxed text-muted">{meta?.description ?? SCENARIO_META[scenario].description}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Seed">
            <input type="number" className={cx(inputCls, "font-mono")} value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
          </Field>
          <Field label="Records" hint="200 – 20 000 (duplicates included)">
            <input type="number" min={200} max={20000} className={cx(inputCls, "font-mono")} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <Segmented
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: "synthetic", label: "Official-style" },
                { value: "citizen", label: "Citizen simulation" },
              ]}
            />
          </Field>
          <Field label="Name (optional)">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-generated" />
          </Field>
        </div>
        <div>
          <Button
            variant="primary"
            icon={<Wand2 size={13} />}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await apiPost<DatasetGenerationResult>("/datasets/synthetic", {
                  scenario,
                  seed,
                  accidentCount: count,
                  kind,
                  name: name.trim() || undefined,
                });
                onDone(r);
              } catch (err) {
                onError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Generate dataset
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ImportForm({ onDone, onError }: { onDone: (r: ImportResult) => void; onError: (t: string) => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<ImportResult["rejected"]>([]);
  return (
    <Panel title="Import real records (GeoJSON)" subtitle="FeatureCollection of Point features with occurred_at, category, severity (1–4 or pdo/minor/serious/fatal), optional vehicles, emergency, description">
      <div className="flex flex-col gap-3">
        <Field label="Dataset name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Municipal police extract 2024 (anonymised)" />
        </Field>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line px-3 py-4 text-[12px] text-muted hover:border-faint hover:text-fg">
          <Upload size={14} />
          <span>{file ? file.name : "Choose a .geojson file"}</span>
          <input type="file" accept=".geojson,.json,application/geo+json,application/json" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="text-[11px] text-faint">Imported records are treated as verified; document the provenance and remove personal data before import.</p>
        <div>
          <Button
            variant="secondary"
            icon={<Database size={13} />}
            busy={busy}
            disabled={!file || name.trim().length < 3}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                const parsed = JSON.parse(await file.text()) as { features?: unknown[] };
                if (!Array.isArray(parsed.features)) throw new Error("The file must be a GeoJSON FeatureCollection");
                const r = await apiPost<ImportResult>("/datasets/import", { name: name.trim(), features: parsed.features });
                setRejected(r.rejected);
                onDone(r);
              } catch (err) {
                onError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Import
          </Button>
        </div>
        {rejected.length ? (
          <div className="max-h-40 overflow-auto rounded border border-line p-2 text-[11px] text-muted">
            {rejected.slice(0, 50).map((r) => (
              <div key={r.index}>
                Feature {r.index}: {r.reason}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function QualityPanel({ report, loading, error }: { report: QualityReport | null; loading: boolean; error: string | null }) {
  const option = useMemo<EChartsOption>(() => {
    const days = report?.activityByDay ?? [];
    return {
      grid: { left: 4, right: 4, top: 8, bottom: 16, containLabel: true },
      tooltip: { trigger: "axis", ...CHART_TOOLTIP },
      xAxis: { type: "category", data: days.map((d) => d.date.slice(5)), ...CHART_AXIS, axisLabel: { color: "#8a96a8", fontSize: 9, interval: 4 } },
      yAxis: { type: "value", ...CHART_AXIS, minInterval: 1 },
      series: [{ type: "bar", data: days.map((d) => d.reports), barMaxWidth: 14, itemStyle: { color: "#fbbf24", borderRadius: [2, 2, 0, 0] } }],
    };
  }, [report]);

  if (loading && !report) return <Spinner label="Computing data-quality indicators" />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!report) return null;
  const f = report.flags;
  return (
    <Panel title="Data quality indicators" subtitle={`Generated ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC · active datasets`}>
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Stat label="Records" value={formatInt(report.totals.all)} hint={`${formatPct(report.totals.syntheticShare, 0)} synthetic`} />
          <Stat label="Verification rate" value={formatPct(report.verificationRate, 0)} tone="accent" hint="verified ÷ decided" />
          <Stat label="Pending" value={formatInt(report.totals.reported)} tone="warn" hint={`${formatInt(report.duplicateCandidates)} duplicate candidates`} />
          <Stat label="Description filled" value={formatPct(report.completeness.description, 0)} />
          <Stat label="Median reporting delay" value={report.reportingDelay.medianMin === null ? "—" : `${report.reportingDelay.medianMin} min`} hint={report.reportingDelay.p90Min === null ? "" : `p90 ${report.reportingDelay.p90Min} min`} />
          <Stat label="Median GPS accuracy" value={report.positionalAccuracy.medianM === null ? "—" : `${report.positionalAccuracy.medianM} m`} hint={`n=${report.positionalAccuracy.sample} citizen fixes`} />
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className={cx(labelCls, "mb-1")}>Flags</div>
            <KeyValue rows={Object.entries(f).map(([k, v]) => [k.replace(/_/g, " "), formatInt(v)] as [string, string])} />
          </div>
          <div>
            <div className={cx(labelCls, "mb-1")}>Citizen report activity · last 30 days</div>
            <EChart option={option} height={150} />
          </div>
          <KeyValue
            rows={[
              ["Timestamps consistent", formatPct(report.completeness.timestamps, 1)],
              ["Vehicles within range", formatPct(report.completeness.vehicles, 1)],
              ["Coordinates valid", formatPct(report.completeness.coordinates, 1)],
            ]}
          />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-faint">
        Flags indicate records requiring review. Off-network means more than 40 m from any road segment; possible duplicates are heuristic (same category, under 120 m, under 2 h) and never change status automatically.
      </p>
    </Panel>
  );
}


