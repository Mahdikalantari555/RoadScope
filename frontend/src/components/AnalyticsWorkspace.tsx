import React, { useEffect, useState } from 'react';
import { Calendar, FilterX, Flame, Layers3, Navigation } from 'lucide-react';
import type { CmvFilterState, CmvStatePayload, NetworkLayersPayload } from '../types/uai';
import { SegmentDetails } from './SegmentDetails';
import { useLanguage } from '../i18n';
import { analyticsText, dayLabels, domainLabel, formatNumber } from '../analyticsI18n';
import { ActiveFilters } from './ActiveFilters';

interface AnalyticsWorkspaceProps {
  darkMode: boolean;
  cmvData: CmvStatePayload | null;
  loading?: boolean;
  networkLayers?: NetworkLayersPayload | null;
  filters: CmvFilterState;
  onUpdateFilters: (next: Partial<CmvFilterState>) => void;
  onResetAllFilters: () => void;
  onFlyToSegment: (segmentId: number) => void;
}

export const AnalyticsWorkspace: React.FC<AnalyticsWorkspaceProps> = ({
  darkMode,
  cmvData,
  loading = true,
  networkLayers = null,
  filters,
  onUpdateFilters,
  onResetAllFilters,
  onFlyToSegment,
}) => {
  const { language } = useLanguage();
  const copy = analyticsText(language);
  const days = dayLabels(language);
  const n = (value: number) => formatNumber(language, value);
  const [brushStartWeek, setBrushStartWeek] = useState<string | null>(null);
  const filterKey = JSON.stringify(filters);

  // A half-finished selection belongs to the current query, not the next dataset or filter.
  useEffect(() => { setBrushStartWeek(null); }, [cmvData, filterKey]);
  const resetFilters = () => {
    setBrushStartWeek(null);
    onResetAllFilters();
  };

  if (!cmvData) {
    return <div className="h-full overflow-y-auto p-3 space-y-3 text-xs">
      <ActiveFilters filters={filters} onUpdate={onUpdateFilters} onReset={resetFilters} />
      <SegmentDetails segmentId={filters.segment_id} network={networkLayers} onClose={() => onUpdateFilters({ segment_id: null })} />
      {loading && <div role="status" className="p-3 font-mono text-slate-400">{copy.loading}</div>}
    </div>;
  }

  const { kpis, weekly_series, diurnal_matrix, severity_breakdown, taxonomy_breakdown, top_segments } = cmvData;

  const hasAnyFilter =
    filters.verification_mode !== 'verified_only' ||
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
  diurnal_matrix.forEach((row) =>
    row.forEach((val) => {
      if (val > maxDiurnal) maxDiurnal = val;
    })
  );
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
    const startIdx = weekly_series.findIndex(week => week.week_start === brushStartWeek);
    if (startIdx < 0) {
      setBrushStartWeek(weekly_series[idx].week_start);
    } else {
      const i0 = Math.min(startIdx, idx);
      const i1 = Math.max(startIdx, idx);
      const sUtc = `${weekly_series[i0].week_start}T00:00:00Z`;
      const eDate = new Date(`${weekly_series[i1].week_start}T00:00:00Z`);
      eDate.setUTCDate(eDate.getUTCDate() + 7);
      onUpdateFilters({ start_utc: sUtc, end_utc: eDate.toISOString().slice(0, 19) + 'Z' });
      setBrushStartWeek(null);
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
            {copy.title}
          </h2>
          <p className="text-[11px] opacity-70">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            aria-label={copy.verification}
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
            <option value="verified_only">{copy.verified}</option>
            <option value="all_active">{copy.all}</option>
            <option value="vgi_queue">{copy.queue}</option>
          </select>
          {hasAnyFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-2 py-1 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30 flex items-center gap-1 text-[11px] font-mono"
            >
              <FilterX className="w-3 h-3" /> {copy.reset}
            </button>
          )}
        </div>
      </div>

      <ActiveFilters filters={filters} onUpdate={onUpdateFilters} onReset={resetFilters} />
      <SegmentDetails segmentId={filters.segment_id} network={networkLayers} onClose={() => onUpdateFilters({ segment_id: null })} />

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">{copy.incidents}</div>
          <div className="text-lg font-bold text-cyan-400">{n(kpis.filtered_incidents)}</div>
          <div className="text-[10px] opacity-70">
            {copy.credibility}: <bdi>{n(kpis.mean_credibility)}</bdi>
          </div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">{copy.severitySum}</div>
          <div className="text-lg font-bold text-amber-400">{n(kpis.total_epdo)}</div>
          <div className="text-[10px] opacity-70">{copy.weightedIndex}</div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase opacity-65">{copy.ksi}</div>
          <div className="text-lg font-bold text-rose-400">
            {n(kpis.ksi_severe_fatal_count)}{' '}
            <span className="text-xs font-normal">
              (<bdi>{n(kpis.ksi_share_pct)}%</bdi>)
            </span>
          </div>
          <div className="text-[10px] opacity-70">
            {copy.drift}: <bdi>{n(kpis.mean_snap_drift_m)}</bdi> {copy.meters}
          </div>
        </div>
      </div>

      {/* 1. Interactive Weekly Temporal Brush */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            {copy.timeline}
          </span>
          <span className="text-[10px] font-mono opacity-75">
            {brushStartWeek !== null ? (
              copy.chooseEnd
            ) : filters.start_utc ? (
              <bdi dir="ltr">
                {filters.start_utc.slice(0, 10)} → {filters.end_utc?.slice(0, 10)}
              </bdi>
            ) : (
              copy.chooseWeeks
            )}
          </span>
        </div>
        {brushStartWeek !== null && (
          <button type="button" onClick={() => setBrushStartWeek(null)} className="underline text-xs mb-1">
            {copy.cancelWeekSelection}
          </button>
        )}
        <div dir="ltr" className="h-24 flex items-end gap-[2px] pt-2">
          {weekly_series.map((w, idx) => {
            const totalPct = (w.total_count / maxWeekTotal) * 100;
            const selPct = (w.selected_count / maxWeekTotal) * 100;
            const isAnchor = brushStartWeek === w.week_start;
            return (
              <button
                type="button"
                key={w.week_start}
                onClick={() => handleWeekClick(idx)}
                aria-pressed={isAnchor}
                aria-label={`${copy.weekOf} ${w.week_start}: ${n(w.selected_count)} ${copy.selected} / ${n(w.total_count)} ${copy.baseline}`}
                title={`${copy.weekOf} ${w.week_start}: ${n(w.selected_count)} ${copy.selected} / ${n(w.total_count)} ${copy.baseline}`}
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
              </button>
            );
          })}
        </div>
        {weekly_series.length === 0 && <p className="text-[11px] opacity-70">{copy.emptyWeeks}</p>}
        <div dir="ltr" className="flex justify-between text-[10px] font-mono opacity-60 mt-1">
          <span>
            <bdi dir="ltr">{weekly_series[0]?.week_start}</bdi>
          </span>
          <span>{copy.studyHorizon}</span>
          <span>
            <bdi dir="ltr">{weekly_series[weekly_series.length - 1]?.week_start}</bdi>
          </span>
        </div>
      </div>

      {/* 2. 7x24 Diurnal x Weekly Spatiotemporal Matrix Heatmap */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-semibold flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            {copy.matrix}
          </span>
          {(filters.dow_filter !== null || filters.hour_filter !== null) && (
            <button
              type="button"
              onClick={() => onUpdateFilters({ dow_filter: null, hour_filter: null })}
              className="text-[10px] font-mono text-cyan-400 hover:underline"
            >
              {copy.clearCell} (<bdi>{days[filters.dow_filter ?? 0]} {filters.hour_filter}:00 UTC</bdi>)
            </button>
          )}
        </div>
        <div className="space-y-0.5 font-mono">
          {diurnal_matrix.map((row, dowIdx) => (
            <div key={dowIdx} className="flex items-center gap-1">
              <span className="w-16 text-[10px] opacity-70 truncate">{days[dowIdx]}</span>
              <div
                dir="ltr"
                className="flex-1 grid gap-[2px]"
                style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
              >
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
                      type="button"
                      key={hrIdx}
                      onClick={() =>
                        onUpdateFilters(
                          isSel ? { dow_filter: null, hour_filter: null } : { dow_filter: dowIdx, hour_filter: hrIdx }
                        )
                      }
                      aria-pressed={isSel}
                      aria-label={`${days[dowIdx]} ${String(hrIdx).padStart(2, '0')}:00 UTC — ${n(cnt)} ${copy.crashes}`}
                      title={`${days[dowIdx]} ${String(hrIdx).padStart(2, '0')}:00 UTC — ${n(cnt)} ${copy.crashes}`}
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
          <div dir="ltr" className="flex justify-between ps-16 text-[9px] opacity-60 pt-0.5">
            <span>00h</span>
            <span>06h</span>
            <span>08h {copy.rush}</span>
            <span>12h</span>
            <span>17h {copy.rush}</span>
            <span>23h</span>
          </div>
        </div>
      </div>

      {/* 3. Interactive Severity & Taxonomy Cross-Filters */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
        <div className={cardCls}>
          <div className="font-semibold mb-2">{copy.severity}</div>
          {severity_breakdown.length === 0 && <p className="text-[11px] opacity-70">{copy.emptySeverity}</p>}
          <div className="space-y-1.5">
            {severity_breakdown.map((sv) => {
              const active = filters.severity_codes.length === 0 || filters.severity_codes.includes(sv.code);
              return (
                <button
                  type="button"
                  key={sv.code}
                  aria-pressed={filters.severity_codes.includes(sv.code)}
                  onClick={() => toggleSeverity(sv.code)}
                  className={`w-full text-start px-2 py-1 rounded border transition-opacity flex items-center justify-between ${
                    active ? 'opacity-100 border-slate-700/80' : 'opacity-40 border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sv.color }} />
                    <span className="truncate">{domainLabel(language, sv.code, sv.label)}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] shrink-0">
                    <b>{n(sv.count)}</b> <span className="opacity-60">(EPDO {n(sv.epdo_sum)})</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={cardCls}>
          <div className="font-semibold mb-2">{copy.taxonomy}</div>
          {taxonomy_breakdown.length === 0 && <p className="text-[11px] opacity-70">{copy.emptyCategories}</p>}
          <div className="space-y-1.5">
            {taxonomy_breakdown.map((tx) => {
              const active = filters.category_codes.length === 0 || filters.category_codes.includes(tx.code);
              const pct = (tx.count / maxTaxCount) * 100;
              return (
                <button
                  type="button"
                  key={tx.code}
                  aria-pressed={filters.category_codes.includes(tx.code)}
                  onClick={() => toggleCategory(tx.code)}
                  className={`w-full text-start px-2 py-1 rounded border relative overflow-hidden ${
                    active ? 'opacity-100 border-slate-700/80' : 'opacity-40 border-transparent'
                  }`}
                >
                  <div
                    className="absolute inset-y-0 start-0 bg-cyan-500/15 pointer-events-none"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-2">
                    <span className="truncate">{domainLabel(language, tx.code, tx.label)}</span>
                    <span className="font-mono tabular-nums font-bold shrink-0">{n(tx.count)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. Top Corridors in Active Subset */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">{copy.corridors}</span>
          <span className="text-[10px] opacity-65">{copy.corridorHint}</span>
        </div>
        {top_segments.length === 0 && <p className="text-[11px] opacity-70">{copy.emptyCorridors}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse font-mono tabular-nums text-[11px]">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] opacity-65">
                <th className="py-1 pe-2 text-start">{copy.corridor}</th>
                <th className="py-1 px-1 text-end">N</th>
                <th className="py-1 px-1 text-end">N/km</th>
                <th className="py-1 ps-1 text-end">EPDO</th>
              </tr>
            </thead>
            <tbody>
              {top_segments.slice(0, 8).map((seg) => {
                const isSelected = filters.segment_id === seg.segment_id;
                return (
                  <tr
                    key={seg.segment_id}
                    className={`border-b border-slate-800/50 hover:bg-cyan-500/10 ${
                      isSelected ? 'bg-cyan-500/20 text-cyan-300' : ''
                    }`}
                  >
                    <td className="py-1.5 pe-2 font-sans truncate max-w-[180px]">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => {
                          onUpdateFilters({ segment_id: isSelected ? null : seg.segment_id });
                          if (!isSelected) onFlyToSegment(seg.segment_id);
                        }}
                        className="text-start hover:underline focus-visible:outline focus-visible:outline-2"
                      >
                        <Navigation className="w-2.5 h-2.5 inline me-1 text-cyan-400" />
                        <bdi>{seg.name}</bdi>
                      </button>
                    </td>
                    <td className="py-1.5 px-1 text-end font-semibold">{n(seg.count)}</td>
                    <td className="py-1.5 px-1 text-end">{n(seg.density_per_km)}</td>
                    <td className="py-1.5 ps-1 text-end text-amber-400">{n(seg.epdo_sum)}</td>
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
