// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './i18n';

function Controls() {
  const { language, setLanguage, t } = useLanguage();
  return <><span>{t('analytics')}</span><button onClick={() => setLanguage(language === 'en' ? 'fa' : 'en')}>switch</button></>;
}

beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; });
afterEach(cleanup);

describe('language preferences', () => {
  it('switches between Persian RTL and English LTR and persists the choice', () => {
    render(<LanguageProvider><Controls /></LanguageProvider>);
    expect(screen.getByText('CMV Analytics')).toBeTruthy();
    fireEvent.click(screen.getByText('switch'));
    expect(screen.getByText('تحلیل هماهنگ')).toBeTruthy();
    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem('roadscope.language')).toBe('fa');
    fireEvent.click(screen.getByText('switch'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(localStorage.getItem('roadscope.language')).toBe('en');
  });

  it('restores Persian and falls back to English for unknown values', () => {
    localStorage.setItem('roadscope.language', 'fa');
    const first = render(<LanguageProvider><Controls /></LanguageProvider>);
    expect(screen.getByText('تحلیل هماهنگ')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
    first.unmount();
    localStorage.setItem('roadscope.language', 'unknown');
    render(<LanguageProvider><Controls /></LanguageProvider>);
    expect(screen.getByText('CMV Analytics')).toBeTruthy();
    expect(document.documentElement.dir).toBe('ltr');
  });
});
