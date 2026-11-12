import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { SegmentDetails } from './SegmentDetails';

afterEach(() => { cleanup(); localStorage.clear(); });
describe('segment details', () => {
  it('shows only selected road attributes and permits clearing selection', () => {
    localStorage.setItem('roadscope.language', 'en');
    const close = vi.fn();
    const empty = {type: 'FeatureCollection' as const, features: []};
    const network = {segments_geojson: {type: 'FeatureCollection' as const, features: [{type: 'Feature' as const, geometry: {type: 'LineString' as const, coordinates: [[1, 2], [3, 4]]}, properties: {segment_id: 7, name: 'Example road', length_m: 123, elevation_level: 0, secret: 'not displayed'}}]}, nodes_geojson: empty, lixels_geojson: empty};
    render(<LanguageProvider><SegmentDetails segmentId={7} network={network} onClose={close}/></LanguageProvider>);
    expect(screen.getByText('Example road')).toBeTruthy();
    expect(screen.queryByText('not displayed')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Clear selection'}));
    expect(close).toHaveBeenCalledOnce();
  });
});
