import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n';
import { OfflineMapFallback } from './OfflineMapFallback';

const network = {
  segments_geojson: {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { segment_id: 1, elevation_level: 0 },
        geometry: { type: 'LineString' as const, coordinates: [[51.39, 35.69], [51.40, 35.70]] },
      },
      {
        type: 'Feature' as const,
        properties: { segment_id: 2, elevation_level: 1 },
        geometry: { type: 'LineString' as const, coordinates: [[51.39, 35.695], [51.40, 35.695]] },
      },
    ],
  },
  nodes_geojson: { type: 'FeatureCollection' as const, features: [] },
  lixels_geojson: { type: 'FeatureCollection' as const, features: [] },
};

const incidents = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { id: 9, color: '#ef4444', severity_label: 'Fatal' },
      geometry: { type: 'Point' as const, coordinates: [51.395, 35.695] },
    },
  ],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('OfflineMapFallback', () => {
  it('draws the network and incidents as SVG when WebGL is unavailable', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <OfflineMapFallback network={network} incidents={incidents} darkMode reason="WebGL context lost" />
      </LanguageProvider>
    );
    const svg = screen.getByTestId('offline-map-svg');
    expect(svg).toBeTruthy();
    // One solid path and one dashed (elevated) path, plus one incident marker.
    expect(svg.querySelectorAll('path').length).toBe(2);
    expect(svg.querySelectorAll('circle').length).toBe(1);
    expect(screen.getByText(/Reduced vector view/)).toBeTruthy();
    expect(screen.getByText(/WebGL context lost/)).toBeTruthy();
  });

  it('exposes a single descriptive image role rather than hundreds of shapes', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <OfflineMapFallback network={network} incidents={incidents} darkMode />
      </LanguageProvider>
    );
    const image = screen.getByRole('img');
    expect(image.getAttribute('aria-label')).toContain('2 road segments');
    expect(image.getAttribute('aria-label')).toContain('1 incidents');
  });

  it('states the missing data honestly when no geometry is available', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <OfflineMapFallback network={null} incidents={null} darkMode center4326={[51.39, 35.69]} />
      </LanguageProvider>
    );
    expect(screen.getByTestId('offline-map-empty').textContent).toMatch(/No network geometry/);
  });

  it('keeps the synthetic warning visible in the fallback', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <OfflineMapFallback network={network} incidents={incidents} darkMode isSynthetic />
      </LanguageProvider>
    );
    expect(screen.getByText(/Synthetic incidents; not real-world risk/)).toBeTruthy();
  });

  it('is bilingual', () => {
    localStorage.setItem('roadscope.language', 'fa');
    render(
      <LanguageProvider>
        <OfflineMapFallback network={network} incidents={incidents} darkMode />
      </LanguageProvider>
    );
    expect(screen.getByText(/نمای برداری سادهٔ جایگزین/)).toBeTruthy();
  });
});
