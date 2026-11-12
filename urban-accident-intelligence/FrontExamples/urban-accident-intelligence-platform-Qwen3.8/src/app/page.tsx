"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApp } from "@/components/AppShell";
import { Badge, Kpi, Panel } from "@/components/ui";
import { BarList, RampLegend, ScatterPlot, TimeSeriesChart } from "@/components/charts";
import { MapCanvas } from "@/components/MapCanvas";
import { apiGet, fmt, fmtDuration, type GeoCollection } from "@/lib/clientApi";
import { incidentPointLayer, networkLayer } from "@/lib/ui";
import { colorFor } from "@/lib/util/colors";

interface StatsPayload {
  totals: any;
  series: any[];
  severityMix: any[];
  categoryMix: any[];
  topSegments: any[];
  vgi: any;
  diurnalMatrix: number[][];
}
interface QualityPayload {
  volumes: any;
  rates: any;
  positionalQuality: any;
  temporalQuality: any;
  stewardship: any;
  provenance: any;
}

export default function OverviewPage() {
  const { dataset, datasetId, role, bootstrapMessage } = useApp();
  const [network, setNetwork] = useState<GeoCollection | null>(null);
  const [incidents, setIncidents] = useState<GeoCollection | null>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [quality, setQuality] = useState<QualityPayload | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    (async () => {
      const [net, inc, st, q, jb] = await Promise.all([
        apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/network?nodes=1&lixels=0`, role).catch(() => null),
        apiGet<{ geojson: GeoCollection }>(`/api/datasets/${datasetId}/incidents?limit=6000`, role).catch(() => null),
        apiGet<StatsPayload>(`/api/datasets/${datasetId}/stats?bin=week`, role).catch(() => null),
        apiGet<QualityPayload>(`/api/datasets/${datasetId}/quality`, role).catch(() => null),
        apiGet<{ jobs: any[] }>(`/api/analysis/jobs?datasetId=${datasetId}&limit=8`, role).catch(() => null),
      ]);
      if (!alive) return;
      setNetwork(net?.geojson ?? null);
      setIncidents(inc?.geojson ?? null);
      setStats(st);
      setQuality(q);
      setJobs(jb?.jobs ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [datasetId, role]);

  const severityItems = useMemo(
    () =>
      (stats?.severityMix ?? []).map((s) => ({
        key: s.code,
        label: s.label,
        value: s.count,
        color: s.color,
        sub: `EPDO ${fmt(s.epdo)}`,
      })),
    [stats],
  );

  const ns = dataset?.networkStats;
  const rc = dataset?.recordCounts;

  return (
    <div className="scroll-thin h-full overflow-auto p-3">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em]">Urban Accident Intelligence</h1>
          <p className="max-w-3xl text-[11.5px] leading-snug" style={{ color: "var(--text-dim)" }}>
            Crowdsourced road-accident intelligence over a linear topological network. Every spatial statistic is computed with shortest-path
            network distances on uniform lixels, never with planar geometry over variable-length edges.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dataset?.synthetic && <Badge tone="warn">SYNTHETIC GROUND TRUTH</Badge>}
          {dataset?.groundTruthAvailable && <Badge tone="info">ORACLE λ AVAILABLE</Badge>}
          <Badge>EPSG:{dataset?.srid ?? "—"}</Badge>
          <Badge>LIXEL {dataset?.lixelLengthM ?? "—"} m</Badge>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Network length" value={fmt(ns?.totalLengthKm)} unit="km" hint={`${fmt(ns?.segmentCount)} edges · ${fmt(ns?.nodeCount)} nodes`} />
        <Kpi label="Lixels (LRS units)" value={fmt(ns?.lixelCount)} hint={`β=${ns?.betaGamma?.beta ?? "—"} γ=${ns?.betaGamma?.gamma ?? "—"}`} />
        <Kpi label="Mean node degree" value={fmt(ns?.meanNodeDegree)} hint="topological connectivity" />
        <Kpi label="Oracle realisations" value={fmt(rc?.groundTruthAccidents)} tone="warn" hint="hidden λ(s,t) draws" />
        <Kpi label="Canonical incidents" value={fmt(stats?.totals?.incidents)} hint={`${fmt(stats?.totals?.epdo)} EPDO units`} />
        <Kpi label="VGI reports" value={fmt(quality?.volumes?.reports)} hint={`${quality?.rates?.duplicationRatePct ?? 0}% witness duplicates`} />
        <Kpi label="Verified" value={`${quality?.rates?.verificationRatePct ?? 0}%`} tone="good" hint={`${fmt(quality?.volumes?.verifiedIncidents)} incidents verified`} />
        <Kpi label="Rejected / false alarms" value={`${quality?.rates?.rejectionRatePct ?? 0}%`} tone="bad" hint={`${fmt(quality?.volumes?.falseAlarms ?? rc?.falseAlarms)} flagged`} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel
          title="Cartographic canvas"
          subtitle="Severity-styled canonical incidents over the functional-class road network"
          right={
            <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--text-mute)" }}>
              <span className="mono">{fmt(incidents?.features.length ?? 0)} features</span>
              <Link href="/explorer" className="btn">
                Open geovisual analytics →
              </Link>
            </div>
          }
          className="min-h-[420px]"
          bodyClass="relative"
        >
          <MapCanvas
            layers={[
              networkLayer(network, "class", 0.75),
              incidentPointLayer(incidents, { clusterRadiusPx: 16 }),
            ]}
            origin={dataset ? { lon: dataset.originLon, lat: dataset.originLat } : undefined}
            fitKey={datasetId ?? ""}
            className="h-[420px] w-full"
            legend={
              <div className="flex gap-2">
                <div className="rounded-[3px] border px-2 py-1.5" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 92%, transparent)" }}>
                  <div className="mb-1 text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>Severity (KABO)</div>
                  {(stats?.severityMix ?? []).map((s) => (
                    <div key={s.code} className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-dim)" }}>
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.label}
                      <span className="mono ml-auto pl-3" style={{ color: "var(--text-mute)" }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            }
          />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Dataset provenance" subtitle="Reproducibility contract">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-2.5 text-[11px]">
              <Row k="Identifier" v={<span className="mono">{dataset?.id ?? "—"}</span>} />
              <Row k="Kind" v={dataset?.kind ?? "—"} />
              <Row k="Scenario" v={dataset?.scenarioLabel ?? dataset?.scenario ?? "—"} />
              <Row k="Seed" v={<span className="mono">{dataset?.seed ?? "—"}</span>} />
              <Row k="Canonical CRS" v={`${dataset?.crsName ?? "—"} (EPSG:${dataset?.srid ?? "—"}, metre)`} />
              <Row k="Serialised CRS" v="OGC CRS84 (WGS84 lon/lat)" />
              <Row k="Lixel resolution" v={`${dataset?.lixelLengthM ?? "—"} m (LRS m-values 0…L)`} />
              <Row k="Study window" v={`${fmt((dataset as any)?.recordCounts ? undefined : undefined) || "—"}${stats?.totals?.timeRange ? `${stats.totals.timeRange.from.slice(0, 10)} → ${stats.totals.timeRange.to.slice(0, 10)}` : ""}`} />
              <Row k="Generator" v={`v${dataset?.generatorVersion ?? "—"}`} />
              <Row k="Class share" v={<span className="mono">{Object.entries(ns?.classShare ?? {}).map(([k, v]) => `${k}:${((v as number) * 100).toFixed(0)}%`).join("  ")}</span>} />
            </dl>
            <div className="border-t px-2.5 py-2 text-[10.5px] leading-snug" style={{ borderColor: "var(--border)", color: "var(--text-mute)" }}>
              {quality?.provenance?.separationNote ?? bootstrapMessage}
            </div>
          </Panel>

          <Panel title="Temporal distribution" subtitle="Weekly bins · drag to brush (linked in the Explorer)">
            <div className="p-2.5">
              <TimeSeriesChart series={(stats?.series ?? []).map((s) => ({ label: s.label, count: s.count, epdo: s.epdo }))} valueKey="count" label="Incidents per week" />
            </div>
          </Panel>

          <Panel title="Severity composition" subtitle="Observed frequency vs. EPDO weighting">
            <div className="p-2.5">
              <BarList items={severityItems} onSelect={() => undefined} valueFormat={(v) => fmt(v)} title="Crash count by severity level" />
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="VGI positional quality" subtitle="Injected drift vs. map-matching residual">
          <div className="space-y-2 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Mean injected drift" value={`${fmt(quality?.positionalQuality?.meanInjectedDriftM)} m`} />
              <MiniStat label="Mean snap residual" value={`${fmt(quality?.positionalQuality?.meanSnapResidualM)} m`} tone="good" />
              <MiniStat label="Residual reduction" value={`${fmt(quality?.positionalQuality?.residualReductionPct)} %`} tone="good" />
              <MiniStat label="p95 drift" value={`${fmt(quality?.positionalQuality?.p95InjectedDriftM)} m`} />
              <MiniStat label="Mean snap posterior" value={fmt(quality?.positionalQuality?.meanSnapPosterior, 3)} />
              <MiniStat label="Median reporting lag" value={`${fmt(quality?.temporalQuality?.medianLagSeconds / 60)} min`} />
            </div>
            <ScatterPlot
              points={(quality?.positionalQuality?.driftHistogram ?? []).map((b: any, i: number) => ({ x: i, y: b.count, label: b.bucket }))}
              xLabel="drift bin"
              yLabel="reports"
              ramp="cividis"
              diagonal={false}
              size={92}
            />
          </div>
        </Panel>

        <Panel title="Most hazardous corridors" subtitle="Ranked by EPDO · click to inspect in the Explorer">
          <div className="p-2.5">
            <BarList
              items={(stats?.topSegments ?? []).slice(0, 10).map((s: any) => ({
                key: s.segmentId,
                label: `${s.name ?? "—"} (${s.roadClass})`,
                value: s.epdo,
                sub: `${s.count} crashes · ${fmt(s.densityPerKm)}/km`,
              }))}
              ramp="ylorrd"
              valueFormat={(v) => fmt(v)}
            />
          </div>
        </Panel>

        <Panel title="Geocomputation ledger" subtitle="Asynchronous jobs, provenance and cache">
          <div className="scroll-thin max-h-[240px] overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Status</th>
                  <th className="text-right">Runtime</th>
                  <th className="text-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="mono" style={{ color: "var(--text)" }}>{j.method}</td>
                    <td>
                      <span className="mono" style={{ color: j.status === "succeeded" ? "var(--accent-2)" : j.status === "failed" ? "var(--danger)" : "var(--warn)" }}>
                        {j.status}
                      </span>
                    </td>
                    <td className="mono text-right">{fmtDuration(j.durationMs)}</td>
                    <td className="mono text-right">{new Date(j.createdAt).toISOString().slice(5, 16).replace("T", " ")}</td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-3 text-center" style={{ color: "var(--text-mute)" }}>
                      no analysis runs yet — open the Spatial Analysis Laboratory
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 border-t p-2" style={{ borderColor: "var(--border)" }}>
            <Link href="/laboratory" className="btn btn-primary flex-1 text-center">Run an analysis</Link>
            <Link href="/risk" className="btn flex-1 text-center">Risk & EB</Link>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { href: "/simulation", code: "01", title: "Ground-Truth Simulator", body: "Seeded inhomogeneous network point process, lixel resolution control, VGI noise injection and PAI/RRI/RMSE benchmarking." },
          { href: "/report", code: "02", title: "Citizen Report (VGI)", body: "Uncertainty-aware geolocation, structured attribution, privacy stripping and real-time network conflation alerts." },
          { href: "/stewardship", code: "03", title: "Stewardship & QA", body: "Probabilistic map-matching inspection, duplicate triage, credibility scoring and immutable audit lifecycle." },
          { href: "/laboratory", code: "04", title: "Spatial Analysis Lab", body: "NKDE vs planar KDE, Network Gi*, N-DBSCAN, aggregation, covariate cross-comparison and open-standard export." },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="panel p-2.5 transition-colors hover:border-[var(--accent)]">
            <div className="flex items-center gap-2">
              <span className="mono text-[10px]" style={{ color: colorFor("viridis", 0.7) }}>{c.code}</span>
              <span className="text-[12px] font-semibold">{c.title}</span>
            </div>
            <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--text-mute)" }}>{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--text-mute)" }}>{k}</dt>
      <dd className="text-right" style={{ color: "var(--text-dim)" }}>{v}</dd>
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--border)" }}>
      <div className="text-[9px] uppercase tracking-[0.07em]" style={{ color: "var(--text-mute)" }}>{label}</div>
      <div className="mono text-[13px]" style={{ color: tone === "good" ? "var(--accent-2)" : tone === "bad" ? "var(--danger)" : "var(--text)" }}>{value}</div>
    </div>
  );
}
