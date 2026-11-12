import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n';
import { uaiApi } from '../api/client';
import { PilotReportWorkspace } from './PilotReportWorkspace';
import type { PilotBootstrap, PilotStatus } from '../types/uai';

const closedStatus: PilotStatus = {
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
  note: 'feature flags disabled',
};

const openStatus: PilotStatus = {
  ...closedStatus,
  process_profile: 'pilot',
  dataset: {
    dataset_id: 1,
    profile_key: 'pilot',
    purpose: 'restricted_pilot',
    allows_real_reports: true,
    allows_publication: false,
    is_synthetic: false,
    calibration_status: 'research_only',
    is_publishable: false,
    user_disclosure_approved: false,
    study_area_key: 'tehran',
    archived_at_utc: null,
  },
  flags: {
    ...closedStatus.flags,
    pilot_intake: {
      key: 'pilot_intake',
      enabled: true,
      owner: 'Operations lead',
      approval_reference: 'APPR-2026-001',
      updated_at_utc: '2026-11-12T00:00:00Z',
    },
    pilot_tracking: {
      key: 'pilot_tracking',
      enabled: true,
      owner: 'Operations lead',
      approval_reference: 'APPR-2026-001',
      updated_at_utc: '2026-11-12T00:00:00Z',
    },
  },
  release_gates: {
    owner_and_hosting_approved: true,
    legal_privacy_review_recorded: true,
    identity_model_recorded: true,
    intake_enabled: true,
    publication_enabled: false,
    tracking_enabled: true,
    corrections_enabled: false,
  },
  note: 'intake approved',
};

const bootstrap: PilotBootstrap = {
  dataset_id: 1,
  consent_version: 'pilot-consent-v1',
  intake_enabled: true,
  tracking_enabled: true,
  publication: { enabled: false, status: 'publication_disabled', minimum_cell_size: null },
  study_area: null,
  network_extract: null,
  timezone: 'Asia/Tehran',
  categories: [
    { id: 1, code: 'REAR_END', label: 'Rear end', description: '' },
    { id: 2, code: 'PEDESTRIAN_CROSSING', label: 'Pedestrian', description: '' },
  ],
  severities: [
    { id: 1, code: 'PDO', rank: 1, label: 'PDO', epdo_weight: 1, color_hex: '#38bdf8' },
    { id: 2, code: 'FATAL', rank: 4, label: 'Fatal', epdo_weight: 45, color_hex: '#ef4444' },
  ],
  privacy: { free_text: 'not accepted' },
};

function mockGate(status: PilotStatus, boot: Partial<PilotBootstrap> = {}) {
  vi.spyOn(uaiApi, 'getPilotStatus').mockResolvedValue(status);
  vi.spyOn(uaiApi, 'getPilotBootstrap').mockResolvedValue({ ...bootstrap, ...boot });
}

function renderWorkspace() {
  return render(
    <LanguageProvider>
      <PilotReportWorkspace darkMode datasetId={1} suggestedPreset4326={[51.39, 35.69]} studyAreaLabel="Tehran" />
    </LanguageProvider>
  );
}

beforeEach(() => {
  localStorage.setItem('roadscope.language', 'en');
  vi.spyOn(uaiApi, 'previewSnapAndConflate').mockResolvedValue({
    raw_point: { lon: 51.39, lat: 35.69, x_m: 0, y_m: 0, srid: 32639 },
    uncertainty_circle_geojson: { type: 'Point', coordinates: [51.39, 35.69] },
    candidate_snaps: [],
    conflation_alerts: [],
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('PilotReportWorkspace — closed gate', () => {
  it('explains why reporting is closed instead of showing unusable inputs', async () => {
    mockGate(closedStatus, { intake_enabled: false });
    renderWorkspace();

    await waitFor(() => expect(screen.getByTestId('pilot-closed-body')).toBeTruthy());
    expect(screen.getByTestId('pilot-closed-body').textContent).toMatch(/synthetic-data only/i);
    // The form must not be rendered at all.
    expect(screen.queryByRole('button', { name: 'Submit report' })).toBeNull();
    expect(screen.queryByLabelText(/Longitude/)).toBeNull();
  });

  it('lists every gate and its state so the reason is auditable', async () => {
    mockGate(closedStatus, { intake_enabled: false });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('pilot-gates')).toBeTruthy());
    const gates = screen.getByTestId('pilot-gates').textContent ?? '';
    expect(gates).toContain('pilot_intake');
    expect(gates).toContain('demo');
    expect(gates).toContain('✗');
  });

  it('keeps tracking closed and says so', async () => {
    mockGate(closedStatus, { intake_enabled: false });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('pilot-tracking-closed')).toBeTruthy());
    expect(screen.queryByLabelText('Tracking credential')).toBeNull();
  });

  it('surfaces a load failure with a retry affordance rather than a blank panel', async () => {
    vi.spyOn(uaiApi, 'getPilotStatus').mockRejectedValue(new Error('service unavailable'));
    vi.spyOn(uaiApi, 'getPilotBootstrap').mockRejectedValue(new Error('service unavailable'));
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('service unavailable'));
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });
});

