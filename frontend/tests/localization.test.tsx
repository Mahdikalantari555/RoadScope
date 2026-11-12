import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider, en, fa, useLocale } from '../src/i18n';
import { ResearchAccess } from '../src/components/ResearchAccess';

function Switcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t('analytics')}</span>
      <button type="button" onClick={() => setLocale(locale === 'en' ? 'fa' : 'en')}>
        switch
      </button>
    </div>
  );
}

describe('English/Persian localization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it('has complete Persian coverage for every English key', () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  });

  it('toggles document direction and persists language choice', () => {
    render(
      <LocaleProvider>
        <Switcher />
      </LocaleProvider>
    );
    expect(document.documentElement.dir).toBe('ltr');
    fireEvent.click(screen.getByText('switch'));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('fa');
    expect(screen.getByTestId('title').textContent).toContain('تحلیل');
    expect(window.localStorage.getItem('roadscope.language')).toBe('fa');
  });

  it('renders honest capability availability and gating reasons in Persian', async () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contract_version: '1.0.0',
          available: ['adaptive_tnkde', 'length_scaled_eb'],
          primitives_only: ['directed_lixel_graph'],
          unavailable: {
            spatial_bayes_bym2_inla: { reason: { en: 'No conflicts', fa: 'تعارضی ثبت نشده' } },
          },
        }),
      })
    );

    render(
      <LocaleProvider>
        <ResearchAccess />
      </LocaleProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: fa.research }));
    expect(await screen.findByText(/تعارضی ثبت نشده/)).toBeTruthy();
  });
});
