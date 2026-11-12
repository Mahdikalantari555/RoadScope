import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { TehranPreview } from './TehranPreview';

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe('Tehran preview', () => {
  it('explains missing configuration and provides a way back', async () => {
    localStorage.setItem('roadscope.language', 'en');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const close = vi.fn();
    render(<LanguageProvider><TehranPreview onClose={close} /></LanguageProvider>);
    expect((await screen.findByRole('alert')).textContent).toMatch(/not configured/i);
    fireEvent.click(screen.getByRole('button', {name: 'Back to platform'}));
    expect(close).toHaveBeenCalledOnce();
  });
});
