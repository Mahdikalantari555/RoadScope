// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import { HeaderBar } from './HeaderBar';
import type { DatasetSource, PersonaUser } from '../types/uai';

afterEach(() => { cleanup(); localStorage.clear(); });

it('localizes navigation and preserves workspace interactions when switching languages', () => {
  localStorage.clear();
  const onSelectWorkspace = vi.fn();
  const dataset = { id: 1, is_synthetic: true, random_seed: 42, crs_epsg: 25832, lixel_resolution_m: 25, scenario_key: 'TEST' } as DatasetSource;
  const person = { id: 1, role: 'mobility_analyst' } as PersonaUser;
  render(<LanguageProvider><HeaderBar activeWorkspace="analytics" onSelectWorkspace={onSelectWorkspace}
    activeDataset={dataset} datasets={[dataset]} onSwitchDataset={vi.fn()} activeRole="mobility_analyst"
    personas={[person]} onSwitchRole={vi.fn()} darkMode={true} onToggleTheme={vi.fn()} /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fa' } });
  expect(document.documentElement.dir).toBe('rtl');
  fireEvent.click(screen.getByRole('button', { name: /آزمایشگاه مکانی/ }));
  expect(onSelectWorkspace).toHaveBeenCalledWith('spatial_lab');
  expect(screen.getByText(/مصنوعی/)).toBeTruthy();
});
