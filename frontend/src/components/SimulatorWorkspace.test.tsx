// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import { uaiApi } from '../api/client';
import { SimulatorWorkspace } from './SimulatorWorkspace';
import type { DatasetSource, ScenarioSpec } from '../types/uai';

const dataset = { id: 1, name: 'Example', description: 'Synthetic example', is_synthetic: true } as DatasetSource;
const scenarios: ScenarioSpec[] = [{ key: 'MULTI_COVARIATE_URBAN', title: 'Urban', description: 'Urban description' }, { key: 'UNIFORM_BASELINE', title: 'Uniform', description: 'Uniform description' }];
const result = { dataset_id: 4, total_network_length_km: 2, node_count: 3, segment_count: 4, lixel_count: 5, verified_crash_count: 6, vgi_report_count: 7, duplicate_burst_groups: 1 };

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('submits unchanged canonical values from Persian controls and shows results', async () => {
  localStorage.setItem('roadscope.language', 'fa');
  const request = vi.spyOn(uaiApi, 'runSimulation').mockResolvedValue(result);
  const completed = vi.fn(), overlay = vi.fn();
  render(<LanguageProvider><SimulatorWorkspace darkMode scenarios={scenarios} activeDataset={dataset} activeRole="simulation_scientist" overlayMode="incidents" onChangeOverlay={overlay} onSimulationCompleted={completed} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('سناریوی شدت فضایی‌ـ‌زمانی λ(e,m,t)'), { target: { value: 'UNIFORM_BASELINE' } });
  fireEvent.change(screen.getByLabelText('بذر تصادفی'), { target: { value: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'تولید و فعال‌سازی مجموعه‌دادهٔ مصنوعی' }));
  await waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ scenario_key: 'UNIFORM_BASELINE', random_seed: 123, actor_role: 'simulation_scientist' }));
  expect(overlay).toHaveBeenCalledWith('true_lambda');
  expect(screen.getByRole('status').textContent).toContain('مجموعه‌دادهٔ تولیدشده');
});

it('reports errors rather than presenting stale success', async () => {
  vi.spyOn(uaiApi, 'runSimulation').mockRejectedValue(new Error('HTTP 500'));
  const completed = vi.fn();
  render(<LanguageProvider><SimulatorWorkspace darkMode={false} scenarios={scenarios} activeDataset={dataset} activeRole="simulation_scientist" overlayMode="true_lambda" onChangeOverlay={vi.fn()} onSimulationCompleted={completed} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Generate and activate synthetic dataset' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Simulation failed');
  expect(completed).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});
