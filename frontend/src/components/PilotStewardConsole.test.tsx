import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { uaiApi } from '../api/client';
import { PilotStewardConsole } from './PilotStewardConsole';
import type { PilotStatus } from '../types/uai';

const demoStatus: PilotStatus = {
  process_profile: 'demo',
  process_profile_database: '',
  dataset: {
    dataset_id: 1,
    profile_key: 'demo',
    purpose: 'synthetic_demo',
    allows_real_reports: false,
    allows_publication: false,
    is_synthetic: true,
    calibration_status: 'research_only',
    is_publishable: false,
    user_disclosure_approved: false,
    study_area_key: 'tehran',
    archived_at_utc: null,
  },
  pilot_configuration: null,
  flags: {
    pilot_intake: { key: 'pilot_intake', enabled: false, owner: '', approval_reference: '', updated_at_utc: '' },
    pilot_tracking: { key: 'pilot_tracking', enabled: false, owner: '', approval_reference: '', updated_at_utc: '' },
    pilot_publication: { key: 'pilot_publication', enabled: false, owner: '', approval_reference: '', updated_at_utc: '' },
    pilot_corrections: { key: 'pilot_corrections', enabled: false, owner: '', approval_reference: '', updated_at_utc: '' },
  },
  release_gates: {
    owner_and_hosting_approved: false,
    legal_privacy_review_recorded: false,
    identity_model_recorded: false,
    intake_enabled: false,
    publication_enabled: false,
    tracking_enabled: false,
    corrections_enabled: false,
  },
  note: 'disabled',
};

const aggregatesClosed = {
  enabled: false,
  status: 'publication_disabled',
  aggregates: [] as Record<string, any>[],
  minimum_cell_size: 5,
  disclosure_policy_reference: '',
  note: '',
};

function mockConsole(status: PilotStatus, aggregates: typeof aggregatesClosed = aggregatesClosed) {
  vi.spyOn(uaiApi, 'getPilotStatus').mockResolvedValue(status);
  vi.spyOn(uaiApi, 'getPilotAggregates').mockResolvedValue(aggregates);
  vi.spyOn(uaiApi, 'getNetworkExtracts').mockResolvedValue({ extracts: [], count: 0 });
}

function renderConsole(role = 'data_steward') {
  return render(
    <LanguageProvider>
      <PilotStewardConsole darkMode datasetId={1} activeRole={role} />
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.setItem('roadscope.language', 'en');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('PilotStewardConsole', () => {
  it('is unavailable without the server-side steward role', async () => {
    mockConsole(demoStatus);
    renderConsole('citizen_reporter');
    expect(screen.getByTestId('pilot-console-not-steward')).toBeTruthy();
    expect(screen.getByTestId('pilot-console-not-steward').textContent).toMatch(/data_steward/);
    expect(screen.queryByLabelText('Owner')).toBeNull();
  });

  it('cannot enable a flag without an owner and an approval reference', async () => {
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByTestId('pilot-flag-pilot_intake')).toBeTruthy());
    // Four flags exist, so there are four enable buttons; each must be disabled while empty.
    const enables = screen.getAllByRole('button', { name: 'Enable' }) as HTMLButtonElement[];
    expect(enables.every((button) => button.disabled)).toBe(true);

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Operations lead' } });
    expect((screen.getAllByRole('button', { name: 'Enable' })[0] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Approval reference'), { target: { value: 'APPR-2026-001' } });
    expect((screen.getAllByRole('button', { name: 'Enable' })[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the owner and approval reference with the flag change', async () => {
    mockConsole(demoStatus);
    const setFlag = vi.spyOn(uaiApi, 'setPilotFlag').mockResolvedValue({ ok: true });
    renderConsole();
    await waitFor(() => expect(screen.getByLabelText('Owner')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Operations lead' } });
    fireEvent.change(screen.getByLabelText('Approval reference'), { target: { value: 'APPR-2026-001' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable' })[0]);
    await waitFor(() => expect(setFlag).toHaveBeenCalled());
    expect(setFlag).toHaveBeenCalledWith({
      key: 'pilot_intake',
      enabled: true,
      owner: 'Operations lead',
      approval_reference: 'APPR-2026-001',
      dataset_id: 1,
    });
  });

  it('shows that publication is closed and refuses a rebuild without a policy reference', async () => {
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByTestId('pilot-aggregate-closed')).toBeTruthy());
    expect(screen.getByRole('button', { name: /Rebuild published aggregates/ })).toHaveProperty('disabled', true);
  });

  it('warns that a synthetic dataset cannot carry real-report flags', async () => {
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByTestId('pilot-flag-pilot_intake')).toBeTruthy());
    expect(screen.getByText(/Synthetic dataset — real-report flags are refused/)).toBeTruthy();
  });

  it('states the external approvals this console cannot grant', async () => {
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByText(/Before enabling anything/)).toBeTruthy());
    expect(screen.getByText(/institutional, privacy and legal sign-off/)).toBeTruthy();
    expect(screen.getByText(/Publication is a separate decision from intake/)).toBeTruthy();
  });

  it('never renders report content', async () => {
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByTestId('pilot-flag-pilot_intake')).toBeTruthy());
    expect(screen.getByText(/No report content is displayed/)).toBeTruthy();
  });

  it('surfaces a server refusal as a localised error', async () => {
    mockConsole(demoStatus);
    vi.spyOn(uaiApi, 'setPilotFlag').mockRejectedValue(
      new Error('Pilot intake requires a dataset created under the isolated pilot profile.')
    );
    renderConsole();
    await waitFor(() => expect(screen.getByLabelText('Owner')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Ops' } });
    fireEvent.change(screen.getByLabelText('Approval reference'), { target: { value: 'APPR' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable' })[0]);
    await waitFor(() =>
      expect(screen.getByTestId('pilot-console-error').textContent).toMatch(/isolated pilot profile/)
    );
  });

  it('is bilingual', async () => {
    localStorage.setItem('roadscope.language', 'fa');
    mockConsole(demoStatus);
    renderConsole();
    await waitFor(() => expect(screen.getByText('کنسول پایلوت محدود')).toBeTruthy());
    expect(document.documentElement.dir).toBe('rtl');
  });
});
