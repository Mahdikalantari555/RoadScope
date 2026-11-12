import React, { useState } from 'react';
import { Calendar, FilterX, Flame, Layers3, Navigation } from 'lucide-react';
import type { CmvFilterState, CmvStatePayload } from '../types/uai';

interface AnalyticsWorkspaceProps {
  darkMode: boolean;
  cmvData: CmvStatePayload | null;
  filters: CmvFilterState;
  onUpdateFilters: (next: Partial<CmvFilterState>) => void;
  onResetAllFilters: () => void;
  onFlyToSegment: (segmentId: number) => void;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const AnalyticsWorkspace: React.FC<AnalyticsWorkspaceProps> = ({
  darkMode,
  cmvData,
  filters,
  onUpdateFilters,
  onResetAllFilters,
  onFlyToSegment,
}) => {
  const [brushStartIdx, setBrushStartIdx] = useState<number | null>(null);

  if (!cmvData) {
    return (
      <div className="p-6 text-xs font-mono text-slate-400">
        Synchronizing Coordinated Multiple Views (CMV)...
      </div>
    );
  }

  const { kpis, weekly_series, diurnal_matrix, severity_breakdown, taxonomy_breakdown, top_segments } =
    cmvData;

  const hasAnyFilter =
    Boolean(filters.start_utc) ||
    Boolean(filters.end_utc) ||
    filters.severity_codes.length > 0 ||
    filters.category_codes.length > 0 ||
    filters.dow_filter !== null ||
    filters.hour_filter !== null ||
    filters.segment_id !== null ||
    filters.bbox_4326 !== null ||
    filters.polygon_4326 !== null;

  const maxWeekTotal = Math.max(1, ...weekly_series.map((w) => w.total_count));
  let maxDiurnal = 1;
  diurnal_matrix.forEach((row) => row.forEach((val) => { if (val > maxDiurnal) maxDiurnal = val; }));
  const maxTaxCount = Math.max(1, ...taxonomy_breakdown.map((t) => t.count));

  const toggleSeverity = (code: string) => {
    const exists = filters.severity_codes.includes(code);
    const next = exists
      ? filters.severity_codes.filter((c) => c !== code)
      : [...filters.severity_codes, code];
    onUpdateFilters({ severity_codes: next });
  };

  const toggleCategory = (code: string) => {
    const exists = filters.category_codes.includes(code);
    const next = exists
      ? filters.category_codes.filter((c) => c !== code)
      : [...filters.category_codes, code];
    onUpdateFilters({ category_codes: next });
  };

  const handleWeekClick = (idx: number) => {
    if (brushStartIdx === null) {
      setBrushStartIdx(idx);
    } else {
      const i0 = Math.min(brushStartIdx, idx);
      const i1 = Math.max(brushStartIdx, idx);
      const sUtc = `${weekly_series[i0].week_start}T00:00:00Z`;
      const eDate = new Date(`${weekly_series[i1].week_start}T00:00:00Z`);
      eDate.setUTCDate(eDate.getUTCDate() + 7);
      onUpdateFilters({ start_utc: sUtc, end_utc: eDate.toISOString().slice(0, 19) + 'Z' });
      setBrushStartIdx(null);
    }
  };

  const cardCls = `rounded-md border p-3 ${
    darkMode ? 'bg-slate-900/75 border-slate-800' : 'bg-white border-slate-200 shadow-sm'
  }`;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      {/* Header + Observation Layer Filter + Clear All */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5">
            <Layers3 className="w-4 h-4 text-cyan-400" />
            Coordinated Geovisual Analytics (CMV)
          </h2>
          <p className="text-[11px] opacity-70">
            Bidirectional linked brushing across map polygons, timeline, diurnal matrix &amp; corridors
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={filters.verification_mode}
            onChange={(e) =>
              onUpdateFilters({
                verification_mode: e.target.value as CmvFilterState['verification_mode'],
              })
            }
            className={`px-2 py-1 rounded border text-[11px] font-mono ${
              darkMode ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300'
            }`}
          >
            <option value="verified_only">Confirmed Canonical Only</option>
            <option value="all_active">Confirmed + Unverified VGI</option>
            <option value="vgi_queue">Unverified VGI Triage Only</option>
          </select>
          {hasAnyFilter && (
            <button
              onClick={onResetAllFilters}
              className="px-2 py-1 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30 flex items-center gap-1 text-[11px] font-mono"
            >
              <FilterX className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">Active Incidents</div>
          <div className="text-lg font-bold text-cyan-400">{kpis.filtered_incidents}</div>
          <div className="text-[10px] opacity-70">Credibility μ={kpis.mean_credibility}</div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">EPDO Severity Sum</div>
          <div className="text-lg font-bold text-amber-400">{kpis.total_epdo}</div>
          <div className="text-[10px] opacity-70">HSM Weighted Index</div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">KSI (Severe/Fatal)</div>
          <div className="text-lg font-bold text-rose-400">
            {kpis.ksi_severe_fatal_count}{' '}
            <span className="text-xs font-normal">({kpis.ksi_share_pct}%)</span>
          </div>
          <div className="text-[10px] opacity-70">Mean Snap d⊥={kpis.mean_snap_drift_m}m</div>
        </div>
      </div>

      {/* 1. Interactive Weekly Temporal Brush */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            Temporal Trajectory &amp; Interactive Window Brush
          </span>
          <span className="text-[10px] font-mono opacity-75">
            {brushStartIdx !== null
              ? 'Click end week to apply window...'
              : filters.start_utc
              ? `${filters.start_utc.slice(0, 10)} → ${filters.end_utc?.slice(0, 10)}`
              : 'Click any two weeks to brush'}
          </span>
        </div>
        <div className="h-24 flex items-end gap-[2px] pt-2">
          {weekly_series.map((w, idx) => {
            const totalPct = (w.total_count / maxWeekTotal) * 100;
            const selPct = (w.selected_count / maxWeekTotal) * 100;
            const isAnchor = brushStartIdx === idx;
            return (
              <div
                key={w.week_start}
                onClick={() => handleWeekClick(idx)}
                title={`Week of ${w.week_start}: ${w.selected_count} selected / ${w.total_count} baseline`}
                className={`flex-1 h-full flex flex-col justify-end cursor-pointer group relative ${
                  isAnchor ? 'ring-1 ring-amber-400' : ''
                }`}
              >
                <div
                  className="w-full bg-slate-700/35 rounded-t-sm relative overflow-hidden"
                  style={{ height: `${Math.max(6, totalPct)}%` }}
                >
                  <div
                    className="absolute bottom-0 inset-x-0 bg-cyan-400 group-hover:bg-cyan-300 transition-all"
                    style={{ height: `${w.total_count > 0 ? (selPct / Math.max(1, totalPct)) * 100 : 0}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] font-mono opacity-60 mt-1">
          <span>{weekly_series[0]?.week_start}</span>
          <span>52-Week Study Horizon (UTC)</span>
          <span>{weekly_series[weekly_series.length - 1]?.week_start}</span>
        </div>
      </div>

      {/* 2. 7x24 Diurnal x Weekly Spatiotemporal Matrix Heatmap */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            7×24 Diurnal × Weekly Spatiotemporal Matrix
          </span>
          {(filters.dow_filter !== null || filters.hour_filter !== null) && (
            <button
              onClick={() => onUpdateFilters({ dow_filter: null, hour_filter: null })}
              className="text-[10px] font-mono text-cyan-400 hover:underline"
            >
              Clear Cell ({DOW_LABELS[filters.dow_filter ?? 0]} {filters.hour_filter}:00)
            </button>
          )}
        </div>
        <div className="space-y-0.5 font-mono">
          {diurnal_matrix.map((row, dowIdx) => (
            <div key={dowIdx} className="flex items-center gap-1">
              <span className="w-7 text-[10px] opacity-70">{DOW_LABELS[dowIdx]}</span>
              <div className="flex-1 grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {row.map((cnt, hrIdx) => {
                  const intensity = cnt / maxDiurnal;
                  const isSel = filters.dow_filter === dowIdx && filters.hour_filter === hrIdx;
                  const bg =
                    cnt === 0
                      ? darkMode
                        ? 'rgba(30,41,59,0.45)'
                        : 'rgba(226,232,240,0.8)'
                      : `rgba(249, 115, 22, ${0.2 + 0.8 * intensity})`;
                  return (
                    <button
                      key={hrIdx}
                      onClick={() =>
                        onUpdateFilters(
                          isSel
                            ? { dow_filter: null, hour_filter: null }
                            : { dow_filter: dowIdx, hour_filter: hrIdx }
                        )
                      }
                      title={`${DOW_LABELS[dowIdx]} ${String(hrIdx).padStart(2, '0')}:00 UTC — ${cnt} crashes`}
                      style={{ backgroundColor: bg }}
                      className={`h-3.5 rounded-[2px] transition-transform hover:scale-125 ${
                        isSel ? 'ring-2 ring-cyan-300 z-10' : ''
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex justify-between pl-8 text-[9px] opacity-60 pt-0.5">
            <span>00h</span>
            <span>06h</span>
            <span>08h Rush</span>
            <span>12h</span>
            <span>17h Rush</span>
            <span>23h</span>
          </div>
        </div>
      </div>

      {/* 3. Interactive Severity & Taxonomy Cross-Filters */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
        <div className={cardCls}>
          <div className="font-semibold mb-2">Severity Breakdown (Click Filter)</div>
          <div className="space-y-1.5">
            {severity_breakdown.map((sv) => {
              const active =
                filters.severity_codes.length === 0 || filters.severity_codes.includes(sv.code);
              return (
                <button
                  key={sv.code}
                  onClick={() => toggleSeverity(sv.code)}
                  className={`w-full text-left px-2 py-1 rounded border transition-opacity flex items-center justify-between ${
                    active ? 'opacity-100 border-slate-700/80' : 'opacity-40 border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sv.color }} />
                    <span className="truncate">{sv.label}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] shrink-0">
                    <b>{sv.count}</b> <span className="opacity-60">(EPDO {sv.epdo_sum})</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={cardCls}>
          <div className="font-semibold mb-2">Collision Taxonomy (Click Filter)</div>
          <div className="space-y-1.5">
            {taxonomy_breakdown.map((cat) => {
              const active =
                filters.category_codes.length === 0 || filters.category_codes.includes(cat.code);
              const pct = (cat.count / maxTaxCount) * 100;
              return (
                <button
                  key={cat.code}
                  onClick={() => toggleCategory(cat.code)}
                  className={`w-full text-left space-y-0.5 transition-opacity ${
                    active ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <div className="flex justify-between text-[11px]">
                    <span className="truncate pr-2">{cat.label}</span>
                    <span className="font-mono tabular-nums font-semibold">{cat.count}</span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                    <div className="h-full bg-cyan-400" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Top Hazardous Road Segments Table */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">Top Hazardous Corridors (Active Selection)</span>
          <span className="text-[10px] font-mono opacity-65">Click corridor to zoom &amp; cross-filter</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono tabular-nums text-[11px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] uppercase opacity-70">
                <th className="py-1 pr-2">Corridor</th>
                <th className="py-1 px-1 text-right">N</th>
                <th className="py-1 px-1 text-right">N/km</th>
                <th className="py-1 pl-1 text-right">EPDO</th>
              </tr>
            </thead>
            <tbody>
              {top_segments.slice(0, 8).map((seg) => {
                const isSelected = filters.segment_id === seg.segment_id;
                return (
                  <tr
                    key={seg.segment_id}
                    onClick={() => {
                      onUpdateFilters({
                        segment_id: isSelected ? null : seg.segment_id,
                      });
                      if (!isSelected) onFlyToSegment(seg.segment_id);
                    }}
                    className={`border-b border-slate-800/50 cursor-pointer hover:bg-cyan-500/10 ${
                      isSelected ? 'bg-cyan-500/20 text-cyan-300' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-2 font-sans truncate max-w-[180px]">
                      <Navigation className="w-2.5 h-2.5 inline mr-1 text-cyan-400" />
                      {seg.name}
                    </td>
                    <td className="py-1.5 px-1 text-right font-semibold">{seg.count}</td>
                    <td className="py-1.5 px-1 text-right">{seg.density_per_km}</td>
                    <td className="py-1.5 pl-1 text-right text-amber-400">{seg.epdo_sum}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
