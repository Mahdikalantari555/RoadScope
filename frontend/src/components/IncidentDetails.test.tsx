import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { IncidentDetails } from './IncidentDetails';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const incident: Record<string, unknown> = {
  id: 41,
  accident_id: 41,
  occurred_at_utc: '2026-11-08T17:30:00Z',
  category_code: 'PEDESTRIAN_CROSSING',
  severity_code: 'FATAL',
  verification_status: 'verified_canonical',
  source_type: 'vgi',
  segment_id: 12,
  network_distance_m: 14.2,
  linear_offset_m: 88.5,
  witness_count: 3,
  vgi_credibility_score: 0.87,
  weather_condition: 'rain',
  road_surface: 'wet',
  lighting_condition: 'twilight',
  involved_vehicles: 1,
  involved_pedestrians: 1,
  involved_cyclists: 0,
  emergency_response_present: true,
  // These must never be displayed, even if a payload accidentally contains them.
  narrative: 'Reporter free text that must not be shown',
  raw_lon: 51.39,
  raw_lat: 35.69,
  snap_candidates: [{ segment_id: 12 }],
  reporter_identity_hash: 'deadbeef',
};

describe('IncidentDetails', () => {
  it('shows authorised event fields and never reporter material', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><IncidentDetails properties={incident} onClose={() => {}} /></LanguageProvider>);
    expect(screen.getByText('#41')).toBeTruthy();
    expect(screen.getByText('Pedestrian crossing collision')).toBeTruthy();
    expect(screen.getByText('Fatality')).toBeTruthy();
    expect(screen.getByText('verified_canonical')).toBeTruthy();
    expect(screen.getByText('14.2 m')).toBeTruthy();
    expect(screen.getByText('0.870')).toBeTruthy();
    expect(screen.queryByText(/Reporter free text/)).toBeNull();
    expect(screen.queryByText('51.39')).toBeNull();
    expect(screen.queryByText('deadbeef')).toBeNull();
  });

  it('reads the live /analytics/cmv field names, not only the legacy aliases', () => {
    // The unredacted CMV payload publishes `id` and `orthogonal_snap_dist_m`. The earlier
    // allow-list expected `accident_id` / `network_distance_m`, so every one of these rendered
    // "Not reported" even though the server had sent the values.
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <IncidentDetails
          properties={{
            id: 169,
            orthogonal_snap_dist_m: 2.81,
            snap_probability: 0.97,
            observational_radius_m: 8,
            reporting_lag_min: 12.1,
            epdo_weight: 1,
          }}
          onClose={() => {}}
        />
      </LanguageProvider>
    );
    expect(screen.getByText('#169')).toBeTruthy();
    expect(screen.getByText('2.8 m')).toBeTruthy();
    expect(screen.getByText('97%')).toBeTruthy();
    expect(screen.getByText('8 m')).toBeTruthy();
    expect(screen.getByText('12.1 min')).toBeTruthy();
  });

  it('labels missing values instead of implying zero', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <IncidentDetails properties={{ accident_id: 7 }} onClose={() => {}} />
      </LanguageProvider>
    );
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(4);
  });

  it('flags a synthetic incident explicitly', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><IncidentDetails properties={incident} synthetic onClose={() => {}} /></LanguageProvider>);
    expect(screen.getByText(/This incident is synthetic/)).toBeTruthy();
  });

  it('offers a keyboard route from the incident to its segment', () => {
    localStorage.setItem('roadscope.language', 'en');
    const flyTo = vi.fn();
    render(
      <LanguageProvider>
        <IncidentDetails properties={incident} onClose={() => {}} onFlyToSegment={flyTo} />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show segment 12 on the map' }));
    expect(flyTo).toHaveBeenCalledWith(12);
  });

  it('moves focus to the panel heading and can be dismissed', () => {
    localStorage.setItem('roadscope.language', 'en');
    const close = vi.fn();
    render(<LanguageProvider><IncidentDetails properties={incident} onClose={close} /></LanguageProvider>);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(document.activeElement).toBe(heading);
    fireEvent.click(screen.getByRole('button', { name: 'Clear incident selection' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('is bilingual with LTR-isolated numbers under RTL', () => {
    localStorage.setItem('roadscope.language', 'fa');
    render(<LanguageProvider><IncidentDetails properties={incident} onClose={() => {}} /></LanguageProvider>);
    expect(screen.getByText('رخداد انتخاب‌شده')).toBeTruthy();
    expect(screen.getByText('برخورد با عابر پیاده')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
