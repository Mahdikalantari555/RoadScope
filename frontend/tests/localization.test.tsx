import React from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { en, fa, LocaleProvider } from '../src/i18n';
import { HeaderBar } from '../src/components/HeaderBar';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: ['directed_diffusion'], primitives_only: ['fixed_tnkde'], unavailable: {} }) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Shell() {
  return <LocaleProvider><HeaderBar activeWorkspace="analytics" onSelectWorkspace={() => {}}
    activeDataset={{ id: 1, is_synthetic: true, random_seed: 42, crs_epsg: 25832, lixel_resolution_m: 25 } as any}
    datasets={[]} onSwitchDataset={() => {}} activeRole="mobility_analyst" personas={[]}
    onSwitchRole={() => {}} darkMode={true} onToggleTheme={() => {}} /></LocaleProvider>;
}

test('shell catalogs have identical nonempty keys', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  expect(Object.values(fa).every(value => value.trim().length > 0)).toBe(true);
});

test('Persian switch updates all six navigation names, lang, dir and persistence', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Shell />);
  await user.selectOptions(screen.getByRole('combobox', { name: en.language }), 'fa');
  for (const key of ['analytics', 'spatial_lab', 'risk_eb', 'citizen_vgi', 'stewardship', 'simulator'] as const) {
    expect(screen.getByRole('button', { name: new RegExp(fa[key]) })).toBeTruthy();
  }
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
  expect(localStorage.getItem('roadscope.language')).toBe('fa');
  unmount();
  render(<Shell />);
  expect(screen.getByRole('combobox', { name: fa.language })).toHaveProperty('value', 'fa');
  await user.selectOptions(screen.getByRole('combobox', { name: fa.language }), 'en');
  expect(document.documentElement.dir).toBe('ltr');
  expect(document.documentElement.lang).toBe('en');
});

test('research access is a real control rather than a fake model result', async () => {
  const user = userEvent.setup();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  render(<Shell />);
  await user.click(screen.getByRole('button', { name: en.research }));
  await waitFor(() => expect(screen.getByText('directed_diffusion')).toBeTruthy());
  expect(screen.getByText(en.auth)).toBeTruthy();
  expect(screen.getByLabelText(en.token).getAttribute('type')).toBe('password');
  await user.click(screen.getByRole('button', { name: en.close }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
