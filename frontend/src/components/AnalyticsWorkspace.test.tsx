import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { CmvFilterState, CmvStatePayload } from '../types/uai';
import { AnalyticsWorkspace } from './AnalyticsWorkspace';

const baseFilters: CmvFilterState = {
  verification_mode: 'verified_only',
  start_utc: null,
  end_utc: null,
  severity_codes: [],
  category_codes: [],
  dow_filter: null,
  hour_filter: null,
  segment_id: null,
  bbox_4326: null,
  polygon_4326: null,
};

const sampleCmv: CmvStatePayload = {
  kpis: {
    filtered_incidents: 1284,
    total_epdo: 4512.5,
    ksi_severe_fatal_count: 42,
    ksi_share_pct: 12.4,
    mean_credibility: 0.87,
    mean_snap_drift_m: 8.6,
  },
  incidents_geojson: { type: 'FeatureCollection', features: [] },
  vgi_displacement_geojson: { type: 'FeatureCollection', features: [] },
  vgi_uncertainty_geojson: { type: 'FeatureCollection', features: [] },
  weekly_series: [
    { week_start: '2026-10-05', total_count: 14, selected_count: 14 },
    { week_start: '2026-10-12', total_count: 19, selected_count: 15 },
  ],
  diurnal_matrix: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)).map((row, d) =>
    row.map((cell, h) => (d === 0 && h === 1 ? 5 : cell))
  ),
  severity_breakdown: [
    { code: 'FATAL', label: 'Fatal Crash', rank: 4, color: '#ef4444', count: 4, epdo_sum: 180 },
    { code: 'PDO', label: 'Property Damage Only', rank: 1, color: '#38bdf8', count: 120, epdo_sum: 120 },
  ],
  taxonomy_breakdown: [
    { code: 'REAR_END', label: 'Rear-End Collision', count: 48, epdo_sum: 132 },
  ],
  top_segments: [
    {
      segment_id: 7,
      name: 'Mainzer Landstrasse West',
      road_class: 'primary_arterial',
      length_m: 640,
      count: 18,
      epdo_sum: 76.5,
      ksi_count: 3,
      density_per_km: 28.13,
      epdo_per_km: 119.5,
    },
  ],
};

describe('AnalyticsWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders localized Persian CMV labels, tabular numerals, and cross-filter callbacks', () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    const onUpdateFilters = vi.fn();
    const onFlyToSegment = vi.fn();

    render(
      <LanguageProvider>
        <AnalyticsWorkspace
          darkMode={true}
          cmvData={sampleCmv}
          filters={{ ...baseFilters, dow_filter: 0, hour_filter: 1 }}
          onUpdateFilters={onUpdateFilters}
          onResetAllFilters={vi.fn()}
          onFlyToSegment={onFlyToSegment}
        />
      </LanguageProvider>
    );

    expect(screen.getByText('تحلیل بصری مکانی هماهنگ (CMV)')).toBeTruthy();
    expect(screen.getByText('فوتی')).toBeTruthy();
    expect(screen.getByText('برخورد از عقب')).toBeTruthy();
    expect(screen.getByLabelText('وضعیت تأیید')).toBeTruthy();
    expect(screen.getByTitle(/هفتهٔ 2026-10-05/)).toBeTruthy();
    expect(screen.getByTitle(/دوشنبه 01:00 UTC/)).toBeTruthy();

    fireEvent.click(screen.getByText('فوتی'));
    expect(onUpdateFilters).toHaveBeenCalledWith({ severity_codes: ['FATAL'] });

    fireEvent.click(screen.getByText('Mainzer Landstrasse West'));
    expect(onUpdateFilters).toHaveBeenCalledWith({ segment_id: 7 });
    expect(onFlyToSegment).toHaveBeenCalledWith(7);
  });

  it('keeps filters available while loading or after a request error', () => {
    const props = { darkMode: true, cmvData: null, filters: { ...baseFilters, severity_codes: ['FATAL'] },
      onUpdateFilters: vi.fn(), onResetAllFilters: vi.fn(), onFlyToSegment: vi.fn() };
    const { rerender } = render(<LanguageProvider><AnalyticsWorkspace {...props} loading /></LanguageProvider>);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove filter: Severity/i })).toBeTruthy();
    rerender(<LanguageProvider><AnalyticsWorkspace {...props} loading={false} /></LanguageProvider>);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Remove filter: Severity/i }));
    expect(props.onUpdateFilters).toHaveBeenCalledWith({ severity_codes: [] });
  });

  it('discards an unfinished week selection when the query changes and allows cancellation', () => {
    localStorage.setItem('roadscope.language', 'en');
    const update = vi.fn();
    const props = { darkMode: true, cmvData: sampleCmv, filters: baseFilters,
      onUpdateFilters: update, onResetAllFilters: vi.fn(), onFlyToSegment: vi.fn() };
    const { rerender } = render(<LanguageProvider><AnalyticsWorkspace {...props} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-12/ }));
    expect(screen.getByRole('button', { name: /Week of 2026-10-12/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel week selection' }));
    expect(screen.queryByRole('button', { name: 'Cancel week selection' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-12/ }));

    // A shorter response must not reuse an out-of-range index from the old query.
    const nextData = { ...sampleCmv, weekly_series: [sampleCmv.weekly_series[0]] };
    rerender(<LanguageProvider><AnalyticsWorkspace {...props} cmvData={nextData} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-05/ }));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-05/ }));
    expect(update).toHaveBeenCalledWith({ start_utc: '2026-10-05T00:00:00Z', end_utc: '2026-10-12T00:00:00Z' });
  });

  it('drops the timeline anchor when another filter changes', () => {
    localStorage.setItem('roadscope.language', 'en');
    const update = vi.fn();
    const props = { darkMode: true, cmvData: sampleCmv, filters: baseFilters,
      onUpdateFilters: update, onResetAllFilters: vi.fn(), onFlyToSegment: vi.fn() };
    const { rerender } = render(<LanguageProvider><AnalyticsWorkspace {...props} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-12/ }));
    rerender(<LanguageProvider><AnalyticsWorkspace {...props} filters={{...baseFilters, hour_filter: 1}} /></LanguageProvider>);
    expect(screen.queryByRole('button', { name: 'Cancel week selection' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-10-05/ }));
    expect(update).not.toHaveBeenCalled();
  });

  it('renders localized loading and empty states without layout crash', () => {
    const { rerender } = render(
      <LanguageProvider>
        <AnalyticsWorkspace
          darkMode={true}
          cmvData={null}
          filters={baseFilters}
          onUpdateFilters={vi.fn()}
          onResetAllFilters={vi.fn()}
          onFlyToSegment={vi.fn()}
        />
      </LanguageProvider>
    );
    expect(screen.getByText(/Synchronizing coordinated views/)).toBeTruthy();

    rerender(
      <LanguageProvider>
        <AnalyticsWorkspace
          darkMode={true}
          cmvData={{
            ...sampleCmv,
            kpis: { ...sampleCmv.kpis, filtered_incidents: 0 },
            weekly_series: [],
            severity_breakdown: [],
            taxonomy_breakdown: [],
            top_segments: [],
          }}
          filters={baseFilters}
          onUpdateFilters={vi.fn()}
          onResetAllFilters={vi.fn()}
          onFlyToSegment={vi.fn()}
        />
      </LanguageProvider>
    );
    expect(screen.getByText(/No weekly observations for this selection/)).toBeTruthy();
    expect(screen.getByText(/No corridors for this selection/)).toBeTruthy();
  });
});
