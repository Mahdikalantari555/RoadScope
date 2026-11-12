import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n';
import { MethodsHelp } from './MethodsHelp';

describe('MethodsHelp', () => {
  it('opens a guide that explains the limitations of synthetic data', () => {
    localStorage.setItem('roadscope.language', 'en');
    const showModal = vi.fn();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { value: showModal, configurable: true });
    render(<LanguageProvider><MethodsHelp /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Practical guide' }));
    expect(showModal).toHaveBeenCalled();
    expect(screen.getByText(/Synthetic data are for demonstration/)).toBeTruthy();
  });
});
