import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uaiApi } from '../api/client';
import { LanguageProvider } from '../i18n';
import type { DatasetSource } from '../types/uai';
import { SimulatorWorkspace } from './SimulatorWorkspace';

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

describe('SimulatorWorkspace', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders Persian labels and submits Cox-Hawkes simulation parameters', async () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    const spy = vi.spyOn(uaiApi, 'runSimulation').mockResolvedValue({
      dataset_id: 9,
      total_observations: 245,
      verified_incidents: 210,
      vgi_reports: 35,
      lixel_count: 148,
      random_seed: 77,
    });
    const onCompleted = vi.fn();

    render(
      <LanguageProvider>
        <SimulatorWorkspace
          darkMode={true}
          scenarios={[
            {
              key: 'MULTI_COVARIATE_URBAN',
              title: 'Baseline',
              description: 'Baseline ground truth',
            },
          ]}
          activeDataset={sampleDataset}
          activeRole="simulation_scientist"
          overlayMode="incidents"
          onChangeOverlay={vi.fn()}
          onSimulationCompleted={onCompleted}
        />
      </LanguageProvider>
    );

    expect(screen.getByLabelText('سناریوی شدت فضایی‌ـ‌زمانی λ(e,m,t)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('بذر تصادفی'), { target: { value: '77' } });
    fireEvent.click(screen.getByRole('button', { name: 'تولید و فعال‌سازی مجموعه‌دادهٔ مصنوعی' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ random_seed: 77 });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('surfaces backend error alert when simulation fails', async () => {
    vi.spyOn(uaiApi, 'runSimulation').mockRejectedValue(new Error('RBAC forbidden'));

    render(
      <LanguageProvider>
        <SimulatorWorkspace
          darkMode={true}
          scenarios={[{ key: 'MULTI_COVARIATE_URBAN', title: 'Baseline', description: 'Desc' }]}
          activeDataset={sampleDataset}
          activeRole="citizen_reporter"
          overlayMode="incidents"
          onChangeOverlay={vi.fn()}
          onSimulationCompleted={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate and activate synthetic dataset' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('RBAC forbidden');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
