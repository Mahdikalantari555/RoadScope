import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { DatasetSource } from '../types/uai';
import { HeaderBar } from './HeaderBar';

const sampleDataset: DatasetSource = {
  id: 1,
  name: 'Frankfurt Synthetic Baseline',
  scenario_key: 'MULTI_COVARIATE_URBAN',
  is_synthetic: true,
  crs_epsg: 25832,
  lixel_resolution_m: 25,
  study_period_years: 1,
  random_seed: 42,
  description: 'Baseline',
  is_active: true,
  created_at_utc: '2026-11-01T00:00:00Z',
  generator_params: {},
};

describe('HeaderBar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ contract_version: '1.0.0', available: [], primitives_only: [], unavailable: {} }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('renders localized workspace navigation and switches to Persian RTL', () => {
    render(
      <LanguageProvider>
        <HeaderBar
          activeWorkspace="analytics"
          onSelectWorkspace={vi.fn()}
          activeDataset={sampleDataset}
          datasets={[sampleDataset]}
          onSwitchDataset={vi.fn()}
          activeRole="mobility_analyst"
          personas={[
            {
              id: 1,
              username: 'analyst',
              full_name: 'Mobility Analyst',
              role: 'mobility_analyst',
              trust_weight: 1.0,
            },
          ]}
          onSwitchRole={vi.fn()}
          darkMode={true}
          onToggleTheme={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('button', { name: 'CMV Analytics' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fa' } });

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('button', { name: 'تحلیل هماهنگ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'آزمایشگاه مکانی' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ریسک و بیز تجربی' })).toBeTruthy();
    expect(screen.getByText(/مصنوعی · بذر/)).toBeTruthy();
  });
});
