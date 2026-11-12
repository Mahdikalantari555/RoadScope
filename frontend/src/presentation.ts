import type { Language } from './i18n';
import type { PlatformMeta, PresentationContract } from './types/uai';

/**
 * Fallbacks for the presentation contract.
 *
 * The server is the single source of truth (`/api/v1/meta` → `presentation`). These helpers only
 * decide *how* the contract is rendered and what to show when a field is absent, for example when
 * an older deployment or a legacy Frankfurt dataset does not publish a `presentation` block. They
 * never invent a dataset name, a source, a licence or an attribution: a missing value is rendered
 * as an explicit "not reported" note so a screenshot cannot imply provenance that was not
 * recorded.
 */

export interface PresentationContext {
  datasetName: string;
  datasetProfile: string;
  syntheticIncidents: boolean | null;
  calibrationStatus: string;
  studyAreaLabel: string;
  networkSource: string;
  networkVersion: string;
  networkChecksum: string;
  license: string;
  attribution: string;
  legendNote: string;
  canonicalCrs: string;
  requiredElements: string[];
  screenshotGuidance: string;
  /** True when the API published the contract; false when values are locally derived. */
  fromContract: boolean;
}

const NOT_REPORTED: Record<Language, string> = {
  en: 'not reported',
  fa: 'ثبت نشده',
};

export function notReported(language: Language): string {
  return NOT_REPORTED[language];
}

function orNotReported(value: string | null | undefined, language: Language): string {
  const text = (value ?? '').trim();
  return text || notReported(language);
}

/**
 * Derive the presentation context from `/meta`, preferring the server's `presentation` block and
 * falling back to the sibling provenance fields the server also publishes.
 */
export function buildPresentationContext(
  meta: PlatformMeta | null,
  language: Language
): PresentationContext {
  const contract: PresentationContract | undefined = meta?.presentation;
  const provenance = meta?.network_provenance ?? {};
  const studyArea = language === 'fa' ? meta?.study_area_fa ?? meta?.study_area : meta?.study_area;

  return {
    datasetName: orNotReported(contract?.dataset_name ?? meta?.active_dataset?.name, language),
    datasetProfile: orNotReported(contract?.dataset_profile ?? meta?.dataset_profile, language),
    syntheticIncidents:
      contract?.synthetic_incidents ?? meta?.active_dataset?.is_synthetic ?? meta?.is_synthetic_incidents ?? null,
    calibrationStatus: orNotReported(meta?.calibration_status, language),
    studyAreaLabel: orNotReported(
      language === 'fa'
        ? contract?.study_area_label_fa ?? studyArea
        : contract?.study_area_label_en ?? studyArea,
      language
    ),
    networkSource: orNotReported(contract?.network_source ?? provenance.network_source, language),
    networkVersion: orNotReported(
      contract?.network_extract_version ?? provenance.extract_version,
      language
    ),
    networkChecksum: (contract?.network_checksum_sha256 ?? provenance.checksum_sha256 ?? '') as string,
    license: orNotReported(contract?.license ?? provenance.license, language),
    attribution: orNotReported(
      contract?.attribution ?? provenance.source_attribution ?? meta?.attribution,
      language
    ),
    legendNote: orNotReported(contract?.legend_note, language),
    canonicalCrs: orNotReported(
      contract?.canonical_crs ??
        (meta?.active_dataset?.crs_epsg ? `EPSG:${meta.active_dataset.crs_epsg}` : meta?.canonical_crs),
      language
    ),
    requiredElements: contract?.required_visible_elements ?? [],
    screenshotGuidance: contract?.screenshot_guidance ?? '',
    fromContract: Boolean(contract),
  };
}

/** Stable short form of an extract checksum, or an empty string when not recorded. */
export function shortChecksum(checksum: string): string {
  const text = (checksum ?? '').trim();
  return text ? text.slice(0, 12) : '';
}

export type SyntheticTone = 'synthetic' | 'real' | 'unknown';

export function syntheticTone(syntheticIncidents: boolean | null): SyntheticTone {
  if (syntheticIncidents === true) return 'synthetic';
  if (syntheticIncidents === false) return 'real';
  return 'unknown';
}

/**
 * The banner is deliberately *not* one boolean: a real-data pilot and a synthetic demo need
 * different wording, and an unknown dataset must say so rather than defaulting to either.
 */
export function datasetStatusLabel(
  language: Language,
  tone: SyntheticTone,
  calibrationStatus: string
): string {
  if (tone === 'synthetic') {
    return language === 'fa'
      ? 'رخدادهای مصنوعی؛ خطر دنیای واقعی نیست'
      : 'Synthetic incidents; not real-world risk';
  }
  if (tone === 'real') {
    const researchOnly = calibrationStatus === 'research_only' || calibrationStatus === 'uncalibrated';
    if (language === 'fa') {
      return researchOnly
        ? 'دادهٔ واقعی — پژوهشی، کالیبره‌نشده'
        : 'دادهٔ واقعی ثبت‌شده';
    }
    return researchOnly ? 'Real data — research only, not calibrated' : 'Observed real-world data';
  }
  return language === 'fa'
    ? 'وضعیت مصنوعی/واقعی این مجموعه‌داده مشخص نیست'
    : 'Dataset synthetic/real status unknown';
}