describe('PilotReportWorkspace — open gate', () => {
  it('requires explicit consent before the submit button can be used', async () => {
    mockGate(openStatus);
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy());
    const submit = screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit.disabled).toBe(false);
  });

  it('never offers a free-text, photo or identity field', async () => {
    mockGate(openStatus);
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy());
    expect(screen.queryByRole('textbox', { name: /narrative/i })).toBeNull();
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
    expect(screen.queryByLabelText(/name/i)).toBeNull();
    // What is collected is stated explicitly.
    expect(screen.getByText(/Photos or video/)).toBeTruthy();
    expect(screen.getByText(/Free-text description or names/)).toBeTruthy();
  });

  it('offers "unknown" as a real severity answer', async () => {
    mockGate(openStatus);
    renderWorkspace();
    await waitFor(() => expect(screen.getByLabelText('How severe was it?')).toBeTruthy());
    const severity = screen.getByLabelText('How severe was it?') as HTMLSelectElement;
    const values = Array.from(severity.options).map((o) => o.value);
    expect(values).toContain('__unknown');
  });

  it('keeps a report unmatched when no road candidate is within the radius', async () => {
    mockGate(openStatus);
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('pilot-match-state')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('pilot-match-state').textContent).toMatch(/No road is within/));
  });

  it('warns when several roads are plausible instead of asserting a match', async () => {
    mockGate(openStatus);
    vi.spyOn(uaiApi, 'previewSnapAndConflate').mockResolvedValue({
      raw_point: { lon: 51.39, lat: 35.69, x_m: 0, y_m: 0, srid: 32639 },
      uncertainty_circle_geojson: { type: 'Point', coordinates: [51.39, 35.69] },
      candidate_snaps: [
        {
          rank: 1,
          segment_id: 4,
          edge_code: 'E4',
          segment_name: 'Avenue A',
          road_class: 'primary',
          elevation_level: 0,
          speed_limit_kmh: 50,
          lixel_id: null,
          linear_offset_m: 12,
          segment_length_m: 100,
          orthogonal_dist_m: 8,
          snapped_x_m: 0,
          snapped_y_m: 0,
          snapped_lon: 51.39,
          snapped_lat: 35.69,
          spatial_likelihood: 0.5,
          class_prior: 0.3,
          topo_factor: 1,
          snap_probability: 0.51,
          is_naive_euclidean_nearest: false,
          topological_override: false,
        },
        {
          rank: 2,
          segment_id: 5,
          edge_code: 'E5',
          segment_name: 'Avenue B',
          road_class: 'primary',
          elevation_level: 1,
          speed_limit_kmh: 50,
          lixel_id: null,
          linear_offset_m: 10,
          segment_length_m: 90,
          orthogonal_dist_m: 9,
          snapped_x_m: 0,
          snapped_y_m: 0,
          snapped_lon: 51.39,
          snapped_lat: 35.69,
          spatial_likelihood: 0.48,
          class_prior: 0.3,
          topo_factor: 1,
          snap_probability: 0.46,
          is_naive_euclidean_nearest: false,
          topological_override: false,
        },
      ],
      conflation_alerts: [],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('pilot-match-state').textContent).toMatch(/Several roads/));
  });

  it('shows the receipt credential once and never in a URL', async () => {
    mockGate(openStatus);
    vi.spyOn(uaiApi, 'submitPilotReport').mockResolvedValue({
      report_public_id: 'RS-000042',
      dataset_id: 1,
      tracking_credential: 'ABCD-EFGH-JKLM',
      tracking_credential_note: 'Shown once.',
      occurred_at_utc: '2026-11-10T14:50:00Z',
      occurred_at_local_input: '2026-11-10T18:20:00',
      timezone: 'Asia/Tehran',
      verification_status: 'unverified_raw_vgi',
      snap_confidence: 'uncertain',
      unmatched: false,
      coarse_location: { lon: 51.39, lat: 35.7, cell_key: '35.70:51.39' },
      duplicate_suggestion: null,
      uncertainty_radius_m: 25,
      candidate_count: 0,
      retention_until_utc: '2027-11-10T00:00:00Z',
      consent_version: 'pilot-consent-v1',
      synthetic: false,
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    await waitFor(() => expect(screen.getByTestId('pilot-credential')).toBeTruthy());
    expect(screen.getByTestId('pilot-credential').textContent).toBe('ABCD-EFGH-JKLM');
    expect(window.location.href).not.toContain('ABCD-EFGH-JKLM');
    expect(screen.getByText(/shown only once/i)).toBeTruthy();
    expect(screen.getByText(/Never share it in a message or a URL/i)).toBeTruthy();
  });

  it('maps a rate-limit rejection to localised guidance', async () => {
    mockGate(openStatus);
    vi.spyOn(uaiApi, 'submitPilotReport').mockRejectedValue(
      new Error('Reporting rate limit reached (3/3 per hour).')
    );
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit report' })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    await waitFor(() =>
      expect(screen.getByTestId('pilot-error').textContent).toMatch(/Too many reports from this device/)
    );
  });
});

describe('PilotReportWorkspace — localisation and access', () => {
  it('is fully bilingual', async () => {
    localStorage.setItem('roadscope.language', 'fa');
    mockGate(closedStatus, { intake_enabled: false });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('pilot-closed-body')).toBeTruthy());
    expect(screen.getByText('پایلوت محدود — در این استقرار بسته است')).toBeTruthy();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('labels the consent checkbox and the purpose statement for assistive technology', async () => {
    mockGate(openStatus);
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-describedby')).toBe('pilot-consent-version');
    expect(screen.getByText(/Consent policy version/)).toBeTruthy();
    expect(screen.getByText('Why we ask')).toBeTruthy();
  });
});
