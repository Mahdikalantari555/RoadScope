import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { PresentationFrame } from './PresentationFrame';
import type { PresentationContext } from '../presentation';
import type { CmvFilterState } from '../types/uai';

const filters: CmvFilterState = {
  verification_mode: 'all_active',
  start_utc: null,
  end_utc: null,
  severity_codes: ['FATAL'],
  category_codes: [],
  dow_filter: null,
  hour_filter: null,
  segment_id: null,
  bbox_4326: null,
  polygon_4326: null,
};

const context: PresentationContext = {
  datasetName: 'Tehran synthetic demonstration',
  datasetProfile: 'demo',
  syntheticIncidents: true,
  calibrationStatus: 'research_only',
  studyAreaLabel: 'Tehran Metropolitan Area (synthetic demo)',
  networkSource: 'seeded_demo',
  networkVersion: 'tehran_demo_v1+seed42',
  networkChecksum: 'ffffffffffffaaaa',
  license: 'Synthetic geometry; no OSM data is redistributed',
  attribution: 'RoadScope synthetic network (not OpenStreetMap)',
  legendNote: 'Synthetic incidents on a labelled demo network',
  canonicalCrs: 'EPSG:32639',
  requiredElements: [],
  screenshotGuidance: 'Use the presentation view; attribution is DOM text.',
  fromContract: true,
};

function renderFrame(props: Partial<React.ComponentProps<typeof PresentationFrame>> = {}) {
  return render(
    <LanguageProvider>
      <PresentationFrame
        context={context}
        filters={filters}
        filterSummary="Severity: Fatal"
        hasFilters
        {...props}
      >
        <div data-testid="map-slot" />
      </PresentationFrame>
    </LanguageProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('PresentationFrame', () => {
  it('keeps every required element as DOM text so a screenshot contains them', () => {
    localStorage.setItem('roadscope.language', 'en');
    renderFrame();
    expect(screen.getByTestId('presentation-dataset').textContent).toContain('Tehran synthetic demonstration');
    expect(screen.getByTestId('presentation-status').textContent).toMatch(/Synthetic incidents/);
    expect(screen.getByTestId('presentation-network').textContent).toContain('tehran_demo_v1+seed42');
    expect(screen.getByTestId('presentation-license').textContent).toContain('Synthetic geometry');
    expect(screen.getByTestId('presentation-attribution').textContent).toContain('not OpenStreetMap');
    expect(screen.getByTestId('presentation-legend-note').textContent).toContain('Synthetic incidents');
    expect(screen.getByTestId('presentation-filters').textContent).toContain('Severity: Fatal');
    expect(screen.getByTestId('presentation-crs').textContent).toBe('EPSG:32639');
    expect(screen.getByTestId('presentation-caveat').textContent).toMatch(/not validated evidence/i);
    expect(screen.getByTestId('map-slot')).toBeTruthy();
  });

  it('states that no filter is active rather than omitting the line', () => {
    localStorage.setItem('roadscope.language', 'en');
    renderFrame({ hasFilters: false, filterSummary: '' });
    expect(screen.getByTestId('presentation-filters').textContent).toMatch(/none/i);
  });

  it('supports a real (non-synthetic) dataset without claiming synthetic status', () => {
    localStorage.setItem('roadscope.language', 'en');
    renderFrame({ context: { ...context, syntheticIncidents: false, datasetProfile: 'pilot' } });
    const status = screen.getByTestId('presentation-status').textContent ?? '';
    expect(status).not.toMatch(/Synthetic/);
    expect(status).toMatch(/research only/i);
  });

  it('remains functional when the API publishes no study-area label', () => {
    localStorage.setItem('roadscope.language', 'en');
    renderFrame({ context: { ...context, studyAreaLabel: '' } });
    expect(screen.getByTestId('presentation-study-area').textContent).toContain('not reported');
  });

  it('is bilingual and keeps the caveat in Persian', () => {
    localStorage.setItem('roadscope.language', 'fa');
    renderFrame();
    expect(screen.getByTestId('presentation-status').textContent).toMatch(/مصنوعی/);
    expect(screen.getByTestId('presentation-caveat').textContent).toMatch(/پژوهشی/);
  });
});
