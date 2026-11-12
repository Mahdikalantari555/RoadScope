import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { DatasetBanner } from './DatasetBanner';
import type { PresentationContext } from '../presentation';

function context(overrides: Partial<PresentationContext> = {}): PresentationContext {
  return {
    datasetName: 'Tehran synthetic demonstration',
    datasetProfile: 'demo',
    syntheticIncidents: true,
    calibrationStatus: 'research_only',
    studyAreaLabel: 'Tehran Metropolitan Area (synthetic demo)',
    networkSource: 'seeded_demo',
    networkVersion: 'tehran_demo_v1+seed42',
    networkChecksum: '3f9a1c88bb024e1d9e2f',
    license: 'Synthetic geometry; no OSM data is redistributed',
    attribution: 'RoadScope synthetic network (not OpenStreetMap)',
    legendNote: 'Synthetic incidents on a labelled demo network',
    canonicalCrs: 'EPSG:32639',
    requiredElements: [],
    screenshotGuidance: '',
    fromContract: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('DatasetBanner', () => {
  it('keeps dataset identity, profile and provenance on screen', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><DatasetBanner context={context()} /></LanguageProvider>);
    expect(screen.getByTestId('dataset-banner-name').textContent).toBe('Tehran synthetic demonstration');
    expect(screen.getByTestId('dataset-banner-status').textContent).toMatch(/Synthetic incidents/);
    expect(screen.getByTestId('dataset-banner-attribution').textContent).toContain('RoadScope synthetic network');
    expect(screen.getByTestId('dataset-banner-legend-note').textContent).toContain('Synthetic incidents');
    const banner = screen.getByTestId('dataset-banner');
    expect(banner.getAttribute('data-dataset-profile')).toBe('demo');
    expect(banner.getAttribute('data-synthetic')).toBe('true');
    // Version and short checksum are both visible so a screenshot is traceable to an extract.
    expect(banner.textContent).toContain('tehran_demo_v1+seed42');
    expect(banner.textContent).toContain('3f9a1c88bb02');
    expect(banner.textContent).toContain('EPSG:32639');
  });

  it('never claims synthetic status when the API does not report it', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><DatasetBanner context={context({ syntheticIncidents: null })} /></LanguageProvider>);
    expect(screen.getByTestId('dataset-banner-status').textContent).toMatch(/unknown/i);
  });

  it('describes a real research dataset differently from a synthetic one', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <DatasetBanner context={context({ syntheticIncidents: false, datasetProfile: 'pilot', calibrationStatus: 'research_only' })} />
      </LanguageProvider>
    );
    const status = screen.getByTestId('dataset-banner-status').textContent ?? '';
    expect(status).toMatch(/research only/i);
    expect(status).not.toMatch(/Synthetic/);
  });

  it('renders "not reported" rather than inventing a licence or attribution', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><DatasetBanner context={context({ license: '', attribution: '' })} /></LanguageProvider>);
    expect(screen.getAllByText('not reported').length).toBeGreaterThanOrEqual(2);
  });

  it('collapses to one line in presentation mode but keeps identity and source', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><DatasetBanner context={context()} compact /></LanguageProvider>);
    expect(screen.getByTestId('dataset-banner-compact-source')).toBeTruthy();
    expect(screen.queryByTestId('dataset-banner-attribution')).toBeNull();
    expect(screen.getByTestId('dataset-banner-name')).toBeTruthy();
  });

  it('is bilingual', () => {
    localStorage.setItem('roadscope.language', 'fa');
    render(<LanguageProvider><DatasetBanner context={context()} /></LanguageProvider>);
    expect(screen.getByTestId('dataset-banner-status').textContent).toMatch(/مصنوعی/);
    expect(screen.getByTestId('dataset-banner')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
