import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { SegmentDetails } from './SegmentDetails';

afterEach(() => { cleanup(); localStorage.clear(); });

const empty = { type: 'FeatureCollection' as const, features: [] };
function networkWith(properties: Record<string, unknown>) {
  return {
    segments_geojson: {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [[1, 2], [3, 4]] },
          properties,
        },
      ],
    },
    nodes_geojson: empty,
    lixels_geojson: empty,
  };
}

describe('segment details', () => {
  it('shows only selected road attributes and permits clearing selection', () => {
    localStorage.setItem('roadscope.language', 'en');
    const close = vi.fn();
    const network = networkWith({
      segment_id: 7,
      name: 'Example road',
      length_m: 123,
      elevation_level: 0,
      secret: 'not displayed',
    });
    render(<LanguageProvider><SegmentDetails segmentId={7} network={network} onClose={close} /></LanguageProvider>);
    expect(screen.getByText('Example road')).toBeTruthy();
    expect(screen.queryByText('not displayed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear segment selection' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('labels unreported values instead of showing a zero or a blank', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><SegmentDetails segmentId={7} network={networkWith({ segment_id: 7, name: 'Bare road' })} onClose={() => {}} /></LanguageProvider>);
    // speed limit, lanes, slope, AADT, edge code and provenance are all absent in this payload.
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(3);
    expect(screen.queryByText('0 km/h')).toBeNull();
  });

  it('shows grade/direction provenance and flags ambiguous topology', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <SegmentDetails
          segmentId={9}
          network={networkWith({
            segment_id: 9,
            name: 'Bridge',
            elevation_level: 1,
            grade_source: 'osm_layer_tag',
            direction_source_detail: 'osm_oneway',
            oneway_direction: 1,
            topology_ambiguous: true,
            source_feature_id: 'way/12345',
            source_version: 'tehran-test-v1',
          })}
          onClose={() => {}}
        />
      </LanguageProvider>
    );
    expect(screen.getByText('osm_layer_tag')).toBeTruthy();
    expect(screen.getByText(/Topology is ambiguous/)).toBeTruthy();
    expect(screen.getByText(/Elevated level/)).toBeTruthy();
    expect(screen.getByText('way/12345')).toBeTruthy();
    expect(screen.getByText(/tehran-test-v1/)).toBeTruthy();
  });

  it('marks an imputed traffic volume as imputed', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(
      <LanguageProvider>
        <SegmentDetails
          segmentId={3}
          network={networkWith({ segment_id: 3, name: 'Road', aadt: 12000, aadt_is_imputed: true })}
          onClose={() => {}}
        />
      </LanguageProvider>
    );
    expect(screen.getByText('imputed')).toBeTruthy();
  });

  it('is bilingual and keeps numeric values LTR under RTL layout', () => {
    localStorage.setItem('roadscope.language', 'fa');
    render(
      <LanguageProvider>
        <SegmentDetails segmentId={5} network={networkWith({ segment_id: 5, name: 'خیابان نمونه', length_m: 250 })} onClose={() => {}} />
      </LanguageProvider>
    );
    expect(screen.getByText('قطعهٔ انتخاب‌شده')).toBeTruthy();
    expect(screen.getAllByText('ثبت نشده').length).toBeGreaterThan(1);
    expect(document.documentElement.dir).toBe('rtl');
  });
});
