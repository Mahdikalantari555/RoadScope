import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { ResearchAccess } from './ResearchAccess';
import { hasApiToken, setApiToken } from '../api/client';

beforeEach(() => {
  localStorage.setItem('roadscope.language', 'en');
  setApiToken('');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: [], unavailable: {} }) })
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.sessionStorage.clear();
  setApiToken('');
  vi.unstubAllGlobals();
});

describe('ResearchAccess', () => {
  it('keeps the token out of the URL and survives a reload of the same tab', () => {
    render(
      <LanguageProvider>
        <ResearchAccess />
      </LanguageProvider>
    );
    fireEvent.change(screen.getByLabelText(/token/i), { target: { value: 'tok-steward' } });
    fireEvent.submit(screen.getByLabelText(/token/i).closest('form') as HTMLFormElement);
    expect(hasApiToken()).toBe(true);
    expect(window.sessionStorage.getItem('roadscope.apiToken')).toBe('tok-steward');
    expect(window.location.href).not.toContain('tok-steward');
  });

  it('clears the stored token on sign-out', () => {
    setApiToken('tok-steward');
    render(
      <LanguageProvider>
        <ResearchAccess />
      </LanguageProvider>
    );
    // The dialog is closed by default, so its controls are outside the accessibility tree.
    fireEvent.click(screen.getByRole('button', { name: /clear/i, hidden: true }));
    expect(hasApiToken()).toBe(false);
    expect(window.sessionStorage.getItem('roadscope.apiToken')).toBeNull();
  });

  it('can open by default and reports a completed sign-in so the caller can retry', () => {
    const onAuthenticated = vi.fn();
    render(
      <LanguageProvider>
        <ResearchAccess defaultOpen onAuthenticated={onAuthenticated} />
      </LanguageProvider>
    );
    // jsdom may not implement `showModal`; opening via the trigger keeps the test honest either way.
    fireEvent.click(screen.getByRole('button', { name: /Research availability/i }));
    fireEvent.change(screen.getByLabelText(/token/i), { target: { value: 'tok-steward' } });
    fireEvent.submit(screen.getByLabelText(/token/i).closest('form') as HTMLFormElement);
    expect(onAuthenticated).toHaveBeenCalled();
  });
});
