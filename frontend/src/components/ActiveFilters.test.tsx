import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import type { CmvFilterState } from '../types/uai';
import { ActiveFilters } from './ActiveFilters';

const filters: CmvFilterState = { verification_mode: 'verified_only', start_utc: null, end_utc: null, severity_codes: ['PDO', 'FATAL'], category_codes: [], dow_filter: null, hour_filter: 0, segment_id: 12, bbox_4326: null, polygon_4326: null };
afterEach(() => { cleanup(); localStorage.clear(); });
describe('active filters', () => {
  it('clears only the chosen severity and treats zero hour as active', () => {
    localStorage.setItem('roadscope.language', 'en');
    const update = vi.fn(), reset = vi.fn();
    render(<LanguageProvider><ActiveFilters filters={filters} onUpdate={update} onReset={reset}/></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Remove filter: Severity:.*PDO/i }));
    expect(update).toHaveBeenCalledWith({severity_codes: ['FATAL']});
    fireEvent.click(screen.getByRole('button', { name: /Remove filter: Hour: 00:00/i }));
    expect(update).toHaveBeenCalledWith({hour_filter: null});
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
