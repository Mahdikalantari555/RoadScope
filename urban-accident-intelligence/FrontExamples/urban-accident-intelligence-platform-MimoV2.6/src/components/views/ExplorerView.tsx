"use client";

/**
 * A. Interactive Geospatial Explorer — the console plate with analytical layers.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Crosshair,
  Layers,
  LocateFixed,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useApp, type MapMode, type MapLayerPayload, type Basemap } from "@/lib/appState";
import {
  Btn,
  Chip,
  Field,
  MicroLabel,
  Panel,
  SegmentedControl,
  Slider,
  Stat,
  TextInput,
  Toggle,
} from "@/components/ui";
import { Legend, MethodPanel, DownloadButton, StatRow } from "@/components/LayerInfo";
import {
  buildLayer,
  DEFAULT_LAYER_PARAMS,
  DEFAULT_RISK_FACTORS,
  type LayerParams,
} from "@/lib/layerBuilder";
import { CATEGORIES, SEVERITIES, REPORT_STATUSES, STUDY_BOUNDS } from "@/lib/constants";
import type { Accident, CategoryCode, ReportStatus, SeverityCode } from "@/lib/types";

const MapPlate = dynamic(() => import("@/components/MapPlate"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--bg-deep)]">
      <div className="micro">Loading console plate…</div>
    </div>
  ),
});

const MODES: { value: MapMode; label: string; hint: string }[] = [
  { value: "points", label: "Individual reports", hint: "points" },
  { value: "clusters", label: "Clustered distribution", hint: "aggregation" },
  { value: "kde", label: "Kernel density (KDE)", hint: "intensity" },
  { value: "hotspot", label: "Getis-Ord Gi* hotspots", hint: "inference" },
  { value: "segments", label: "Road-segment aggregation", hint: "network" },
  { value: "risk", label: "Spatial risk surface", hint: "index" },
];

export default function ExplorerView() {
  const app = useApp();
  const [params, setParams] = useState<LayerParams>(DEFAULT_LAYER_PARAMS);
  const [coords, setCoords] = useState({ lon: 13.412, lat: 52.5145, zoom: 12.4 });

  // The road network is rendered from the console shell; here we only need it
  // for the layer builder. It is passed through context.
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

  const layer = useMemo<MapLayerPayload>(
    () =>
      buildLayer(app.mapMode, params, app.filtered, app.segments, app.trafficMap, {
        factors: DEFAULT_RISK_FACTORS,
        includeExposure: true,
        minCoverage: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.mapMode, params, app.filtered, app.segments, app.trafficMap],
  );

  useEffect(() => {
    app.setLayer(layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer]);

  const selected = useMemo<Accident | null>(() => {
    if (!app.selection || app.selection.kind !== "accident") return null;
    return app.filtered.find((a) => a.id === app.selection!.id) ?? null;
  }, [app.selection, app.filtered]);

  const selectedSegment = useMemo(() => {
    if (!app.selection || app.selection.kind !== "segment") return null;
    return app.segments.find((s) => s.id === app.selection!.id) ?? null;
  }, [app.selection, app.segments]);

  return (
    <div className="flex h-full min-h-0">
      {/* ---- control bay ------------------------------------------------ */}
      <aside className="flex w-[318px] shrink-0 flex-col overflow-y-auto border-r border-[var(--rule)] bg-[var(--panel)]">
        <div className="relative">
          <div className="plate-texture absolute inset-0" />
          <div className="relative border-b border-[var(--rule)] px-3 py-3">
            <MicroLabel>Module A</MicroLabel>
            <h2 className="mt-1.5 text-[19px] font-bold leading-[1.1] tracking-[-0.01em] text-[var(--text)]">
              Geospatial Explorer
            </h2>
            <p className="mt-1.5 text-[10.5px] leading-[1.6] text-[var(--text-3)]">
              Six analytical renderings of the same report corpus. Every layer states what it measures
              and what it does not.
            </p>
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Analytical layer</MicroLabel>
          <div className="mt-2">
            <SegmentedControl
              value={app.mapMode}
              onChange={(v) => app.setMapMode(v)}
              options={MODES}
              compact
            />
          </div>
        </div>

        {/* parameters */}
        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Layer parameters</MicroLabel>
          {(app.mapMode === "kde" || app.mapMode === "hotspot") && (
            <div className="mt-1">
              {app.mapMode === "kde" && (
                <Slider
                  label="Bandwidth h"
                  value={params.bandwidthM}
                  min={80}
                  max={900}
                  step={20}
                  onChange={(v) => setParams({ ...params, bandwidthM: v })}
                  format={(v) => `${v} m`}
                />
              )}
              {app.mapMode === "hotspot" && (
                <Slider
                  label="Distance band"
                  value={params.bandM}
                  min={150}
                  max={1200}
                  step={50}
                  onChange={(v) => setParams({ ...params, bandM: v })}
                  format={(v) => `${v} m`}
                />
              )}
              <Slider
                label="Cell size"
                value={params.cellSizeM}
                min={60}
                max={400}
                step={20}
                onChange={(v) => setParams({ ...params, cellSizeM: v })}
                format={(v) => `${v} m`}
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip
                  active={params.weighting === "uniform"}
                  onClick={() => setParams({ ...params, weighting: "uniform" })}
                >
                  Unweighted
                </Chip>
                <Chip
                  active={params.weighting === "severity"}
                  onClick={() => setParams({ ...params, weighting: "severity" })}
                >
                  Severity-weighted
                </Chip>
              </div>
              {app.mapMode === "hotspot" && (
                <div className="mt-1">
                  <Toggle
                    label="FDR multiple-testing correction"
                    checked={params.fdr}
                    onChange={(v) => setParams({ ...params, fdr: v })}
                  />
                </div>
              )}
            </div>
          )}
          {app.mapMode === "clusters" && (
            <p className="mt-2 text-[10px] leading-[1.6] text-[var(--text-3)]">
              Clustering is applied on a fixed metric lattice. Click a cluster to zoom until
              individual reports resolve.
            </p>
          )}
          {(app.mapMode === "points" || app.mapMode === "segments" || app.mapMode === "risk") && (
            <p className="mt-2 text-[10px] leading-[1.6] text-[var(--text-3)]">
              {app.mapMode === "points"
                ? "No aggregation. Verification status is encoded as opacity."
                : app.mapMode === "segments"
                  ? "Reports are snapped to the nearest segment within 120 m."
                  : "Weighted composite index — see the Risk workspace to configure the weights."}
            </p>
          )}
        </div>

        {/* filters */}
        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Temporal window</MicroLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="From">
              <TextInput
                type="date"
                value={app.filters.from}
                onChange={(e) => app.setFilters({ from: e.target.value })}
              />
            </Field>
            <Field label="To">
              <TextInput
                type="date"
                value={app.filters.to}
                onChange={(e) => app.setFilters({ to: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-1">
            <Slider
              label="Hour of day — start"
              value={app.filters.hours[0]}
              min={0}
              max={23}
              onChange={(v) => app.setFilters({ hours: [Math.min(v, app.filters.hours[1]), app.filters.hours[1]] })}
              format={(v) => `${String(v).padStart(2, "0")}:00`}
            />
            <Slider
              label="Hour of day — end"
              value={app.filters.hours[1]}
              min={0}
              max={23}
              onChange={(v) => app.setFilters({ hours: [app.filters.hours[0], Math.max(v, app.filters.hours[0])] })}
              format={(v) => `${String(v).padStart(2, "0")}:00`}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <Chip
                key={i}
                active={app.filters.days.includes(i)}
                onClick={() =>
                  app.setFilters({
                    days: app.filters.days.includes(i)
                      ? app.filters.days.filter((x) => x !== i)
                      : [...app.filters.days, i].sort(),
                  })
                }
              >
                {d}
              </Chip>
            ))}
          </div>
        </div>

        <div className="border-b border-[var(--rule)] px-3 py-2.5">
          <MicroLabel>Severity</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1">
            {SEVERITIES.map((s) => (
              <Chip
                key={s.code}
                colour={s.colour}
                active={app.filters.severities.includes(s.code)}
                onClick={() =>
                  app.setFilters({
                    severities: app.filters.severities.includes(s.code)
                      ? app.filters.severities.filter((x) => x !== s.code)
                      : [...app.filters.severities, s.code as SeverityCode],
                  })
                }
              >
                {s.label}
              </Chip>
            ))}
          </div>
          <MicroLabel className="mt-3">Category</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <Chip
                key={c.code}
                active={app.filters.categories.includes(c.code)}
                onClick={() =>
                  app.setFilters({
                    categories: app.filters.categories.includes(c.code)
                      ? app.filters.categories.filter((x) => x !== c.code)
                      : [...app.filters.categories, c.code as CategoryCode],
                  })
                }
              >
                {c.label}
              </Chip>
            ))}
          </div>
          <MicroLabel className="mt-3">Verification status</MicroLabel>
          <div className="mt-2 flex flex-wrap gap-1">
            {REPORT_STATUSES.map((s) => (
              <Chip
                key={s.code}
                colour={s.colour}
                active={app.filters.statuses.includes(s.code)}
                onClick={() =>
                  app.setFilters({
                    statuses: app.filters.statuses.includes(s.code)
                      ? app.filters.statuses.filter((x) => x !== s.code)
                      : [...app.filters.statuses, s.code as ReportStatus],
                  })
                }
              >
                {s.label}
              </Chip>
            ))}
          </div>
          <div className="mt-3">
            <Field label="Free-text search">
              <div className="relative">
                <Search className="absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-[var(--text-3)]" />
                <TextInput
                  value={app.filters.text}
                  onChange={(e) => app.setFilters({ text: e.target.value })}
                  placeholder="id, street, description…"
                  className="!pl-6"
                />
              </div>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Btn icon={<RotateCcw className="h-3 w-3" />} onClick={app.resetFilters}>
              Reset
            </Btn>
            <Btn
              icon={<SlidersHorizontal className="h-3 w-3" />}
              onClick={() => app.setFilters({ statuses: ["verified", "pending", "rejected", "duplicate"] })}
            >
              All statuses
            </Btn>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <MicroLabel>Basemap</MicroLabel>
          <div className="mt-2">
            <SegmentedControl
              value={app.basemap}
              onChange={(v) => app.setBasemap(v as Basemap)}
              options={[
                { value: "plate", label: "Console plate", hint: "dark" },
                { value: "light", label: "Paper plate", hint: "light" },
                { value: "blueprint", label: "Blueprint", hint: "mono" },
              ]}
              compact
            />
          </div>
        </div>
      </aside>

      {/* ---- map plate --------------------------------------------------- */}
      <main className="relative min-w-0 flex-1">
        <MapPlate
          roads={roadCollection as never}
          onCursor={(c) => {
            setCoords(c);
            app.setCursor(c);
          }}
        />

        <div className="pointer-events-none absolute top-2 left-2 z-10">
          <Legend layer={layer} />
        </div>

        <div className="absolute right-2 bottom-2 z-10 flex flex-col items-end gap-1">
          <div className="pointer-events-auto flex items-center gap-1">
            <Btn
              icon={<LocateFixed className="h-3 w-3" />}
              onClick={() =>
                app.setHighlight({ lon: STUDY_BOUNDS.minLon + 0.04, lat: STUDY_BOUNDS.minLat + 0.022, label: "Study centre" })
              }
            >
              Study extent
            </Btn>
            <DownloadButton layer={layer} filename={`uai-${app.mapMode}-layer.geojson`} />
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-2 left-2 z-10 border border-[var(--rule)] bg-[var(--panel)]/85 px-2 py-1">
          <div className="tnum text-[9.5px] text-[var(--text-2)]">
            {coords.lon.toFixed(5)}° E &nbsp; {coords.lat.toFixed(5)}° N
          </div>
        </div>

        {layer.loading && (
          <div className="sweep absolute inset-x-0 top-0 z-20 h-[2px] overflow-hidden bg-[var(--rule)]" />
        )}
      </main>

      {/* ---- inspection drawer ------------------------------------------ */}
      {(selected || selectedSegment) && (
        <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--rule)] bg-[var(--panel)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--rule)] bg-[var(--panel)] px-3 py-2">
            <MicroLabel rule={false}>{selected ? "Feature inspection" : "Road segment"}</MicroLabel>
            <button
              onClick={() => app.setSelection(null)}
              className="text-[var(--text-3)] transition-colors hover:text-[var(--amber)]"
              aria-label="Close inspection"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {selected && <AccidentInspection accident={selected} />}
          {selectedSegment && (
            <div className="p-3">
              <div className="text-[15px] font-semibold text-[var(--text)]">{selectedSegment.streetName}</div>
              <div className="tnum mt-0.5 text-[10px] text-[var(--amber)]">{selectedSegment.segmentCode}</div>
              <div className="mt-3">
                <StatRow label="Road class" value={selectedSegment.roadClass} />
                <StatRow label="Length" value={`${selectedSegment.lengthM.toFixed(0)} m`} />
                <StatRow label="Speed limit" value={`${selectedSegment.speedLimitKph} km/h`} />
                <StatRow label="Lanes" value={String(selectedSegment.lanes)} />
                <StatRow label="Lighting" value={selectedSegment.lighting} />
                <StatRow label="Surface" value={selectedSegment.surface} />
                <StatRow label="Junction control" value={selectedSegment.hasJunctionControl ? "yes" : "no"} />
                <StatRow label="Cycle lane" value={selectedSegment.hasCycleLane ? "yes" : "no"} />
                <StatRow
                  label="Snapped reports"
                  value={String(app.filtered.filter((a) => a.roadSegmentId === selectedSegment.id).length)}
                  tone="var(--amber)"
                />
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

export function AccidentInspection({ accident: a }: { accident: Accident }) {
  return (
    <div className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="tnum text-[10px] text-[var(--amber)]">{a.publicId}</div>
          <div className="mt-1 text-[15px] font-semibold leading-tight text-[var(--text)]">
            {a.categoryLabel}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-2)]">{a.streetName ?? "Unassigned segment"}</div>
        </div>
        <div
          className="mt-1 h-8 w-[3px]"
          style={{ background: SEVERITIES.find((s) => s.code === a.severityCode)?.colour }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        <span
          className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
          style={{
            borderColor: a.status === "verified" ? "var(--cyan)" : "var(--warn)",
            color: a.status === "verified" ? "var(--cyan)" : "var(--warn)",
          }}
        >
          {a.status}
        </span>
        {a.isSynthetic && (
          <span className="border border-[var(--rule-strong)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--text-3)]">
            synthetic
          </span>
        )}
        {a.emergencyServices && (
          <span className="border border-[var(--fatal)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--fatal)]">
            emergency
          </span>
        )}
      </div>

      <div className="mt-3">
        <StatRow label="Severity" value={a.severityLabel} />
        <StatRow label="Category group" value={a.categoryGroup} />
        <StatRow label="Occurred (UTC)" value={new Date(a.occurredAt).toISOString().slice(0, 16).replace("T", " ")} />
        <StatRow label="Reported (UTC)" value={new Date(a.reportedAt).toISOString().slice(0, 16).replace("T", " ")} />
        <StatRow label="Reporting delay" value={`${a.reportDelayH.toFixed(1)} h`} />
        <StatRow label="Vehicles involved" value={String(a.vehicles)} />
        <StatRow label="Casualties" value={String(a.casualties)} />
        <StatRow label="Weather" value={a.weather} />
        <StatRow label="Lighting" value={a.lighting} />
        <StatRow label="Road surface" value={a.roadSurface} />
        <StatRow label="Attachments" value={String(a.attachmentCount)} />
      </div>

      <div className="mt-3 border border-[var(--rule)] bg-[var(--panel-2)] p-2">
        <MicroLabel>Positional provenance</MicroLabel>
        <div className="tnum mt-1.5 text-[9.5px] leading-relaxed text-[var(--text-3)]">
          validated&nbsp;&nbsp;{a.lon.toFixed(6)}, {a.lat.toFixed(6)}
          <br />
          reported&nbsp;&nbsp;{a.reportedLon.toFixed(6)}, {a.reportedLat.toFixed(6)}
          <br />
          accuracy&nbsp;&nbsp;±{a.positionalAccuracyM.toFixed(1)} m ({a.geocodePrecision})
        </div>
      </div>

      {a.description && (
        <div className="mt-3">
          <MicroLabel>Reported narrative</MicroLabel>
          <p className="mt-1.5 text-[11px] leading-[1.7] text-[var(--text-2)]">{a.description}</p>
        </div>
      )}

      {a.rejectReason && (
        <div className="mt-3 border-l-2 border-[var(--fatal)] px-2 py-1.5">
          <MicroLabel rule={false}>Rejection reason</MicroLabel>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-2)]">{a.rejectReason}</p>
        </div>
      )}

      <div className="mt-3 border-t border-[var(--rule)] pt-2">
        <p className="text-[9px] leading-[1.6] text-[var(--text-3)]">
          Unverified citizen reports are not treated as confirmed accidents. Verification decisions and
          reviewer confidence are recorded in the audit trail.
        </p>
      </div>
    </div>
  );
}
