import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import { MethodsHelp } from './MethodsHelp';
import type { PresentationContext } from '../presentation';

const context: PresentationContext = {
  datasetName: 'Tehran synthetic demo',
  datasetProfile: 'demo',
  syntheticIncidents: true,
  calibrationStatus: 'research_only',
  studyAreaLabel: 'Tehran Metropolitan Area (synthetic demo)',
  networkSource: 'seeded_demo',
  networkVersion: 'tehran_demo_v1+seed42',
  networkChecksum: 'abcd1234efgh',
  license: 'Synthetic geometry; no OSM data is redistributed',
  attribution: 'RoadScope synthetic network (not OpenStreetMap)',
  legendNote: 'Synthetic incidents on a labelled demo network',
  canonicalCrs: 'EPSG:32639',
  requiredElements: [],
  screenshotGuidance: '',
  fromContract: true,
};

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('MethodsHelp', () => {
  it('states units, assumptions, source and uncertainty for every supported output', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><MethodsHelp context={context} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Methods & units/ }));

    // Units and provenance vocabulary must appear, not just a prose blurb.
    expect(screen.getAllByText(/Unit:/).length).toBeGreaterThan(5);
    expect(screen.getAllByText(/Data source:/).length).toBeGreaterThan(5);
    expect(screen.getAllByText(/Assumptions:/).length).toBeGreaterThan(5);
    expect(screen.getAllByText(/Uncertainty:/).length).toBeGreaterThan(5);
    expect(screen.getByText('crashes per million vehicle-kilometres travelled')).toBeTruthy();
  });

  it('identifies synthetic outputs as illustrative rather than validated risk', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><MethodsHelp context={context} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Methods & units/ }));
    const caveat = screen.getByTestId('methods-synthetic-caveat');
    expect(caveat.textContent).toMatch(/synthetic/i);
    expect(caveat.textContent).toMatch(/is a real crash location/i);
    expect(caveat.textContent).toMatch(/research_only/);
  });

  it('lists gated capabilities as unavailable instead of fabricating an output', () => {
    localStorage.setItem('roadscope.language', 'en');
    render(<LanguageProvider><MethodsHelp context={context} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Methods & units/ }));
    expect(screen.getByText(/Unavailable or gated/)).toBeTruthy();
    expect(screen.getByText(/not enabled; no output is substituted/)).toBeTruthy();
  });

  it('is fully bilingual, including Persian units and method names', () => {
    localStorage.setItem('roadscope.language', 'fa');
    render(<LanguageProvider><MethodsHelp context={context} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /روش‌ها و واحدها/ }));
    expect(screen.getByText('روش‌ها، واحدها و محدودیت‌ها')).toBeTruthy();
    expect(screen.getAllByText(/واحد:/).length).toBeGreaterThan(5);
    expect(screen.getByText('تصادف بر میلیون کیلومتر پیمایش وسیله')).toBeTruthy();
  });
});
