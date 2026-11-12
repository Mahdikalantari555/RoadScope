"use client";

/**
 * E. Risk Assessment Workspace — transparent, configurable weighted scoring
 * with explicit separation of frequency, relative risk and probability.
 */

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Eye, EyeOff, Gauge, Info, RotateCcw, ShieldAlert } from "lucide-react";
import { useApp, type MapLayerPayload } from "@/lib/appState";
import { Badge, Btn, DataTable, MicroLabel, Panel, Slider, Stat, Toggle } from "@/components/ui";
import { Legend, MethodPanel, StatRow } from "@/components/LayerInfo";
import {
  buildLayer,
  computeRisk,
  DEFAULT_RISK_FACTORS,
  type RiskFactor,
  type RiskParams,
} from "@/lib/layerBuilder";

const MapPlate = dynamic(() => import("@/components/MapPlate"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-deep)]">
      <div className="micro">Loading console plate…</div>
    </div>
  ),
});

export default function RiskView() {
  const app = useApp();
  const [factors, setFactors] = useState<RiskFactor[]>(DEFAULT_RISK_FACTORS);
  const [includeExposure, setIncludeExposure] = useState(true);
  const [selectedSeg, setSelectedSeg] = useState<number | null>(null);

  const riskParams: RiskParams = { factors, includeExposure, minCoverage: 0 };

  const risk = useMemo(
    () => computeRisk(app.filtered, app.segments, app.trafficMap, riskParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.filtered, app.segments, app.trafficMap, factors, includeExposure],
  );

  const layer: MapLayerPayload = useMemo(
    () => buildLayer("risk", {
      bandwidthM: 320,
      cellSizeM: 160,
      epsM: 260,
      minPts: 8,
      bandM: 400,
      weighting: "severity",
      fdr: true,
    }, app.filtered, app.segments, app.trafficMap, riskParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.filtered, app.segments, app.trafficMap, factors, includeExposure],
  );

  React.useEffect(() => {
    app.setLayer(layer);
    app.setMapMode("risk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);

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

  const ranked = useMemo(
    () => [...risk.segments].filter((s) => (s.accidentCount ?? 0) > 0).sort((a, b) => b.riskIndex - a.riskIndex).slice(0, 40),
    [risk.segments],
  );

  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);

  return (
    <div className="flex h-full min-h-0">
      {/* weights bay */}
      <aside className="flex w-[318px] shrink-0 flex-col overflow-y-auto border-r border-[var(--rule)] bg-[var(--panel)]">
        <div className="relative border-b border-[var(--rule)]">
          <div className="plate-texture absolute inset-0" />
          <div className="relative px-3 py-3">
            <MicroLabel rule={false}>Module E</MicroLabel>
            <h2 className="mt-1.5 text-[19px] leading-[1.1] font-bold tracking-[-0.01em] text-[var(--text)]">
              Risk Assessment Workspace
            </h2>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-[var(--text-3)]">
              A transparent weighted composite over interpretable factors. Every weight is visible,
              adjustable and reproducible.
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-3">
          <div className="flex items-center gap-2 border-l-2 border-[var(--fatal)] bg-[color-mix(in_srgb,var(--fatal)_8%,transparent)] px-2 py-2">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[var(--fatal)]" />
            <p className="text-[9.5px] leading-[1.65] text-[var(--text-2)]">
              The output is a <b className="text-[var(--fatal)]">relative index</b>, not a calibrated
              accident probability. It orders segments within this dataset and says nothing about the
              absolute chance of a collision.
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Factor weights</MicroLabel>
          <div className="mt-1">
            {factors.map((f, i) => (
              <div key={f.key}>
                <Slider
                  label={f.label}
                  value={f.weight}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => {
                    const next = [...factors];
                    next[i] = { ...f, weight: v };
                    setFactors(next);
                  }}
                  format={(v) => `${((v / (totalWeight || 1)) * 100).toFixed(0)}%`}
                />
                <p className="-mt-1 mb-1.5 text-[9px] leading-[1.55] text-[var(--text-3)]">{f.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-t border-[var(--rule)] pt-2">
            <span className="micro">Raw weight sum</span>
            <span className="tnum text-[11px] text-[var(--amber)]">{totalWeight.toFixed(2)}</span>
          </div>
          <div className="mt-2">
            <Toggle
              label="Include traffic exposure factor"
              checked={includeExposure}
              onChange={setIncludeExposure}
            />
          </div>
          <div className="mt-2">
            <Btn icon={<RotateCcw className="h-3 w-3" />} onClick={() => setFactors(DEFAULT_RISK_FACTORS)}>
              Reset weights
            </Btn>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <MicroLabel>Data coverage &amp; uncertainty</MicroLabel>
          <div className="mt-2">
            <StatRow label="Segments with ≥ 1 report" value={`${(risk.coverage.segmentCoverageRatio * 100).toFixed(1)}%`} />
            <StatRow label="Traffic coverage" value={`${(risk.coverage.trafficCoverageRatio * 100).toFixed(1)}%`} />
            <StatRow label="Median positional accuracy" value={`${risk.coverage.positionalAccuracyMedian.toFixed(1)} m`} />
            <StatRow label="Verified share" value={`${(risk.coverage.verifiedRatio * 100).toFixed(1)}%`} />
            <StatRow label="Temporal span" value={`${risk.coverage.temporalSpanDays.toFixed(0)} days`} />
            <StatRow
              label="Mean model uncertainty"
              value={risk.statistics.meanUncertainty.toFixed(2)}
              tone="var(--warn)"
            />
          </div>
          <div className="mt-3 space-y-1.5">
            {risk.coverage.caveats.map((c) => (
              <div key={c} className="flex items-start gap-1.5">
                <Info className="mt-[2px] h-2.5 w-2.5 shrink-0 text-[var(--text-3)]" />
                <p className="text-[9px] leading-[1.6] text-[var(--text-3)]">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* map + ranking */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapPlate roads={roadCollection as never} />
          <div className="pointer-events-none absolute top-2 left-2">
            <Legend layer={layer} />
          </div>
        </div>

        <div className="grid h-[300px] shrink-0 grid-cols-1 gap-px border-t border-[var(--rule)] bg-[var(--rule)] lg:grid-cols-[1.35fr_1fr]">
          <Panel
            title="Ranked road segments"
            meta={<span className="micro">top 40 by composite index</span>}
            actions={<Gauge className="h-3.5 w-3.5 text-[var(--text-3)]" />}
          >
            <DataTable
              maxHeight={258}
              activeKey={selectedSeg}
              columns={[
                { key: "rank", label: "Rank", width: "48px" },
                { key: "code", label: "Segment", width: "86px" },
                { key: "name", label: "Street" },
                { key: "count", label: "Events", align: "right", width: "58px" },
                { key: "sw", label: "Sev idx", align: "right", width: "60px" },
                { key: "risk", label: "Risk index", align: "right", width: "72px" },
                { key: "unc", label: "Uncertainty", align: "right", width: "78px" },
              ]}
              rows={ranked.map((s) => ({
                __key: s.id,
                rank: <span className="text-[var(--text-3)]">{String(s.riskRank).padStart(3, "0")}</span>,
                code: <span className="text-[var(--amber)]">{s.segmentCode}</span>,
                name: <span className="text-[var(--text)]">{s.streetName}</span>,
                count: s.accidentCount,
                sw: s.severityWeightedIndex,
                risk: (
                  <span style={{ color: s.riskIndex > 0.5 ? "var(--amber)" : "var(--text-2)" }}>
                    {s.riskIndex.toFixed(3)}
                  </span>
                ),
                unc: (
                  <span style={{ color: s.uncertainty > 0.55 ? "var(--warn)" : "var(--text-3)" }}>
                    ±{s.uncertainty.toFixed(2)}
                  </span>
                ),
              }))}
              onRowClick={(row) => {
                setSelectedSeg(row.__key as number);
                app.setSelection({ kind: "segment", id: row.__key as number });
              }}
            />
          </Panel>

          <Panel title="Factor decomposition" meta={<span className="micro">selected segment</span>}>
            <div className="p-3">
              {selectedSeg == null ? (
                <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 text-center">
                  <Eye className="h-4 w-4 text-[var(--text-3)]" />
                  <p className="text-[10px] leading-[1.7] text-[var(--text-3)]">
                    Select a segment in the ranking to inspect how each factor contributes to its index.
                  </p>
                </div>
              ) : (
                <FactorBreakdown
                  segment={risk.segments.find((s) => s.id === selectedSeg)!}
                  factors={factors}
                  totalWeight={totalWeight}
                />
              )}
            </div>
          </Panel>
        </div>

        <div className="flex items-start gap-2 border-t border-[var(--rule)] bg-[var(--panel-2)] px-5 py-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--warn)]" />
          <p className="text-[9.5px] leading-[1.7] text-[var(--text-3)]">
            Interpretation guide — <b className="text-[var(--text-2)]">accident frequency</b> is a count of
            reported events; <b className="text-[var(--text-2)]">relative risk</b> is this dataset-relative
            index; <b className="text-[var(--text-2)]">probability of occurrence</b> requires an exposure
            denominator and an independently validated statistical model, neither of which is present in
            this build. Architecturally the scoring engine is an interface, so calibrated models or graph
            neural networks can be registered later without changing the storage or rendering layers.
          </p>
        </div>
      </div>
    </div>
  );
}

function FactorBreakdown({
  segment,
  factors,
  totalWeight,
}: {
  segment: {
    segmentCode: string;
    streetName: string;
    riskIndex: number;
    factors: Record<string, number>;
    uncertainty: number;
    exposureCoverage: number;
  };
  factors: RiskFactor[];
  totalWeight: number;
}) {
  return (
    <div>
      <div className="tnum text-[10px] text-[var(--amber)]">{segment.segmentCode}</div>
      <div className="text-[13px] font-semibold text-[var(--text)]">{segment.streetName}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <div>
          <div className="micro">Composite index</div>
          <div className="tnum text-[25px] leading-none text-[var(--amber)]">{segment.riskIndex.toFixed(3)}</div>
        </div>
        <div>
          <div className="micro">Uncertainty</div>
          <div className="tnum text-[25px] leading-none text-[var(--warn)]">±{segment.uncertainty.toFixed(2)}</div>
        </div>
      </div>
      <div className="mt-3">
        {factors.map((f) => {
          const v = segment.factors[f.key] ?? 0;
          const contribution = (v * f.weight) / (totalWeight || 1);
          return (
            <div key={f.key} className="border-b border-[var(--rule)] py-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-[var(--text-2)]">{f.label}</span>
                <span className="tnum text-[9.5px] text-[var(--text-3)]">
                  x̂ {v.toFixed(2)} · w {f.weight.toFixed(2)} →{" "}
                  <span className="text-[var(--cyan)]">{contribution.toFixed(3)}</span>
                </span>
              </div>
              <div className="mt-1 h-[5px] bg-[var(--panel-2)]">
                <div className="h-full bg-[var(--cyan)]" style={{ width: `${contribution * 100}%`, opacity: 0.85 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Badge tone="neutral">exposure coverage {(segment.exposureCoverage * 100).toFixed(0)}%</Badge>
      </div>
    </div>
  );
}
