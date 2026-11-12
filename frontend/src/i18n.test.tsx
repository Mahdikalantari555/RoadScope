import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from './i18n';
import {
  getCitizenVgiText,
  getMapChartsText,
  getRiskEbText,
  getSpatialLabText,
  getStewardText,
} from './workspaceI18n';

const Probe: React.FC = () => {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="title">{t('analytics')}</span>
      <button type="button" onClick={() => setLanguage('fa')}>
        switch-fa
      </button>
    </div>
  );
};

describe('LanguageProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
  });

  afterEach(() => {
    cleanup();
  });

  it('switches document language and direction cleanly between English and Persian', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );

    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');

    fireEvent.click(screen.getByText('switch-fa'));
    expect(screen.getByTestId('lang').textContent).toBe('fa');
    expect(screen.getByTestId('title').textContent).toBe('تحلیل هماهنگ');
    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(window.localStorage.getItem('roadscope.language')).toBe('fa');
  });

  it('restores saved Persian preference on initial load', () => {
    window.localStorage.setItem('roadscope.language', 'fa');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByTestId('lang').textContent).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('maintains 100% key parity across all workspace EN/FA dictionaries', () => {
    for (const getter of [
      getSpatialLabText,
      getRiskEbText,
      getCitizenVgiText,
      getStewardText,
      getMapChartsText,
    ]) {
      expect(Object.keys(getter('fa')).sort()).toEqual(Object.keys(getter('en')).sort());
    }
  });
});
