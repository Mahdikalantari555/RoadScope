import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { uaiApi } from '../api/client';
import { CitizenReportWorkspace } from './CitizenReportWorkspace';

const baseProps = {
  darkMode: true,
  datasetId: 1,
  activeRole: 'citizen_reporter' as const,
  categories: [{ id: 1, code: 'PEDESTRIAN_CROSSING', label: 'Pedestrian', description: '' }],
  severities: [{ id: 1, code: 'MINOR_INJURY', rank: 2, label: 'Minor', epdo_weight: 5, color_hex: '#f59e0b' }],
  clickedMapCoord: null,
  onActivatePinTool: () => {},
  onUpdateVgiDraftOverlay: () => {},
  onReportSubmittedOrCorroborated: () => {},
  onFlyTo: () => {},
  suggestedPreset4326: [51.389, 35.6892] as [number, number],
  studyAreaLabel: 'Tehran',
  ingestionScope: 'worldwide',
};

beforeEach(() => {
  localStorage.setItem('roadscope.language', 'en');
  vi.spyOn(uaiApi, 'previewSnapAndConflate').mockResolvedValue({
    raw_point: { lon: 51.389, lat: 35.6892, x_m: 0, y_m: 0 },
    uncertainty_circle_geojson: null,
    candidate_snaps: [],
    conflation_alerts: [],
  } as never);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('CitizenReportWorkspace (demo form)', () => {
  it('does not prefill an occurrence time or a narrative that the reporter never wrote', () => {
    render(
      <LanguageProvider>
        <CitizenReportWorkspace {...baseProps} />
      </LanguageProvider>
    );
    const time = screen.getByLabelText(/timestamp/i) as HTMLInputElement;
    expect(time.value).toBe('');
    const narrative = screen.getByLabelText(/Witness Narrative/i) as HTMLTextAreaElement;
    expect(narrative.value).toBe('');
    // A template sentence in a free-text field would be stored as if the witness had written it.
    expect(document.body.textContent).not.toMatch(/Observed conflict near crosswalk/);
  });

  it('refuses to submit until an occurrence time is supplied', () => {
    render(
      <LanguageProvider>
        <CitizenReportWorkspace {...baseProps} />
      </LanguageProvider>
    );
    const submit = screen.getByRole('button', { name: /Submit New Distinct VGI Report/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const submitSpy = vi.spyOn(uaiApi, 'submitVgiReport');
    fireEvent.submit(submit.closest('form') as HTMLFormElement);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(screen.getAllByText(/time required/i).length).toBeGreaterThan(0);
  });

  it('fills the time from "use now" and converts it to UTC', async () => {
    render(
      <LanguageProvider>
        <CitizenReportWorkspace {...baseProps} />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /use now/i }));
    const time = screen.getByLabelText(/timestamp/i) as HTMLInputElement;
    expect(time.value).not.toBe('');
    // The UTC readout under the input is what the API receives.
    await waitFor(() => expect(document.body.textContent).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/));
  });

  it('skips the snap preview while no time is set', async () => {
    render(
      <LanguageProvider>
        <CitizenReportWorkspace {...baseProps} />
      </LanguageProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(uaiApi.previewSnapAndConflate).not.toHaveBeenCalled();
  });
});
