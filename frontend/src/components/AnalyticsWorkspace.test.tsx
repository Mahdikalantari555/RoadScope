// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import { AnalyticsWorkspace } from './AnalyticsWorkspace';
import type { CmvFilterState, CmvStatePayload } from '../types/uai';

const filters: CmvFilterState = {
  verification_mode: 'verified_only', start_utc: null, end_utc: null, severity_codes: [], category_codes: [],
  dow_filter: null, hour_filter: null, segment_id: null, bbox_4326: null, polygon_4326: null,
};
const data = {
  kpis: { filtered_incidents: 3, total_epdo: 9, ksi_severe_fatal_count: 1, ksi_share_pct: 33.33, mean_credibility: 0.8, mean_snap_drift_m: 10 },
  weekly_series: [{ week_start: '2026-01-05', total_count: 2, selected_count: 1 }, { week_start: '2026-01-12', total_count: 1, selected_count: 1 }],
  diurnal_matrix: [[0, 3]],
  severity_breakdown: [{ code: 'FATAL', label: 'Fatal Crash', rank: 4, color: '#f00', count: 1, epdo_sum: 45 }],
  taxonomy_breakdown: [{ code: 'REAR_END', label: 'Rear-End Queue Collision', count: 2, epdo_sum: 4 }],
  top_segments: [{ segment_id: 7, name: 'Main Street', count: 3, density_per_km: 2, epdo_sum: 9 }],
} as CmvStatePayload;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('renders Persian labels and preserves canonical filter values and UTC chronology', () => {
  localStorage.setItem('roadscope.language', 'fa');
  const onUpdateFilters = vi.fn();
  const onFlyToSegment = vi.fn();
  render(<LanguageProvider><AnalyticsWorkspace darkMode cmvData={data} filters={filters}
    onUpdateFilters={onUpdateFilters} onResetAllFilters={vi.fn()} onFlyToSegment={onFlyToSegment} /></LanguageProvider>);
  expect(screen.getByText('تحلیل بصری مکانی هماهنگ (CMV)')).toBeTruthy();
  expect(screen.getByText('فوتی')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /برخورد از عقب/ }));
  expect(onUpdateFilters).toHaveBeenLastCalledWith({ category_codes: ['REAR_END'] });
  fireEvent.change(screen.getByLabelText('وضعیت تأیید'), { target: { value: 'all_active' } });
  expect(onUpdateFilters).toHaveBeenLastCalledWith({ verification_mode: 'all_active' });
  fireEvent.click(screen.getByRole('button', { name: /هفتهٔ 2026-01-05/ }));
  fireEvent.click(screen.getByRole('button', { name: /هفتهٔ 2026-01-12/ }));
  expect(onUpdateFilters).toHaveBeenLastCalledWith({ start_utc: '2026-01-05T00:00:00Z', end_utc: '2026-01-19T00:00:00Z' });
  fireEvent.click(screen.getByRole('button', { name: /دوشنبه 01:00 UTC/ }));
  expect(onUpdateFilters).toHaveBeenLastCalledWith({ dow_filter: 0, hour_filter: 1 });
  fireEvent.click(screen.getByRole('button', { name: /Main Street/ }));
  expect(onUpdateFilters).toHaveBeenLastCalledWith({ segment_id: 7 });
  expect(onFlyToSegment).toHaveBeenCalledWith(7);
});

it('renders English empty and loading states', () => {
  const props = { darkMode: true, filters, onUpdateFilters: vi.fn(), onResetAllFilters: vi.fn(), onFlyToSegment: vi.fn() };
  const view = render(<LanguageProvider><AnalyticsWorkspace {...props} cmvData={null} /></LanguageProvider>);
  expect(screen.getByText('Synchronizing coordinated views...')).toBeTruthy();
  view.rerender(<LanguageProvider><AnalyticsWorkspace {...props} cmvData={{ ...data, weekly_series: [], severity_breakdown: [], taxonomy_breakdown: [], top_segments: [] }} /></LanguageProvider>);
  expect(screen.getByText('No weekly observations for this selection.')).toBeTruthy();
  expect(screen.getByText('No corridors for this selection.')).toBeTruthy();
});
